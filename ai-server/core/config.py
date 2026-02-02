"""
Configuration
=============

Centralized configuration management with environment variable overrides.

Usage:
    from core.config import config, LLM_MODEL

    # Access config
    api_key = config.openrouter_api_key
    model = LLM_MODEL

Load order:
    1. Try to load ai-server/.env
    2. Read process environment variables
    3. Fall back to defaults

Production notes:
    - REDIS_URL: Optional Redis URL (rate limiting, caching)
    - WORKERS: Gunicorn worker count
    - RATE_LIMIT_ENABLED: Enable rate limiting (requires Redis)
    - RATE_LIMIT_PER_MINUTE: Per-user requests/minute limit
"""

import os
from dataclasses import dataclass
from pathlib import Path

# Try loading a local .env file (optional)
try:
    from dotenv import load_dotenv

    # Prefer ai-server/.env, fall back to CWD .env
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        print(f"[Config] Loaded .env from {env_path}")
    else:
        # Also try loading from current working directory
        load_dotenv()
except ImportError:
    # python-dotenv is optional
    pass


@dataclass
class Config:
    """Global configuration."""

    # ==================== API Keys ====================
    # NOTE: All API keys must come from environment variables. Never hardcode secrets.

    # OpenRouter / LLM API
    openrouter_base_url: str = os.getenv(
        "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
    )
    # Single key (backward compatible)
    openrouter_api_key: str = os.getenv("OPENROUTER_API_KEY", "")
    # Multiple keys (comma-separated) for rotation
    openrouter_api_keys: str = os.getenv("OPENROUTER_API_KEYS", "")
    # Rotation strategy: round_robin | random | least_used
    openrouter_key_strategy: str = os.getenv("OPENROUTER_KEY_STRATEGY", "round_robin")

    # Next.js API base URL (internal file APIs, tool callbacks, etc.)
    nextjs_api_url: str = os.getenv("NEXTJS_API_URL", "http://localhost:3000")
    # Internal auth secret (AI Server <-> Next.js)
    internal_api_secret: str = os.getenv("INTERNAL_API_SECRET", "")

    # OpenAI-compatible API (for embeddings)
    embedding_base_url: str = os.getenv(
        "EMBEDDING_API_BASE", "https://api.openai.com/v1"
    )
    embedding_api_key: str = os.getenv("EMBEDDING_API_KEY", "")

    # Serper (for web search)
    serper_api_key: str = os.getenv("SERPER_API_KEY", "")

    # ==================== Models ====================

    # LLM model (general)
    llm_model: str = os.getenv("LLM_MODEL", "google/gemini-3-flash-preview")

    # Embedding model
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")

    # TAP-specific overrides (optional; fall back to general LLM config)
    tap_model: str = os.getenv("TAP_MODEL", "")  # Empty => fall back to llm_model
    tap_api_key: str = os.getenv("TAP_API_KEY", "")  # Empty => use key rotation

    # ==================== Context window (Chat 1.5) ====================

    # Total context window
    context_total_window: int = int(os.getenv("CONTEXT_TOTAL_WINDOW", "128000"))

    # Session history limit (previous conversation)
    context_history_limit: int = int(os.getenv("CONTEXT_HISTORY_LIMIT", "64000"))

    # Execution context limit (current turn tool calls)
    context_execution_limit: int = int(os.getenv("CONTEXT_EXECUTION_LIMIT", "64000"))

    # Compression trigger ratio (when to compress via LLM)
    context_compression_threshold: float = float(
        os.getenv("CONTEXT_COMPRESSION_THRESHOLD", "0.95")
    )

    # Compression target ratio (target size = limit * ratio)
    context_compression_target: float = float(
        os.getenv("CONTEXT_COMPRESSION_TARGET", "0.3")
    )

    # ==================== Redis ====================

    # Optional Redis URL. If empty, Redis-dependent features are disabled.
    # Format: redis://[[username]:[password]@]host[:port][/db]
    redis_url: str = os.getenv("REDIS_URL", "")

    # Redis connection pool size
    redis_max_connections: int = int(os.getenv("REDIS_MAX_CONNECTIONS", "20"))

    # ==================== Rate limiting ====================

    # Enable rate limiting (requires Redis)
    rate_limit_enabled: bool = os.getenv("RATE_LIMIT_ENABLED", "true").lower() in (
        "true",
        "1",
        "yes",
    )

    # Per-user requests per minute
    rate_limit_per_minute: int = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))

    # ==================== Workers ====================

    # Gunicorn worker count (production recommendation: 2-4 * CPU cores)
    workers: int = int(os.getenv("WORKERS", "4"))

    # Threads per worker
    worker_threads: int = int(os.getenv("WORKER_THREADS", "1"))

    # Worker timeout (seconds)
    worker_timeout: int = int(os.getenv("WORKER_TIMEOUT", "120"))

    # Production flag
    is_production: bool = os.getenv("ENV", "development").lower() == "production"

    # ==================== Cache ====================

    # Cache provider: fixed to "s3" to match the web app storage.
    # Local cache mode is not supported here.
    cache_provider: str = "s3"

    # Local cache directory (used only if local cache is enabled)
    cache_base_dir: str = os.getenv(
        "CACHE_BASE_DIR", str(Path(__file__).parent.parent / "cache")
    )

    # S3 cache config (shared with the web app S3 settings)
    s3_endpoint: str = os.getenv("S3_ENDPOINT", "")
    s3_bucket: str = os.getenv("S3_BUCKET", "")
    s3_region: str = os.getenv("S3_REGION", "us-east-1")
    s3_access_key: str = os.getenv("S3_ACCESS_KEY_ID", "")
    s3_secret_key: str = os.getenv("S3_SECRET_ACCESS_KEY", "")

    # S3 cache prefix (sibling of litewrite/, projects/, etc.)
    s3_cache_prefix: str = os.getenv("S3_CACHE_PREFIX", "ai-server-cache")

    @property
    def arxiv_cache_dir(self) -> str:
        """arXiv LaTeX cache directory."""
        return str(Path(self.cache_base_dir) / "arxiv")

    @property
    def web_cache_dir(self) -> str:
        """Web content cache directory."""
        return str(Path(self.cache_base_dir) / "web")

    @property
    def use_s3_cache(self) -> bool:
        """Return True if S3 cache is configured, otherwise fall back to local cache."""
        # Check required S3 settings
        if not self.s3_bucket:
            return False
        return True

    # ==================== Project paths ====================

    # Project storage base directory
    projects_base_dir: str = os.getenv("PROJECTS_BASE_DIR", "/data/projects")

    # ==================== Ports ====================

    # Use 6612 for compatibility with legacy TAP endpoint
    api_port: int = int(os.getenv("API_PORT", "6612"))
    tap_port: int = int(os.getenv("TAP_PORT", "6612"))

    # ==================== Misc ====================

    # Max retries
    max_retries: int = int(os.getenv("MAX_RETRIES", "3"))

    # Request timeout (seconds)
    request_timeout: int = int(os.getenv("REQUEST_TIMEOUT", "60"))

    # Log level
    log_level: str = os.getenv("LOG_LEVEL", "INFO")

    def ensure_cache_dirs(self):
        """Ensure local cache directories exist."""
        Path(self.arxiv_cache_dir).mkdir(parents=True, exist_ok=True)
        Path(self.web_cache_dir).mkdir(parents=True, exist_ok=True)

    def get_api_keys(self) -> list[str]:
        """Return all configured OpenRouter API keys."""
        keys = []
        # Prefer multi-key config
        if self.openrouter_api_keys:
            keys = [k.strip() for k in self.openrouter_api_keys.split(",") if k.strip()]
        # Backward compatible: fall back to single key
        if not keys and self.openrouter_api_key:
            keys = [self.openrouter_api_key]
        return keys

    def print_config(self):
        """Print config (redacting sensitive fields)."""
        api_keys = self.get_api_keys()
        print("=" * 60)
        print("AI Server Configuration")
        print("=" * 60)
        print(f"  Environment: {'Production' if self.is_production else 'Development'}")
        print(f"  API Port: {self.api_port}")
        print(f"  Workers: {self.workers}")
        print(f"  LLM Model: {self.llm_model}")
        print(f"  Redis: {'Enabled' if self.redis_url else 'Disabled'}")
        print(
            f"  Rate Limit: {'Enabled' if self.rate_limit_enabled and self.redis_url else 'Disabled'}"
        )
        if self.rate_limit_enabled:
            print(f"    - {self.rate_limit_per_minute} requests/minute")
        print(f"  API Keys: {len(api_keys)} configured")
        print(f"  Key Strategy: {self.openrouter_key_strategy}")
        print("=" * 60)


# Global config instance
config = Config()

# Ensure cache directories exist
config.ensure_cache_dirs()

# Convenience aliases (backward compatible)
LLM_MODEL = config.llm_model
EMBEDDING_MODEL = config.embedding_model
OPENROUTER_API_KEY = config.openrouter_api_key
OPENROUTER_BASE_URL = config.openrouter_base_url

# TAP overrides (fall back to general config)
TAP_MODEL = config.tap_model or config.llm_model
TAP_API_KEY = config.tap_api_key


__all__ = [
    "Config",
    "config",
    "LLM_MODEL",
    "EMBEDDING_MODEL",
    "OPENROUTER_API_KEY",
    "OPENROUTER_BASE_URL",
    "TAP_MODEL",
    "TAP_API_KEY",
]
