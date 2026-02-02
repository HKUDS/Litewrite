"""
arXiv Search Tool Wrapper
=========================

Tool wrapper for arXiv paper search functionality.

This wraps the existing ArxivRAGTool implementation to conform
to the unified Tool interface.

Features:
- Natural language to keyword extraction
- arXiv API search
- Paper content downloading
- Embedding-based reranking
- Local execution (no Next.js delegation)
"""

from typing import Dict, Any

from tools.base import Tool, ToolResult, ToolContext, ToolMode, ExecutorType
from tools.arxiv_rag import ArxivRAGTool


class ArxivSearchToolWrapper(Tool):
    """
    Tool wrapper for arXiv search.

    Wraps the existing ArxivRAGTool implementation to provide
    a unified Tool interface.
    """

    name = "arxiv_search"
    description = """Search arXiv for academic papers related to a query.
Use this when you need to find research papers, understand academic topics,
or cite scientific work. Returns paper abstracts and relevant excerpts
from full paper content."""

    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query (can be natural language)",
            },
            "max_papers": {
                "type": "integer",
                "description": "Maximum number of papers to return (default: 5)",
                "default": 5,
            },
        },
        "required": ["query"],
    }

    mode = ToolMode.ALL  # Available in both modes for research
    executor = ExecutorType.LOCAL

    def __init__(self, verbose: bool = False, download_content: bool = True):
        """
        Initialize the arXiv search tool wrapper.

        Args:
            verbose: Whether to print detailed logs
            download_content: Whether to download paper content
        """
        self._tool = ArxivRAGTool(
            verbose=verbose,
            download_content=download_content,
        )

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        """
        Execute arXiv search.

        Args:
            params: {"query": str, "max_papers"?: int}
            context: Execution context

        Returns:
            ToolResult with paper information and context
        """
        query = params.get("query")
        max_papers = params.get("max_papers", 5)

        if not query:
            return ToolResult(
                success=False,
                text="No search query provided",
                error="query is required",
            )

        # Emit status
        context.emit_status(f"Searching arXiv for: {query}")

        try:
            # Execute search using existing implementation
            result = await self._tool.search(
                query=query,
                max_papers=max_papers,
            )

            if not result.get("success"):
                return ToolResult(
                    success=False,
                    text=f"arXiv search failed: {result.get('error', 'Unknown error')}",
                    error=result.get("error"),
                )

            # Build result text for Agent
            context_text = result.get("context", "No papers found.")
            papers_count = result.get("papers_found", 0)
            search_query = result.get("search_query", query)

            text = f"arXiv search results for '{query}' (searched: '{search_query}', {papers_count} papers):\n\n{context_text}"

            return ToolResult(
                success=True,
                text=text,
                data={
                    "query": query,
                    "search_query": search_query,
                    "keywords": result.get("keywords", []),
                    "papers_found": papers_count,
                    "papers": result.get("papers", []),
                },
            )

        except Exception as e:
            return ToolResult(
                success=False,
                text=f"arXiv search error: {str(e)}",
                error=str(e),
            )


__all__ = ["ArxivSearchToolWrapper"]
