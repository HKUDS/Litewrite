"""
arXiv RAG Tool (full)
=====================

arXiv search + retrieval-augmented generation tool.

Module layout:
- search.py: arXiv API search
- content.py: paper content download (HTML/LaTeX)
- chunker.py: chunking
- models.py: data models
- tool.py: main RAG tool (composes the modules above)

Usage:
    from tools.arxiv_rag import arxiv_search

    # Full mode (downloads content; returns rich context)
    result = await arxiv_search("transformer attention mechanism")
    print(result["context"])  # rich context containing paper snippets
    print(result["papers"])   # paper metadata

    # Fast mode (abstract-only)
    result = await arxiv_search("transformer", download_content=False)
"""

# Public API
from tools.arxiv_rag.tool import arxiv_search, ArxivRAGTool

# Search
from tools.arxiv_rag.search import ArxivSearchClient

# Content download
from tools.arxiv_rag.content import ArxivContentProcessor

# Chunking
from tools.arxiv_rag.chunker import TextChunker

# Data models
from tools.arxiv_rag.models import ArxivPaper, TextChunk, RAGResult


__all__ = [
    # Public API
    "arxiv_search",
    "ArxivRAGTool",
    # Search
    "ArxivSearchClient",
    # Content download
    "ArxivContentProcessor",
    # Chunking
    "TextChunker",
    # Data models
    "ArxivPaper",
    "TextChunk",
    "RAGResult",
]
