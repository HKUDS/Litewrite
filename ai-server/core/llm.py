"""
LLM clients
===========

Unified LLM access helpers with API key rotation support.

Production notes:
- Singleton clients to avoid repeated creation
- Connection pool reuse
- Timeouts and retry policy
- Multi-key rotation support

Usage:
    from core.llm import get_llm_client, get_current_api_key, LLM_MODEL

    # Option 1: use the first configured key (backward compatible)
    client = get_llm_client()
    response = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": "Hello!"}]
    )

    # Option 2: use a rotated key (recommended)
    from core.llm import create_llm_client_with_key
    from core.key_rotation import key_manager

    key = key_manager.get_next_key()
    client = create_llm_client_with_key(key)
    response = await client.chat.completions.create(...)
"""

import hashlib

import httpx
from openai import AsyncOpenAI, OpenAI
from typing import Optional, Dict
from core.config import config
from core.key_rotation import key_manager

# ============================================================================
# Client cache (key-hash -> client) to avoid recreating instances
# ============================================================================

_default_llm_client: AsyncOpenAI | None = None
_default_llm_client_sync: OpenAI | None = None
_embedding_client: AsyncOpenAI | None = None

# Per-key client pools
_client_pool: Dict[str, AsyncOpenAI] = {}
_client_pool_sync: Dict[str, OpenAI] = {}


def get_llm_client() -> AsyncOpenAI:
    """
    Get async LLM client (OpenRouter).

    Uses a singleton to reuse the HTTP connection pool.

    NOTE: this uses the first configured key and does not participate in rotation.
    For rotation, use create_llm_client_with_key().

    Returns:
        AsyncOpenAI client
    """
    global _default_llm_client
    if _default_llm_client is None:
        # Use the first configured key; no rotation
        api_keys = config.get_api_keys()
        api_key = api_keys[0] if api_keys else config.openrouter_api_key
        _default_llm_client = AsyncOpenAI(
            base_url=config.openrouter_base_url,
            api_key=api_key,
            max_retries=config.max_retries,
            timeout=httpx.Timeout(
                timeout=float(config.request_timeout),
                connect=10.0,
            ),
        )
    return _default_llm_client


def get_llm_client_sync() -> OpenAI:
    """
    Get sync LLM client (OpenRouter).

    For non-async use cases (e.g. TAP completion). Uses a singleton to reuse connections.

    Returns:
        OpenAI client
    """
    global _default_llm_client_sync
    if _default_llm_client_sync is None:
        # Use the first configured key; no rotation
        api_keys = config.get_api_keys()
        api_key = api_keys[0] if api_keys else config.openrouter_api_key
        _default_llm_client_sync = OpenAI(
            base_url=config.openrouter_base_url,
            api_key=api_key,
            max_retries=config.max_retries,
            timeout=httpx.Timeout(
                timeout=float(config.request_timeout),
                connect=10.0,
            ),
        )
    return _default_llm_client_sync


def create_llm_client_with_key(api_key: str) -> AsyncOpenAI:
    """
    Create an async LLM client for a specific key.

    Instances are cached: the same key returns the same client.

    Args:
        api_key: OpenRouter API key

    Returns:
        AsyncOpenAI client
    """
    # Use SHA-256(key) as cache key (avoid leaking raw key, keep uniqueness)
    cache_key = hashlib.sha256(api_key.encode()).hexdigest()

    if cache_key not in _client_pool:
        _client_pool[cache_key] = AsyncOpenAI(
            base_url=config.openrouter_base_url,
            api_key=api_key,
            max_retries=0,  # no retries here; rotation is handled externally
            timeout=httpx.Timeout(
                timeout=float(config.request_timeout),
                connect=10.0,
            ),
        )
    return _client_pool[cache_key]


def create_llm_client_sync_with_key(api_key: str) -> OpenAI:
    """
    Create a sync LLM client for a specific key.

    Args:
        api_key: OpenRouter API key

    Returns:
        OpenAI client
    """
    # Use SHA-256(key) as cache key (avoid leaking raw key, keep uniqueness)
    cache_key = hashlib.sha256(api_key.encode()).hexdigest()

    if cache_key not in _client_pool_sync:
        _client_pool_sync[cache_key] = OpenAI(
            base_url=config.openrouter_base_url,
            api_key=api_key,
            max_retries=0,
            timeout=httpx.Timeout(
                timeout=float(config.request_timeout),
                connect=10.0,
            ),
        )
    return _client_pool_sync[cache_key]


def get_current_api_key() -> Optional[str]:
    """
    Get current rotated API key (read-only; does not advance rotation).

    This is read-only and does not affect round-robin distribution.
    To advance rotation, call key_manager.get_next_key().

    Returns:
        Current API key, or None if not configured
    """
    return key_manager.peek_current_key()


def get_embedding_client() -> AsyncOpenAI:
    """
    Get async embedding client.

    Uses a separate base URL (often better embedding quality) and a singleton for reuse.

    Returns:
        AsyncOpenAI client
    """
    global _embedding_client
    if _embedding_client is None:
        _embedding_client = AsyncOpenAI(
            base_url=config.embedding_base_url,
            api_key=config.embedding_api_key,
            max_retries=config.max_retries,
            timeout=httpx.Timeout(
                timeout=float(config.request_timeout),
                connect=10.0,
            ),
        )
    return _embedding_client


def reset_clients():
    """
    Reset all client instances.

    Useful in tests or after configuration changes.
    """
    global _default_llm_client, _default_llm_client_sync, _embedding_client
    global _client_pool, _client_pool_sync

    _default_llm_client = None
    _default_llm_client_sync = None
    _embedding_client = None
    _client_pool.clear()
    _client_pool_sync.clear()


__all__ = [
    "get_llm_client",
    "get_llm_client_sync",
    "get_embedding_client",
    "create_llm_client_with_key",
    "create_llm_client_sync_with_key",
    "get_current_api_key",
    "reset_clients",
]
