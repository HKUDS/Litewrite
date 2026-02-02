"""
Deep Research Service
=====================

Deep research report service integrating arXiv RAG and web search.

Features:
- Multi-iteration search (automatic gap discovery)
- Outline planning
- Structured streaming generation
- Reference management
- BibTeX export (Overleaf-friendly)
- Reference list output

Usage:
    from services.deep_research import DeepResearchService, EventType

    # Simple mode
    service = DeepResearchService()
    async for event in service.research_stream("How do transformers work?"):
        if event.type == EventType.REPORT_CHUNK:
            print(event.data["chunk"], end="", flush=True)
        elif event.type == EventType.DONE:
            bibtex = event.data["bibtex"]
            references = event.data["references_markdown"]

    # Structured mode (outline + section streaming)
    async for event in service.research_stream("...", structured=True):
        if event.type == EventType.OUTLINE_DONE:
            print("Outline:", event.data["outline"])
        elif event.type == EventType.SECTION_START:
            print(f"Writing: {event.data['title']}")
        elif event.type == EventType.SECTION_CHUNK:
            print(event.data["chunk"], end="")

Event Types:
- PROGRESS: progress update
- SEARCH_START: search started
- SEARCH_RESULT: search results
- ANALYSIS: knowledge gap analysis
- ITERATION: iteration marker
- OUTLINE_START: outline generation started
- OUTLINE_DONE: outline ready
- SECTION_START: section generation started
- SECTION_CHUNK: section chunk
- SECTION_DONE: section done
- REPORT_START: report generation started
- REPORT_CHUNK: report chunk
- REPORT_DONE: report done
- DONE: finished
- ERROR: error
"""

from services.deep_research.service import (
    DeepResearchService,
    ResearchEvent,
    EventType,
)

from services.deep_research.models import (
    Reference,
    ReferenceType,
    ReportSection,
    ReportOutline,
    ResearchReport,
)

from services.deep_research.references import ReferenceManager


__all__ = [
    # Core service
    "DeepResearchService",
    "ResearchEvent",
    "EventType",
    # Data models
    "Reference",
    "ReferenceType",
    "ReportSection",
    "ReportOutline",
    "ResearchReport",
    # Reference management
    "ReferenceManager",
]
