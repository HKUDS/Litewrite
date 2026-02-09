"""
arXiv RAG data models
====================

Data structures for papers, text chunks, and retrieval results.

Components:
- ArxivPaper: paper metadata + raw content
- TextChunk: chunk with section info
- RAGResult: retrieval result (paper + relevant chunks)
"""

from dataclasses import dataclass, field
from typing import List, Optional, TYPE_CHECKING

# Avoid circular imports: only import numpy for type checking
if TYPE_CHECKING:
    import numpy as np


@dataclass
class ArxivPaper:
    """
        arXiv paper metadata.

    Includes:
        - Basic metadata (id, title, abstract, authors, year)
        - Raw LaTeX content
        - Chunked text
        - Relevance score
    """

    arxiv_id: str
    title: str
    abstract: str
    authors: List[str]
    year: int
    url: str
    categories: List[str] = field(default_factory=list)

    # Processed data
    latex_content: str = ""  # Raw LaTeX content
    latex_contents: List[str] = field(
        default_factory=list
    )  # Multiple-file content blobs
    chunks: List["TextChunk"] = field(default_factory=list)  # Chunk results
    relevance_score: float = 0.0  # Relevance to the query

    # Download state
    source_downloaded: bool = False

    def to_dict(self) -> dict:
        """Convert to dict."""
        return {
            "arxiv_id": self.arxiv_id,
            "title": self.title,
            "abstract": self.abstract,
            "authors": self.authors,
            "year": self.year,
            "url": self.url,
            "categories": self.categories,
            "relevance_score": self.relevance_score,
            "chunks_count": len(self.chunks),
            "source_downloaded": self.source_downloaded,
        }

    def __repr__(self) -> str:
        return f"ArxivPaper({self.arxiv_id}: {self.title[:50]}...)"


@dataclass
class TextChunk:
    """
        Text chunk.

    Chunking output containing:
        - Source paper ID
        - Chunk index
        - Text content
        - Section title (e.g. "Introduction", "Methods")
        - Embedding vector (for retrieval)
        - Relevance score
    """

    paper_id: str
    chunk_id: int
    text: str
    section: str = ""
    embedding: Optional["np.ndarray"] = None
    relevance_score: float = 0.0

    # Metadata
    char_count: int = 0

    def __post_init__(self):
        self.char_count = len(self.text)

    def to_dict(self) -> dict:
        """Convert to dict (excluding embedding)."""
        return {
            "paper_id": self.paper_id,
            "chunk_id": self.chunk_id,
            "text": self.text,
            "section": self.section,
            "relevance_score": self.relevance_score,
            "char_count": self.char_count,
        }

    def __repr__(self) -> str:
        preview = self.text[:50] + "..." if len(self.text) > 50 else self.text
        return f"TextChunk({self.paper_id}#{self.chunk_id} [{self.section}]: {preview})"


@dataclass
class RAGResult:
    """
        RAG retrieval result.

    Contains:
        - Paper metadata
        - Relevant chunks (sorted by relevance)
    """

    paper: ArxivPaper
    relevant_chunks: List[TextChunk]

    def to_context(self, max_chunks: int = 3, max_chunk_length: int = 1500) -> str:
        """
        Format as LLM context.

        Args:
            max_chunks: Max chunks
            max_chunk_length: Max length per chunk
        """
        context_parts = [
            f"{'=' * 60}",
            f"Paper: {self.paper.title} ({self.paper.year})",
            f"arXiv ID: {self.paper.arxiv_id}",
            f"Authors: {', '.join(self.paper.authors[:5])}",
            f"URL: {self.paper.url}",
            f"Relevance: {self.paper.relevance_score:.3f}",
            f"{'=' * 60}",
            "",
            "Abstract:",
            self.paper.abstract,
            "",
        ]

        # Add relevant excerpts
        chunks = self.relevant_chunks[:max_chunks]
        if chunks and not (len(chunks) == 1 and chunks[0].section == "Abstract"):
            context_parts.append("Relevant Excerpts:")
            for i, chunk in enumerate(chunks):
                context_parts.append(
                    f"\n--- [{chunk.section}] (relevance: {chunk.relevance_score:.3f}) ---"
                )
                chunk_text = chunk.text[:max_chunk_length]
                if len(chunk.text) > max_chunk_length:
                    chunk_text += "..."
                context_parts.append(chunk_text)

        return "\n".join(context_parts)

    def to_dict(self) -> dict:
        """Convert to dict."""
        return {
            "paper": self.paper.to_dict(),
            "relevant_chunks": [c.to_dict() for c in self.relevant_chunks],
        }

    def __repr__(self) -> str:
        return f"RAGResult({self.paper.arxiv_id}, {len(self.relevant_chunks)} chunks)"


__all__ = ["ArxivPaper", "TextChunk", "RAGResult"]
