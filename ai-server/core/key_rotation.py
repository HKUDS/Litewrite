"""
API key rotation
================

Rotate across multiple OpenRouter API keys to improve availability and distribute load.

Strategies:
- round_robin: cycle through keys (default)
- random: pick a random key
- least_used: pick the least-used key (requires Redis)

Environment:
    OPENROUTER_API_KEYS=YOUR_OPENROUTER_API_KEY_1,YOUR_OPENROUTER_API_KEY_2
    OPENROUTER_KEY_STRATEGY=round_robin

Security notes:
- Full API keys live only in environment variables and memory.
- Only a masked representation is exposed externally (e.g. YOUR_OPE...KEY2).
- Aggregations use a key hash for association.

Usage:
    from core.key_rotation import key_manager

    # Get the next key
    key = key_manager.get_next_key()

    # Record usage
    key_manager.record_usage(key, tokens=1000, cost=0.01)

    # Record errors
    key_manager.record_error(key)
"""

import hashlib
import random
import threading
import time
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional

from core.config import config


class KeyStrategy(str, Enum):
    """Key rotation strategy."""

    ROUND_ROBIN = "round_robin"
    RANDOM = "random"
    LEAST_USED = "least_used"


@dataclass
class KeyStats:
    """Statistics for a single key."""

    key: str
    key_hash: str
    key_mask: str
    request_count: int = 0
    total_tokens: int = 0
    total_cost: float = 0.0
    error_count: int = 0
    last_error_time: Optional[float] = None
    is_rate_limited: bool = False
    rate_limit_until: Optional[float] = None

    @staticmethod
    def create(key: str) -> "KeyStats":
        """Create KeyStats from a raw key."""
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        # Mask: first 8 chars + ... + last 4 chars
        if len(key) > 12:
            key_mask = f"{key[:8]}...{key[-4:]}"
        else:
            key_mask = key[:4] + "..."
        return KeyStats(key=key, key_hash=key_hash, key_mask=key_mask)


class KeyRotationManager:
    """
    API key rotation manager.

    Thread-safe singleton with multiple rotation strategies.
    """

    _instance: Optional["KeyRotationManager"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "KeyRotationManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        # _initialized must be checked/updated under the class lock.
        # Otherwise multiple threads may initialize concurrently.
        with KeyRotationManager._lock:
            if self._initialized:
                return

            self._keys: List[KeyStats] = []
            self._key_map: Dict[str, KeyStats] = {}  # hash -> KeyStats
            self._current_index = 0
            self._strategy = self._parse_strategy(config.openrouter_key_strategy)
            self._instance_lock = threading.Lock()

            # Initialize keys
            self._load_keys()
            self._initialized = True

    def _parse_strategy(self, strategy_value: str) -> KeyStrategy:
        """
        Parse the configured rotation strategy (with tolerance).

        Args:
            strategy_value: Strategy string from env/config

        Returns:
            KeyStrategy value; falls back to ROUND_ROBIN if invalid
        """
        # Normalize: lowercase and convert hyphens to underscores
        normalized = strategy_value.lower().strip().replace("-", "_")

        try:
            return KeyStrategy(normalized)
        except ValueError:
            # Try matching enum names (supports "ROUND_ROBIN" style)
            try:
                return KeyStrategy[normalized.upper()]
            except KeyError:
                pass

            # Unrecognized strategy: fall back to default
            valid_strategies = [s.value for s in KeyStrategy]
            print(
                f"[KeyRotation] WARNING: Invalid key strategy '{strategy_value}', "
                f"valid options are: {valid_strategies}. "
                f"Falling back to '{KeyStrategy.ROUND_ROBIN.value}'."
            )
            return KeyStrategy.ROUND_ROBIN

    def _load_keys(self):
        """Load keys from configuration."""
        raw_keys = config.get_api_keys()
        for key in raw_keys:
            stats = KeyStats.create(key)
            self._keys.append(stats)
            self._key_map[stats.key_hash] = stats

        if self._keys:
            print(f"[KeyRotation] Loaded {len(self._keys)} API keys")
            for stats in self._keys:
                print(f"  - {stats.key_mask}")
        else:
            print("[KeyRotation] WARNING: No API keys configured!")

    def get_next_key(self) -> Optional[str]:
        """
        Get the next usable key.

        Returns:
            API key string, or None if none is available
        """
        if not self._keys:
            return None

        with self._instance_lock:
            # Filter out rate-limited keys
            available_keys = self._get_available_keys()

            if not available_keys:
                # All keys are rate-limited; pick the one with the shortest wait.
                return self._get_least_rate_limited_key()

            if self._strategy == KeyStrategy.ROUND_ROBIN:
                return self._round_robin_select(available_keys)
            elif self._strategy == KeyStrategy.RANDOM:
                return self._random_select(available_keys)
            elif self._strategy == KeyStrategy.LEAST_USED:
                return self._least_used_select(available_keys)
            else:
                return self._round_robin_select(available_keys)

    def _get_available_keys(self) -> List[KeyStats]:
        """Return currently usable keys (exclude rate-limited ones)."""
        now = time.time()
        available = []
        for stats in self._keys:
            if stats.is_rate_limited:
                if stats.rate_limit_until and now > stats.rate_limit_until:
                    # Rate limit expired
                    stats.is_rate_limited = False
                    stats.rate_limit_until = None
                    available.append(stats)
            else:
                available.append(stats)
        return available

    def _get_least_rate_limited_key(self) -> Optional[str]:
        """Return the key with the smallest rate-limit wait time."""
        if not self._keys:
            return None

        # Sort by rate-limit end time
        sorted_keys = sorted(
            self._keys, key=lambda k: k.rate_limit_until or float("inf")
        )
        return sorted_keys[0].key

    def _round_robin_select(self, available: List[KeyStats]) -> str:
        """Round-robin selection."""
        # Find the next key that is present in the available list
        for _ in range(len(self._keys)):
            stats = self._keys[self._current_index]
            self._current_index = (self._current_index + 1) % len(self._keys)
            if stats in available:
                return stats.key
        # Fallback: return the first available key
        return available[0].key

    def _random_select(self, available: List[KeyStats]) -> str:
        """Random selection."""
        return random.choice(available).key

    def _least_used_select(self, available: List[KeyStats]) -> str:
        """Select the least-used key."""
        # Sort by request count
        sorted_keys = sorted(available, key=lambda k: k.request_count)
        return sorted_keys[0].key

    def peek_current_key(self) -> Optional[str]:
        """
        Get the current key without advancing rotation state.

        This is a read-only operation and does not affect round-robin distribution.
        Useful when you need to inspect the current key without changing state.

        Returns:
            Current API key string, or None if none is available
        """
        if not self._keys:
            return None

        with self._instance_lock:
            # Round-robin: return the key at current index.
            # Other strategies: return the first key.
            if self._strategy == KeyStrategy.ROUND_ROBIN:
                return self._keys[self._current_index].key
            elif self._strategy == KeyStrategy.RANDOM:
                # Random strategy has no "current" concept; return the first one.
                return self._keys[0].key if self._keys else None
            elif self._strategy == KeyStrategy.LEAST_USED:
                # Return least-used key
                sorted_keys = sorted(self._keys, key=lambda k: k.request_count)
                return sorted_keys[0].key if sorted_keys else None
            else:
                return self._keys[0].key if self._keys else None

    def record_usage(
        self,
        key: str,
        tokens: int = 0,
        cost: float = 0.0,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ):
        """
        Record key usage.

        Args:
            key: API key
            tokens: Total tokens
            cost: API cost (USD)
            input_tokens: Input tokens
            output_tokens: Output tokens
        """
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        with self._instance_lock:
            if key_hash in self._key_map:
                stats = self._key_map[key_hash]
                stats.request_count += 1
                stats.total_tokens += tokens
                stats.total_cost += cost

    def record_error(self, key: str, is_rate_limit: bool = False):
        """
        Record a key error.

        Args:
            key: API key
            is_rate_limit: Whether this was a rate limit (HTTP 429)
        """
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        with self._instance_lock:
            if key_hash in self._key_map:
                stats = self._key_map[key_hash]
                stats.error_count += 1
                stats.last_error_time = time.time()

                if is_rate_limit:
                    stats.is_rate_limited = True
                    # Retry after 60 seconds
                    stats.rate_limit_until = time.time() + 60

    def clear_rate_limit(self, key: str):
        """Clear the rate-limit state for a key."""
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        with self._instance_lock:
            if key_hash in self._key_map:
                stats = self._key_map[key_hash]
                stats.is_rate_limited = False
                stats.rate_limit_until = None

    def get_all_stats(self) -> List[Dict]:
        """Get masked stats for all keys."""
        with self._instance_lock:
            return [
                {
                    "key_hash": stats.key_hash,
                    "key_mask": stats.key_mask,
                    "request_count": stats.request_count,
                    "total_tokens": stats.total_tokens,
                    "total_cost": round(stats.total_cost, 6),
                    "error_count": stats.error_count,
                    "is_rate_limited": stats.is_rate_limited,
                }
                for stats in self._keys
            ]

    def get_key_count(self) -> int:
        """Return the number of configured keys."""
        return len(self._keys)

    def get_key_by_hash(self, key_hash: str) -> Optional[str]:
        """Get a raw key by hash (internal use)."""
        if key_hash in self._key_map:
            return self._key_map[key_hash].key
        return None

    def get_mask_by_key(self, key: str) -> str:
        """Get the masked representation for a key."""
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        if key_hash in self._key_map:
            return self._key_map[key_hash].key_mask
        return "unknown"


# Global singleton instance
key_manager = KeyRotationManager()


__all__ = ["KeyRotationManager", "KeyStrategy", "key_manager"]
