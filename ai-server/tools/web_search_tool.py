"""
Web Search Tool Wrapper
=======================

Tool wrapper for web search functionality.

This wraps the existing WebSearchTool implementation to conform
to the unified Tool interface.

Features:
- Serper API search
- Content downloading and extraction
- Embedding-based reranking
- Local execution (no Next.js delegation)
"""

from typing import Dict, Any

from tools.base import Tool, ToolResult, ToolContext, ToolMode, ExecutorType
from tools.web_search import WebSearchTool


class WebSearchToolWrapper(Tool):
    """
    Tool wrapper for web search.

    Wraps the existing WebSearchTool implementation to provide
    a unified Tool interface.
    """

    name = "web_search"
    description = """Search the web for information. Use this when you need
up-to-date information from the internet, or when the user asks about
topics that require web research. Returns relevant web page content
with context."""

    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of results to return (default: 5)",
                "default": 5,
            },
        },
        "required": ["query"],
    }

    mode = ToolMode.ALL
    executor = ExecutorType.LOCAL

    def __init__(self, verbose: bool = False, download_content: bool = True):
        """
        Initialize the web search tool wrapper.

        Args:
            verbose: Whether to print detailed logs
            download_content: Whether to download full page content
        """
        self._tool = WebSearchTool(
            verbose=verbose,
            download_content=download_content,
        )

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        """
        Execute web search.

        Args:
            params: {"query": str, "max_results"?: int}
            context: Execution context

        Returns:
            ToolResult with search results and context
        """
        query = params.get("query")
        max_results = params.get("max_results", 5)

        if not query:
            return ToolResult(
                success=False,
                text="No search query provided",
                error="query is required",
            )

        # Emit status
        context.emit_status(f"Searching the web for: {query}")

        try:
            # Execute search using existing implementation
            result = await self._tool.search(
                query=query,
                max_results=max_results,
            )

            if not result.get("success"):
                return ToolResult(
                    success=False,
                    text=f"Web search failed: {result.get('error', 'Unknown error')}",
                    error=result.get("error"),
                )

            # Build result text for Agent
            context_text = result.get("context", "No results found.")
            results_count = result.get("results_found", 0)

            text = f"Web search results for '{query}' ({results_count} results):\n\n{context_text}"

            return ToolResult(
                success=True,
                text=text,
                data={
                    "query": query,
                    "results_found": results_count,
                    "results": result.get("results", []),
                },
            )

        except Exception as e:
            return ToolResult(
                success=False,
                text=f"Web search error: {str(e)}",
                error=str(e),
            )


__all__ = ["WebSearchToolWrapper"]
