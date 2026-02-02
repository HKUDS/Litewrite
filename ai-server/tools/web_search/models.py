"""
Web Search data models
=====================

Data structures for search results, web pages, and text chunks.
"""

from dataclasses import dataclass, field
from typing import List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np


@dataclass
class SearchResult:
    """Search result."""

    title: str
    url: str
    snippet: str
    favicon: str = ""
    position: int = 0
    relevance_score: float = 0.0

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "favicon": self.favicon,
            "relevance_score": self.relevance_score,
        }


@dataclass
class WebPage:
    """Web page content."""

    url: str
    title: str
    content: str  # Cleaned main text
    snippet: str = ""  # Search engine snippet
    favicon: str = ""

    # Processed data
    chunks: List["TextChunk"] = field(default_factory=list)
    relevance_score: float = 0.0
    content_downloaded: bool = False

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "title": self.title,
            "snippet": self.snippet,
            "favicon": self.favicon,
            "relevance_score": self.relevance_score,
            "content_downloaded": self.content_downloaded,
            "content_length": len(self.content),
            "chunks_count": len(self.chunks),
        }


@dataclass
class TextChunk:
    """Text chunk."""

    page_url: str
    chunk_id: int
    text: str
    section: str = ""
    embedding: Optional["np.ndarray"] = None
    relevance_score: float = 0.0

    def to_dict(self) -> dict:
        return {
            "page_url": self.page_url,
            "chunk_id": self.chunk_id,
            "text": self.text,
            "section": self.section,
            "relevance_score": self.relevance_score,
        }


@dataclass
class WebRAGResult:
    """Web RAG retrieval result."""

    page: WebPage
    relevant_chunks: List[TextChunk]

    def to_context(self, max_chunks: int = 3, max_chunk_length: int = 1500) -> str:
        """Format as LLM context."""
        context_parts = [
            f"{'='*60}",
            f"🌐 {self.page.title}",
            f"🔗 URL: {self.page.url}",
            f"📊 Relevance: {self.page.relevance_score:.3f}",
            f"{'='*60}",
            "",
        ]

        # If content wasn't downloaded, show snippet only
        if not self.page.content_downloaded:
            context_parts.append("📝 Summary:")
            context_parts.append(self.page.snippet)
        else:
            # Add relevant excerpts
            chunks = self.relevant_chunks[:max_chunks]
            if chunks:
                context_parts.append("📖 Relevant Content:")
                for chunk in chunks:
                    context_parts.append(
                        f"\n--- [{chunk.section or 'Content'}] (relevance: {chunk.relevance_score:.3f}) ---"
                    )
                    chunk_text = chunk.text[:max_chunk_length]
                    if len(chunk.text) > max_chunk_length:
                        chunk_text += "..."
                    context_parts.append(chunk_text)

        return "\n".join(context_parts)

    def to_dict(self) -> dict:
        return {
            "page": self.page.to_dict(),
            "relevant_chunks": [c.to_dict() for c in self.relevant_chunks],
        }


__all__ = ["SearchResult", "WebPage", "TextChunk", "WebRAGResult"]
