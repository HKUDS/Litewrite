"""
TAP API Router
==============

API endpoints for TAP completion.
"""

import logging
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from services.tap import TAPService, TAPRequest

# Logger
logger = logging.getLogger("tap.api")


router = APIRouter()


class CompletionRequest(BaseModel):
    """Completion request."""

    preamble: str = ""
    prefix: str = ""
    suffix: str = ""
    projectId: Optional[str] = None


class ProposedChangesResponse(BaseModel):
    """Proposed changes."""

    prefix_diff: List[Dict[str, Any]]
    inserted_text: str
    suffix_diff: List[Dict[str, Any]]


class UsageResponse(BaseModel):
    """Usage info."""

    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    api_cost: float = 0.0


class CompletionResponse(BaseModel):
    """Completion response."""

    should_complete: bool
    confidence: float
    latency_ms: float
    proposed_changes: Optional[ProposedChangesResponse] = None
    reason: Optional[str] = None
    usage: Optional[UsageResponse] = None


@router.post("/complete", response_model=CompletionResponse)
async def complete(request: CompletionRequest):
    """
    TAP completion endpoint.

    Returns insertion suggestions and diffs.
    """
    logger.info("🔵 Received TAP completion request")
    logger.info(
        f"Request size - Preamble: {len(request.preamble)}, Prefix: {len(request.prefix)}, Suffix: {len(request.suffix)}"
    )
    # Detailed logs: show actual content (useful for debugging Yjs sync issues)
    prefix_preview = (
        request.prefix[-100:] if len(request.prefix) > 100 else request.prefix
    )
    suffix_preview = (
        request.suffix[:100] if len(request.suffix) > 100 else request.suffix
    )
    logger.info(f"Prefix content (last 100 chars): ...{prefix_preview}")
    logger.info(f"Suffix content (first 100 chars): {suffix_preview}...")

    service = TAPService(project_id=request.projectId)

    result = await service.complete(
        TAPRequest(
            preamble=request.preamble,
            prefix=request.prefix,
            suffix=request.suffix,
        )
    )

    logger.info(
        f"🔵 Returning TAP response - Should complete: {result.should_complete}, Confidence: {result.confidence:.2f}, Latency: {result.latency_ms:.2f}ms"
    )
    if not result.should_complete and result.reason:
        logger.info(f"🔵 Reason for not completing: {result.reason}")

    return result.to_dict()


@router.get("/health")
async def health():
    """Health check."""
    return {"status": "ok", "service": "tap"}
