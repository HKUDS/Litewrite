"""
FastAPI Application
===================

Unified API entrypoint aggregating all services.

Production features:
- Rate limiting middleware
- Deep readiness checks (Redis, S3, LLM)
- Prometheus metrics endpoint
- Request logging
"""

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from api.tap import router as tap_router
from api.deep_research import router as research_router
from api.chat import router as chat_router
from api.tools import router as tools_router

from core.config import config
from core.metrics import metrics
from core.redis import check_redis_health, close_redis, get_redis
from middleware.rate_limit import RateLimitMiddleware, RequestLoggingMiddleware


# ============================================================================
# App lifecycle
# ============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application startup/shutdown lifecycle."""
    # Startup
    config.print_config()

    # Try connecting Redis (if configured)
    if config.redis_url:
        await get_redis()

    yield

    # Shutdown
    await close_redis()
    print("[App] Shutting down...")


# ============================================================================
# App creation
# ============================================================================


def create_app() -> FastAPI:
    """Create the FastAPI application."""
    app = FastAPI(
        title="Litewrite AI Server",
        description="AI services for collaborative writing (production-ready)",
        version="2.1.0",
        docs_url="/docs"
        if not config.is_production
        else None,  # Disable Swagger in production
        redoc_url="/redoc" if not config.is_production else None,
        lifespan=lifespan,
    )

    # ==================== Middleware ====================
    # Note: Starlette/FastAPI middleware wraps in reverse order (onion model).
    # Execution: last-added -> first-added -> routes -> first-added -> last-added

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Rate limiting (requires Redis).
    # Must be added before RequestLoggingMiddleware so we can log 429 responses.
    if config.rate_limit_enabled:
        app.add_middleware(RateLimitMiddleware)

    # Request logging (add last to become outermost layer)
    app.add_middleware(RequestLoggingMiddleware)

    # ==================== Routes ====================

    app.include_router(tap_router, prefix="/api/tap", tags=["TAP"])
    app.include_router(
        research_router, prefix="/api/deep-research", tags=["DeepResearch"]
    )
    app.include_router(chat_router, prefix="/api/chat", tags=["Chat"])
    app.include_router(tools_router, prefix="/api/tools", tags=["Tools"])

    # ==================== Health checks ====================

    @app.get("/health")
    async def health_check():
        """
        Basic health check for load balancers.

        Returns 200 if the process is up.
        """
        return {
            "status": "ok",
            "version": "2.1.0",
        }

    @app.get("/health/ready")
    async def readiness_check():
        """
        Readiness check.

        Verifies dependencies required to serve traffic.

        Notes:
        - Redis is optional; disabled/unavailable is acceptable.
        - S3 is required; must be healthy.
        """
        redis_check = await check_redis_health()
        s3_check = await _check_s3_health()

        checks = {
            "redis": redis_check,
            "s3": s3_check,
        }

        # Redis is optional: disabled/unavailable/healthy are acceptable.
        redis_ok = redis_check.get("status") in ("healthy", "disabled", "unavailable")

        # S3 is required; must be healthy.
        s3_ok = s3_check.get("status") == "healthy"

        all_healthy = redis_ok and s3_ok

        return {
            "status": "ready" if all_healthy else "not_ready",
            "version": "2.1.0",
            "checks": checks,
        }

    @app.get("/health/live")
    async def liveness_check():
        """
        Liveness check (process is running).
        """
        return {"status": "alive"}

    # ==================== Metrics ====================

    @app.get("/metrics", response_class=PlainTextResponse)
    async def prometheus_metrics():
        """
        Prometheus metrics endpoint.
        """
        return metrics.to_prometheus()

    return app


async def _check_s3_health() -> dict:
    """Check S3 health."""
    if not config.s3_bucket:
        return {"status": "disabled", "reason": "S3_BUCKET not configured"}

    try:
        import boto3
        from botocore.config import Config as BotoConfig

        client_config = BotoConfig(
            signature_version="s3v4",
            connect_timeout=5,
            read_timeout=5,
        )

        client = boto3.client(
            "s3",
            endpoint_url=config.s3_endpoint or None,
            region_name=config.s3_region,
            aws_access_key_id=config.s3_access_key,
            aws_secret_access_key=config.s3_secret_key,
            config=client_config,
        )

        start = time.time()
        client.head_bucket(Bucket=config.s3_bucket)
        latency = (time.time() - start) * 1000

        return {
            "status": "healthy",
            "bucket": config.s3_bucket,
            "latency_ms": round(latency, 2),
        }
    except Exception as e:
        return {"status": "error", "reason": str(e)}


# Default app instance
app = create_app()


__all__ = ["create_app", "app", "metrics"]
