"""
Web Search Tool (full)
======================

Web search + retrieval-augmented generation tool.

Module layout:
- search.py: Serper API search
- content.py: web page download & cleanup
- chunker.py: chunking
- models.py: data models
- tool.py: main RAG tool (composes the modules above)

Usage:
    from tools.web_search import web_search

    # Full mode (downloads page content; returns rich context)
    result = await web_search("AI research trends")
    print(result["context"])  # rich context containing web snippets
    print(result["results"])  # result metadata

    # Fast mode (snippet-only)
    result = await web_search("AI trends", download_content=False)
"""

# Public API
from tools.web_search.tool import web_search, WebSearchTool

# Search
from tools.web_search.search import WebSearchClient

# Content download
from tools.web_search.content import WebContentProcessor

# Chunking
from tools.web_search.chunker import WebChunker

# Data models
from tools.web_search.models import SearchResult, WebPage, TextChunk, WebRAGResult


__all__ = [
    # Public API
    "web_search",
    "WebSearchTool",
    # Search
    "WebSearchClient",
    # Content download
    "WebContentProcessor",
    # Chunking
    "WebChunker",
    # Data models
    "SearchResult",
    "WebPage",
    "TextChunk",
    "WebRAGResult",
]
