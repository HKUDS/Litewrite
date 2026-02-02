"""
Core
====

Shared infrastructure:
- Configuration
- LLM clients
- Embedding engine
- Cache management
- API key rotation
- Utilities

Usage:
    from core import get_llm_client, EmbeddingEngine, config, key_manager
"""

from core.config import config, LLM_MODEL, EMBEDDING_MODEL, TAP_MODEL, TAP_API_KEY
from core.llm import (
    get_llm_client,
    get_embedding_client,
    create_llm_client_with_key,
    create_llm_client_sync_with_key,
    get_current_api_key,
)
from core.key_rotation import key_manager, KeyRotationManager, KeyStrategy
from core.embedding import EmbeddingEngine
from core.cache import CacheManager
from core.utils import chunk_text, truncate_text, clean_text, api_retry

__all__ = [
    # Config
    "config",
    "LLM_MODEL",
    "EMBEDDING_MODEL",
    "TAP_MODEL",
    "TAP_API_KEY",
    # Clients
    "get_llm_client",
    "get_embedding_client",
    "create_llm_client_with_key",
    "create_llm_client_sync_with_key",
    "get_current_api_key",
    # Key rotation
    "key_manager",
    "KeyRotationManager",
    "KeyStrategy",
    # Embedding
    "EmbeddingEngine",
    # Cache
    "CacheManager",
    # Utilities
    "chunk_text",
    "truncate_text",
    "clean_text",
    "api_retry",
]
