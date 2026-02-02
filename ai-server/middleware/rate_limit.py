"""
Rate limiting middleware
=======================

Redis-backed request rate limiting using a sliding-window algorithm.

Features:
- Rate limiting by IP or user ID
- Configurable limits
- Graceful degradation (allow when Redis is unavailable)

Usage:
    from fastapi import FastAPI
    from middleware.rate_limit import RateLimitMiddleware

    app = FastAPI()
    app.add_middleware(RateLimitMiddleware)
"""

import time
from typing import Callable
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse

from core.config import config
from core.redis import RateLimiter


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Rate limiting middleware.

    Redis sliding-window limiter. Supports per-IP or per-user ID (from request headers).

    Response headers:
    - X-RateLimit-Limit: limit
    - X-RateLimit-Remaining: remaining quota
    - X-RateLimit-Reset: reset timestamp (unix)
    """

    def __init__(
        self,
        app,
        requests_per_minute: int = None,
        exclude_paths: list = None,
    ):
        """
        Args:
            app: FastAPI app
            requests_per_minute: Requests per minute (defaults to config)
            exclude_paths: Paths to exclude (e.g. health checks)
        """
        super().__init__(app)
        self.limit = requests_per_minute or config.rate_limit_per_minute
        self.exclude_paths = exclude_paths or [
            "/health",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/metrics",
        ]
        self.limiter = RateLimiter(requests_per_minute=self.limit)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Handle a request."""
        # Skip excluded paths
        if any(request.url.path.startswith(path) for path in self.exclude_paths):
            return await call_next(request)

        # If rate limiting is disabled, allow
        if not config.rate_limit_enabled:
            return await call_next(request)

        # Identifier (prefer user ID, otherwise IP)
        identifier = self._get_identifier(request)

        # Check quota
        is_allowed = await self.limiter.is_allowed(identifier)
        remaining = await self.limiter.get_remaining(identifier)

        if not is_allowed:
            # Return 429 Too Many Requests
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Too Many Requests",
                    "message": f"Rate limit exceeded. Maximum {self.limit} requests per minute.",
                    "retry_after": 60,
                },
                headers={
                    "X-RateLimit-Limit": str(self.limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(time.time()) + 60),
                    "Retry-After": "60",
                },
            )

        # Forward request
        response = await call_next(request)

        # Add rate limit headers
        response.headers["X-RateLimit-Limit"] = str(self.limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(int(time.time()) + 60)

        return response

    def _get_identifier(self, request: Request) -> str:
        """
        Get request identifier.

        Priority:
        1. X-User-ID header
        2. Authorization Bearer token (first 16 chars)
        3. Client IP
        """
        # Try user ID header
        user_id = request.headers.get("X-User-ID")
        if user_id:
            return f"user:{user_id}"

        # Try Authorization token
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
            # Use token prefix as identifier
            return f"token:{token[:16]}"

        # Use client IP
        # Note: behind proxies, use X-Forwarded-For for the real client IP.
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # Take the first IP (closest to the client)
            client_ip = forwarded_for.split(",")[0].strip()
        else:
            client_ip = request.client.host if request.client else "unknown"

        return f"ip:{client_ip}"


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Request logging middleware.

    Records basic request info for monitoring/debugging and emits metrics for Prometheus.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Handle a request."""
        from core.metrics import metrics

        start_time = time.time()

        # Forward request
        response = await call_next(request)

        # Duration
        duration_ms = (time.time() - start_time) * 1000

        # Add response timing header
        response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"

        # Logs + metrics (exclude health checks and /metrics)
        if not request.url.path.startswith(("/health", "/metrics")):
            # Metrics
            is_error = response.status_code >= 400
            metrics.record_request(duration_ms, is_error)

            # Log line
            print(
                f"[Request] {request.method} {request.url.path} "
                f"- {response.status_code} - {duration_ms:.2f}ms"
            )

        return response


__all__ = [
    "RateLimitMiddleware",
    "RequestLoggingMiddleware",
]
