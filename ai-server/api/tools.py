"""
Tools API Router
================

API endpoints for the unified Tool Layer.

This router provides health check and monitoring endpoints.

Note: Tools now use direct HTTP calls to Next.js internal APIs,
so the old /result and /pending endpoints are no longer needed.
"""

from fastapi import APIRouter


router = APIRouter()


# ============================================================================
# API Endpoints
# ============================================================================


@router.get("/health")
async def health():
    """Health check for Tools API"""
    return {"status": "ok", "service": "tools"}
