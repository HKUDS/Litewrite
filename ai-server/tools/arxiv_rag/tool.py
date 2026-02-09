"""
arXiv RAG Tool (full pipeline)
==============================

End-to-end arXiv retrieval-augmented generation workflow:
1. arXiv API search (search.py)
2. Paper content download (content.py)
3. Chunking (chunker.py)
4. Embedding re-ranking
5. Rich context output

For algorithm work:
- Input: natural language query
- Output: formatted context (paper text snippets) and paper metadata
"""

import json
import asyncio
import logging
from typing import Dict, Any, List, Tuple

from core import (
    get_llm_client,
    EmbeddingEngine,
    api_retry,
    LLM_MODEL,
)

logger = logging.getLogger(__name__)

from tools.arxiv_rag.models import ArxivPaper, TextChunk, RAGResult
from tools.arxiv_rag.search import ArxivSearchClient
from tools.arxiv_rag.content import ArxivContentProcessor
from tools.arxiv_rag.chunker import TextChunker


# ============================================================================
# arXiv RAG tool class
# ============================================================================


class ArxivRAGTool:
    """
    arXiv RAG tool (full pipeline).

    Features:
    - Natural language query -> keyword extraction (LLM)
    - arXiv API search
    - Paper content download (prefer HTML, fallback to LaTeX)
    - Chunking
    - Two-stage re-ranking (paper-level + chunk-level)
    - Rich context output

    Usage:
        tool = ArxivRAGTool()
        result = await tool.search("How do transformers work?")
        print(result["context"])  # rich context containing paper snippets
    """

    def __init__(self, verbose: bool = False, download_content: bool = True):
        """
        Args:
            verbose: Enable verbose logging
            download_content: Whether to download paper content (HTML/LaTeX)
        """
        self.search_client = ArxivSearchClient()
        self.content_processor = ArxivContentProcessor(verbose=verbose)
        self.chunker = TextChunker(chunk_size=2000, overlap=500)
        self.embedding_engine = EmbeddingEngine()
        self.llm_client = get_llm_client()
        self.verbose = verbose
        self.download_content = download_content

    def _log(self, message: str):
        if self.verbose:
            print(f"[ArxivRAG] {message}")

    @api_retry
    async def _extract_keywords(self, query: str) -> Tuple[str, List[str]]:
        """Extract keywords from a natural language query."""
        prompt = """You are an academic search expert. Extract keywords from the query for arXiv search.
Output JSON: {"search_query": "optimized query for arXiv", "keywords": ["key1", "key2", "key3"]}
Focus on technical terms, method names, and domain-specific vocabulary."""

        try:
            response = await self.llm_client.chat.completions.create(
                model=LLM_MODEL,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": f"Query: {query}"},
                ],
                response_format={"type": "json_object"},
                max_tokens=200,
            )

            data = json.loads(response.choices[0].message.content)
            return data.get("search_query", query), data.get("keywords", [])
        except Exception as e:
            logger.warning(f"[ArxivRAG] Keyword extraction failed: {e}")
            return query, []

    async def _rerank_papers_by_embedding(
        self, papers: List[ArxivPaper], query: str, top_n: int = 5
    ) -> List[ArxivPaper]:
        """Re-rank papers by embedding similarity."""
        if not papers:
            return []

        paper_texts = [f"{p.title}. {p.abstract}" for p in papers]

        query_emb = await self.embedding_engine.embed(query)
        paper_embs = await self.embedding_engine.embed_batch(paper_texts)

        for paper, emb in zip(papers, paper_embs):
            paper.relevance_score = self.embedding_engine.cosine_similarity(
                query_emb, emb
            )

        papers.sort(key=lambda p: p.relevance_score, reverse=True)

        return papers[:top_n]

    async def _rerank_chunks_by_embedding(
        self, chunks: List[TextChunk], query: str, top_n: int = 5
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

    async def _process_paper_with_content(
        self, paper: ArxivPaper, query: str
    ) -> RAGResult:
        """Process a single paper: download content, chunk, and retrieve."""
        # Download paper content (HTML or LaTeX)
        contents = self.content_processor.download(paper.arxiv_id)

        if contents:
            paper.latex_contents = contents
            paper.source_downloaded = True

            # Chunking
            chunks = self.chunker.chunk_paper(paper)
            self._log(f"  {paper.arxiv_id}: {len(chunks)} chunks")

            if chunks:
                # Re-rank chunks (graceful fallback if embedding unavailable)
                try:
                    relevant_chunks = await self._rerank_chunks_by_embedding(
                        chunks, query, top_n=3
                    )
                except Exception as e:
                    logger.warning(f"Chunk rerank failed for {paper.arxiv_id}: {e}")
                    relevant_chunks = chunks[:3]
                paper.chunks = chunks
                return RAGResult(paper=paper, relevant_chunks=relevant_chunks)

        # If download fails, fall back to abstract
        self._log(f"  {paper.arxiv_id}: using abstract only")
        abstract_chunk = TextChunk(
            paper_id=paper.arxiv_id,
            chunk_id=0,
            text=paper.abstract,
            section="Abstract",
            relevance_score=paper.relevance_score,
        )
        return RAGResult(paper=paper, relevant_chunks=[abstract_chunk])

    async def search(
        self,
        query: str,
        max_papers: int = 5,
        coarse_top_n: int = 20,
        max_chunks_per_paper: int = 3,
    ) -> Dict[str, Any]:
        """
        Execute an arXiv search (full pipeline).

        Args:
            query: Natural language query
            max_papers: Number of papers to return
            coarse_top_n: Coarse search result count
            max_chunks_per_paper: Max chunks per paper

        Returns:
            {
                "success": bool,
                "query": str,
                "papers_found": int,
                "context": str,  # rich context
                "papers": [...]  # paper metadata
            }
        """
        self._log(f"Searching: {query}")

        try:
            # 1) Extract keywords
            search_query, keywords = await self._extract_keywords(query)
            self._log(f"Search query: {search_query}")

            # 2) Coarse search
            papers = self.search_client.search(search_query, max_results=coarse_top_n)
            self._log(f"Found {len(papers)} papers from arXiv API")

            if not papers:
                return {
                    "success": False,
                    "query": query,
                    "papers_found": 0,
                    "context": "No relevant papers found on arXiv.",
                    "papers": [],
                }

            # 3) Paper-level re-ranking (graceful fallback if embedding unavailable)
            try:
                papers = await self._rerank_papers_by_embedding(
                    papers, query, top_n=max_papers
                )
                self._log(f"Selected top {len(papers)} papers (reranked)")
            except Exception as e:
                self._log(f"Embedding rerank failed ({e}), using raw order")
                logger.warning(
                    f"Embedding rerank failed, falling back to raw results: {e}"
                )
                papers = papers[:max_papers]

            # 4) Process each paper (download, chunk, retrieve)
            rag_results: List[RAGResult] = []

            if self.download_content:
                # Download/process in parallel
                tasks = [self._process_paper_with_content(p, query) for p in papers]
                rag_results = await asyncio.gather(*tasks)
            else:
                # Abstract-only mode
                for paper in papers:
                    abstract_chunk = TextChunk(
                        paper_id=paper.arxiv_id,
                        chunk_id=0,
                        text=paper.abstract,
                        section="Abstract",
                        relevance_score=paper.relevance_score,
                    )
                    rag_results.append(
                        RAGResult(paper=paper, relevant_chunks=[abstract_chunk])
                    )

            # 5) Build rich context
            context_parts = []
            papers_meta = []

            for result in rag_results:
                paper = result.paper
                chunks = result.relevant_chunks[:max_chunks_per_paper]

                # Paper context
                paper_context = [
                    f"{'=' * 60}",
                    f"[{paper.arxiv_id}] {paper.title}",
                    f"Authors: {', '.join(paper.authors[:5])}{'...' if len(paper.authors) > 5 else ''}",
                    f"Year: {paper.year}",
                    f"URL: {paper.url}",
                    f"Relevance: {paper.relevance_score:.3f}",
                    f"{'=' * 60}",
                    "",
                    "Abstract:",
                    paper.abstract,
                    "",
                ]

                # Add relevant chunks
                if chunks and not (
                    len(chunks) == 1 and chunks[0].section == "Abstract"
                ):
                    paper_context.append("Relevant Excerpts from Full Paper:")
                    for i, chunk in enumerate(chunks):
                        paper_context.append(
                            f"\n--- [{chunk.section}] (relevance: {chunk.relevance_score:.3f}) ---"
                        )
                        # Truncate overly long chunks
                        chunk_text = (
                            chunk.text[:2000] + "..."
                            if len(chunk.text) > 2000
                            else chunk.text
                        )
                        paper_context.append(chunk_text)

                context_parts.append("\n".join(paper_context))

                # Paper metadata
                papers_meta.append(
                    {
                        "arxiv_id": paper.arxiv_id,
                        "title": paper.title,
                        "authors": paper.authors[:5],
                        "year": paper.year,
                        "url": paper.url,
                        "categories": paper.categories,
                        "relevance_score": paper.relevance_score,
                        "source_downloaded": paper.source_downloaded,
                        "chunks_count": len(paper.chunks) if paper.chunks else 0,
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
                "search_query": search_query,
                "keywords": keywords,
                "papers_found": len(papers),
                "context": "\n\n".join(context_parts),
                "papers": papers_meta,
            }

        except Exception as e:
            self._log(f"Error: {e}")
            import traceback

            traceback.print_exc()
            return {
                "success": False,
                "query": query,
                "papers_found": 0,
                "context": f"Search error: {str(e)}",
                "papers": [],
                "error": str(e),
            }


# ============================================================================
# Convenience helper
# ============================================================================


async def arxiv_search(
    query: str,
    max_papers: int = 5,
    verbose: bool = False,
    download_content: bool = True,
) -> Dict[str, Any]:
    """
    Convenience helper for arXiv search.

    Args:
        query: Natural language query
        max_papers: Number of papers to return
        verbose: Enable verbose logging
        download_content: Whether to download paper content (HTML/LaTeX)

    Returns:
        {
            "success": bool,
            "query": str,
            "papers_found": int,
            "context": str,  # rich context
            "papers": [...]
        }
    """
    tool = ArxivRAGTool(verbose=verbose, download_content=download_content)
    return await tool.search(query, max_papers=max_papers)


__all__ = ["ArxivRAGTool", "arxiv_search"]
