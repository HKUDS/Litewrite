"""
DeepResearch API Router
=======================

API endpoints for DeepResearch.

Features:
- Multi-iteration search
- Outline planning (structured mode)
- Structured streaming generation
- BibTeX export
- Reference list
"""

from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.deep_research import DeepResearchService


router = APIRouter()


class ResearchRequest(BaseModel):
    """Research request."""

    query: str
    arxiv_papers: int = 10
    web_pages: int = 10
    structured: bool = (
        True  # Whether to use structured mode (outline + section streaming)
    )
    max_iterations: int = 3  # Max iterations
    # Project ID for tracking
    projectId: Optional[str] = None


@router.post("/stream")
async def research_stream(request: ResearchRequest):
    """
    Deep research endpoint (SSE streaming).

    Args:
        query: Research question
        arxiv_papers: Number of arXiv papers
        web_pages: Number of web pages
        structured: Whether to use structured mode
        max_iterations: Max iterations

    Returns an event stream describing the research process:
    - progress: progress update
    - search_start/result: search state
    - analysis: knowledge gap analysis
    - iteration: iteration marker
    - outline_start/done: outline planning (structured mode)
    - section_start/chunk/done: section generation (structured mode)
    - report_start/chunk/done: report generation
    - done: finished (includes bibtex, references_markdown)
    """
    service = DeepResearchService(
        max_iterations=request.max_iterations,
        verbose=False,
        project_id=request.projectId,
    )

    async def event_generator():
        async for event in service.research_stream(
            query=request.query,
            arxiv_papers=request.arxiv_papers,
            web_pages=request.web_pages,
            structured=request.structured,
        ):
            yield event.to_sse()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/health")
async def health():
    """Health check."""
    return {"status": "ok", "service": "deep_research"}
