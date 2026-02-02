"""
Redis client
============

Provides a Redis connection pool and common utilities.

Features:
- Connection pool management
- Rate limiting
- Distributed locks
- Cache helpers

Usage:
    from core.redis import get_redis, RateLimiter

    # Get Redis client
    redis = await get_redis()
    await redis.set("key", "value")

    # Use rate limiter
    limiter = RateLimiter()
    if await limiter.is_allowed("user_123"):
        # Handle request
        pass
"""

import time
from typing import Optional
from contextlib import asynccontextmanager

from core.config import config

# Redis client (optional dependency)
try:
    import redis.asyncio as aioredis
    from redis.asyncio import Redis

    REDIS_AVAILABLE = True
except ImportError:
    aioredis = None
    Redis = None
    REDIS_AVAILABLE = False


# ============================================================================
# Connection pool
# ============================================================================

_redis_pool: Optional["Redis"] = None


async def get_redis() -> Optional["Redis"]:
    """
    Get Redis client (singleton).

    Returns None if Redis is not configured or not available.
    Callers must handle the None case.

    Returns:
        Redis client or None
    """
    global _redis_pool

    if not REDIS_AVAILABLE:
        return None

    if not config.redis_url:
        return None

    if _redis_pool is None:
        try:
            _redis_pool = aioredis.from_url(
                config.redis_url,
                encoding="utf-8",
                decode_responses=True,
                max_connections=config.redis_max_connections,
            )
            # Test connection
            await _redis_pool.ping()
            print(f"[Redis] Connected to {config.redis_url}")
        except Exception as e:
            print(f"[Redis] Failed to connect: {e}")
            _redis_pool = None
            return None

    return _redis_pool


async def close_redis():
    """Close the Redis connection pool."""
    global _redis_pool
    if _redis_pool is not None:
        await _redis_pool.close()
        _redis_pool = None
        print("[Redis] Connection closed")


async def check_redis_health() -> dict:
    """
    Check Redis health.

    Returns:
        Health status dict
    """
    if not REDIS_AVAILABLE:
        return {"status": "unavailable", "reason": "redis package not installed"}

    if not config.redis_url:
        return {"status": "disabled", "reason": "REDIS_URL not configured"}

    try:
        redis = await get_redis()
        if redis is None:
            return {"status": "error", "reason": "connection failed"}

        start = time.time()
        await redis.ping()
        latency = (time.time() - start) * 1000

        info = await redis.info("server")
        return {
            "status": "healthy",
            "latency_ms": round(latency, 2),
            "version": info.get("redis_version", "unknown"),
        }
    except Exception as e:
        return {"status": "error", "reason": str(e)}


# ============================================================================
# Rate limiting
# ============================================================================


class RateLimiter:
    """
    Sliding-window rate limiter.

    Implements a sliding window with Redis ZSET.

    Usage:
        limiter = RateLimiter(requests_per_minute=60)

        if await limiter.is_allowed("user_123"):
            # Handle request
            pass
        else:
            # Return 429 Too Many Requests
            pass
    """

    def __init__(
        self,
        requests_per_minute: int = None,
        window_seconds: int = 60,
        key_prefix: str = "ratelimit",
    ):
        """
        Args:
            requests_per_minute: Allowed requests per minute (defaults to config)
            window_seconds: Window size in seconds
            key_prefix: Redis key prefix
        """
        self.limit = requests_per_minute or config.rate_limit_per_minute
        self.window = window_seconds
        self.prefix = key_prefix

    async def is_allowed(self, identifier: str) -> bool:
        """
        Check whether a request is allowed.

        Args:
            identifier: User identifier (e.g. user_id, IP)

        Returns:
            True if allowed
        """
        redis = await get_redis()

        # If Redis is unavailable, allow by default (graceful degradation).
        if redis is None:
            return True

        key = f"{self.prefix}:{identifier}"
        now = time.time()
        window_start = now - self.window

        try:
            # Step 1: remove expired entries and get current count
            pipe = redis.pipeline()
            # Remove requests outside the window
            pipe.zremrangebyscore(key, 0, window_start)
            # Count requests within the window
            pipe.zcard(key)
            results = await pipe.execute()
            current_count = results[1]

            # Enforce limit
            if current_count >= self.limit:
                return False

            # Step 2: only add entry when allowed
            pipe = redis.pipeline()
            # Add current request
            pipe.zadd(key, {str(now): now})
            # Set TTL
            pipe.expire(key, self.window + 1)
            await pipe.execute()

            return True
        except Exception as e:
            print(f"[RateLimiter] Error: {e}")
            # Allow by default on errors
            return True

    async def get_remaining(self, identifier: str) -> int:
        """
        Get remaining request quota.

        Args:
            identifier: User identifier

        Returns:
            Remaining quota
        """
        redis = await get_redis()

        if redis is None:
            return self.limit

        key = f"{self.prefix}:{identifier}"
        now = time.time()
        window_start = now - self.window

        try:
            await redis.zremrangebyscore(key, 0, window_start)
            current_count = await redis.zcard(key)
            return max(0, self.limit - current_count)
        except Exception:
            return self.limit

    async def reset(self, identifier: str):
        """Reset rate limit counters for an identifier."""
        redis = await get_redis()
        if redis is not None:
            key = f"{self.prefix}:{identifier}"
            await redis.delete(key)


# ============================================================================
# Distributed lock
# ============================================================================


class DistributedLock:
    """
    Redis-based distributed lock.

    Uses SET NX EX for a simple distributed lock.

    Usage:
        lock = DistributedLock("my_resource")

        async with lock.acquire("request_123", timeout=30):
            # Execute work protected by the lock
            pass
    """

    def __init__(self, resource: str, key_prefix: str = "lock"):
        """
        Args:
            resource: Resource name
            key_prefix: Redis key prefix
        """
        self.resource = resource
        self.prefix = key_prefix
        self.key = f"{self.prefix}:{resource}"

    @asynccontextmanager
    async def acquire(self, token: str, timeout: int = 30):
        """
        Acquire the lock.

        Args:
            token: Unique lock token (used to verify ownership on release)
            timeout: Lock TTL in seconds

        Yields:
            True if acquired
        """
        redis = await get_redis()
        acquired = False

        try:
            if redis is not None:
                # Try acquiring the lock
                acquired = await redis.set(
                    self.key,
                    token,
                    nx=True,
                    ex=timeout,
                )

            yield acquired
        finally:
            if acquired and redis is not None:
                # Release lock (only the owner can release)
                lua_script = """
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
                """
                try:
                    await redis.eval(lua_script, 1, self.key, token)
                except Exception as e:
                    print(f"[DistributedLock] Failed to release lock: {e}")


# ============================================================================
# Cache helpers
# ============================================================================


class Cache:
    """
    Minimal Redis cache wrapper.

    Usage:
        cache = Cache("my_cache")

        # Set
        await cache.set("key", "value", ttl=3600)

        # Get
        value = await cache.get("key")
    """

    def __init__(self, namespace: str = "cache"):
        """
        Args:
            namespace: Cache namespace
        """
        self.namespace = namespace

    def _key(self, key: str) -> str:
        """Build a namespaced key."""
        return f"{self.namespace}:{key}"

    async def get(self, key: str) -> Optional[str]:
        """Get a cached value."""
        redis = await get_redis()
        if redis is None:
            return None

        try:
            return await redis.get(self._key(key))
        except Exception as e:
            print(f"[Cache] Get error: {e}")
            return None

    async def set(self, key: str, value: str, ttl: int = 3600) -> bool:
        """
        Set a cached value.

        Args:
            key: Cache key
            value: Cache value
            ttl: TTL in seconds

        Returns:
            True if successful
        """
        redis = await get_redis()
        if redis is None:
            return False

        try:
            await redis.set(self._key(key), value, ex=ttl)
            return True
        except Exception as e:
            print(f"[Cache] Set error: {e}")
            return False

    async def delete(self, key: str) -> bool:
        """Delete a cache entry."""
        redis = await get_redis()
        if redis is None:
            return False

        try:
            await redis.delete(self._key(key))
            return True
        except Exception as e:
            print(f"[Cache] Delete error: {e}")
            return False

    async def exists(self, key: str) -> bool:
        """Return True if a cache entry exists."""
        redis = await get_redis()
        if redis is None:
            return False

        try:
            return await redis.exists(self._key(key)) > 0
        except Exception as e:
            print(f"[Cache] Exists error: {e}")
            return False


__all__ = [
    "get_redis",
    "close_redis",
    "check_redis_health",
    "RateLimiter",
    "DistributedLock",
    "Cache",
    "REDIS_AVAILABLE",
]
