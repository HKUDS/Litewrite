"""
Web Search Tool (full pipeline)
===============================

End-to-end web search + retrieval workflow:
1. Serper API search (search.py)
2. Web page download/extraction (content.py)
3. Chunking (chunker.py)
4. Embedding re-ranking
5. Rich context output

For algorithm work:
- Input: search query
- Output: formatted context (web snippets) and result metadata
"""

import asyncio
import logging
from typing import Dict, Any, List

from core import EmbeddingEngine

logger = logging.getLogger(__name__)

from tools.web_search.models import SearchResult, WebPage, TextChunk, WebRAGResult
from tools.web_search.search import WebSearchClient
from tools.web_search.content import WebContentProcessor
from tools.web_search.chunker import WebChunker


class WebSearchTool:
    """
    Web search tool (full pipeline).

    Features:
    - Serper API search
    - Web content download and extraction
    - Chunking
    - Two-stage re-ranking (page-level + chunk-level)
    - Rich context output

    Usage:
        tool = WebSearchTool()
        result = await tool.search("AI research trends")
        print(result["context"])  # rich context containing web snippets
    """

    def __init__(
        self,
        excluded_domains: List[str] = None,
        verbose: bool = False,
        download_content: bool = True,
    ):
        """
        Args:
            excluded_domains: Domains to exclude
            verbose: Enable verbose logging
            download_content: Whether to download web page content
        """
        self.search_client = WebSearchClient(excluded_domains=excluded_domains)
        self.content_processor = WebContentProcessor(verbose=verbose)
        self.chunker = WebChunker(chunk_size=2000, overlap=200)
        self.embedding_engine = EmbeddingEngine()
        self.verbose = verbose
        self.download_content = download_content

    def _log(self, message: str):
        if self.verbose:
            print(f"[WebSearch] {message}")

    async def _rerank_results_by_embedding(
        self, results: List[SearchResult], query: str, top_n: int = 5
    ) -> List[SearchResult]:
        """Re-rank search results by embedding similarity."""
        if not results:
            return []

        texts = [f"{r.title}. {r.snippet}" for r in results]

        query_emb = await self.embedding_engine.embed(query)
        result_embs = await self.embedding_engine.embed_batch(texts)

        for result, emb in zip(results, result_embs):
            result.relevance_score = self.embedding_engine.cosine_similarity(
                query_emb, emb
            )

        results.sort(key=lambda r: r.relevance_score, reverse=True)

        return results[:top_n]

    async def _rerank_chunks_by_embedding(
        self, chunks: List[TextChunk], query: str, top_n: int = 3
    ) -> List[TextChunk]:
        """Re-rank chunks by embedding similarity."""
        if not chunks:
            return []

        chunk_texts = [c.text for c in chunks]

        query_emb = await self.embedding_engine.embed(query)
        chunk_embs = await self.embedding_engine.embed_batch(chunk_texts)

        for chunk, emb in zip(chunks, chunk_embs):
            chunk.relevance_score = self.embedding_engine.cosine_similarity(
                query_emb, emb
            )

        chunks.sort(key=lambda c: c.relevance_score, reverse=True)

        return chunks[:top_n]

    async def _process_page_with_content(
        self, result: SearchResult, query: str
    ) -> WebRAGResult:
        """Process a single page: download content, chunk, and retrieve."""
        # Download web page content
        page = await self.content_processor.download(result)

        if page.content_downloaded and page.content:
            # Chunking
            chunks = self.chunker.chunk_page(page)
            self._log(f"  {page.url[:40]}...: {len(chunks)} chunks")

            if chunks:
                # Re-rank chunks (graceful fallback if embedding unavailable)
                try:
                    relevant_chunks = await self._rerank_chunks_by_embedding(
                        chunks, query, top_n=3
                    )
                except Exception as e:
                    logger.warning(f"Chunk rerank failed for {page.url[:40]}: {e}")
                    relevant_chunks = chunks[:3]
                page.chunks = chunks
                return WebRAGResult(page=page, relevant_chunks=relevant_chunks)

        # If download fails, fall back to snippet
        self._log(f"  {page.url[:40]}...: using snippet only")
        snippet_chunk = TextChunk(
            page_url=page.url,
            chunk_id=0,
            text=page.snippet,
            section="Summary",
            relevance_score=result.relevance_score,
        )
        return WebRAGResult(page=page, relevant_chunks=[snippet_chunk])

    async def search(
        self,
        query: str,
        max_results: int = 5,
        num_search: int = 10,
        max_chunks_per_page: int = 3,
    ) -> Dict[str, Any]:
        """
        Execute a web search (full pipeline).

        Args:
            query: Search query
            max_results: Number of results to return
            num_search: Initial search result count
            max_chunks_per_page: Max chunks per page

        Returns:
            {
                "success": bool,
                "query": str,
                "results_found": int,
                "context": str,  # rich context
                "results": [...]  # result metadata
            }
        """
        self._log(f"Searching: {query}")

        try:
            # 1) Search
            results = await self.search_client.search(query, num_results=num_search)
            self._log(f"Found {len(results)} results")

            if not results:
                return {
                    "success": False,
                    "query": query,
                    "results_found": 0,
                    "context": "No search results found.",
                    "results": [],
                }

            # 2) Result-level re-ranking (graceful fallback if embedding unavailable)
            try:
                results = await self._rerank_results_by_embedding(
                    results, query, top_n=max_results
                )
                self._log(f"Selected top {len(results)} results (reranked)")
            except Exception as e:
                self._log(f"Embedding rerank failed ({e}), using raw order")
                logger.warning(f"Embedding rerank failed, falling back to raw results: {e}")
                results = results[:max_results]

            # 3) Process each page (download, chunk, retrieve)
            rag_results: List[WebRAGResult] = []

            if self.download_content:
                # Download/process in parallel
                tasks = [self._process_page_with_content(r, query) for r in results]
                rag_results = await asyncio.gather(*tasks)
            else:
                # Snippet-only mode
                for result in results:
                    page = WebPage(
                        url=result.url,
                        title=result.title,
                        content="",
                        snippet=result.snippet,
                        favicon=result.favicon,
                        relevance_score=result.relevance_score,
                        content_downloaded=False,
                    )
                    snippet_chunk = TextChunk(
                        page_url=page.url,
                        chunk_id=0,
                        text=page.snippet,
                        section="Summary",
                        relevance_score=result.relevance_score,
                    )
                    rag_results.append(
                        WebRAGResult(page=page, relevant_chunks=[snippet_chunk])
                    )

            # 4) Build rich context
            context_parts = []
            results_meta = []

            for rag_result in rag_results:
                page = rag_result.page
                chunks = rag_result.relevant_chunks[:max_chunks_per_page]

                # Page context
                page_context = [
                    f"{'='*60}",
                    f"{page.title}",
                    f"URL: {page.url}",
                    f"Relevance: {page.relevance_score:.3f}",
                    f"{'='*60}",
                    "",
                ]

                if page.content_downloaded and chunks:
                    page_context.append("Relevant Content:")
                    for chunk in chunks:
                        page_context.append(
                            f"\n--- [{chunk.section or 'Content'}] (relevance: {chunk.relevance_score:.3f}) ---"
                        )
                        # Truncate overly long chunks
                        chunk_text = (
                            chunk.text[:2000] + "..."
                            if len(chunk.text) > 2000
                            else chunk.text
                        )
                        page_context.append(chunk_text)
                else:
                    page_context.append("Summary:")
                    page_context.append(page.snippet)

                context_parts.append("\n".join(page_context))

                # Result metadata
                results_meta.append(
                    {
                        "title": page.title,
                        "url": page.url,
                        "snippet": page.snippet,
                        "favicon": page.favicon,
                        "relevance_score": page.relevance_score,
                        "content_downloaded": page.content_downloaded,
                        "chunks_count": len(page.chunks) if page.chunks else 0,
                        "relevant_chunks": [
                            {
                                "section": c.section,
                                "relevance": c.relevance_score,
                                "text_preview": c.text[:200] + "..."
                                if len(c.text) > 200
                                else c.text,
                            }
                            for c in chunks
                        ],
                    }
                )

            return {
                "success": True,
                "query": query,
                "results_found": len(results),
                "context": "\n\n".join(context_parts),
                "results": results_meta,
            }

        except Exception as e:
            self._log(f"Error: {e}")
            import traceback

            traceback.print_exc()
            return {
                "success": False,
                "query": query,
                "results_found": 0,
                "context": f"Search error: {str(e)}",
                "results": [],
                "error": str(e),
            }


# ============================================================================
# Convenience helper
# ============================================================================


async def web_search(
    query: str,
    max_results: int = 5,
    excluded_domains: List[str] = None,
    verbose: bool = False,
    download_content: bool = True,
) -> Dict[str, Any]:
    """
    Convenience helper for web search.

    Args:
        query: Search query
        max_results: Number of results to return
        excluded_domains: Domains to exclude (defaults exclude arxiv.org)
        verbose: Enable verbose logging
        download_content: Whether to download web page content

    Returns:
        {
            "success": bool,
            "query": str,
            "results_found": int,
            "context": str,  # rich context
            "results": [...]
        }
    """
    tool = WebSearchTool(
        excluded_domains=excluded_domains,
        verbose=verbose,
        download_content=download_content,
    )
    return await tool.search(query, max_results=max_results)


__all__ = ["WebSearchTool", "web_search"]
