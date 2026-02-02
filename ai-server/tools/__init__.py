"""
Tools - Unified Tool Layer
==========================

Provides a unified Tool interface for Agent systems.

Architecture:
- Tool: Abstract base class for all tools
- ToolResult: Standard result format
- ToolContext: Execution context with SSE emitter
- ToolRegistry: Central registry for tool management

All tools use LOCAL execution with direct HTTP calls to Next.js internal APIs.

Available Tools:
- done: Signal task completion
- read_file: Read project files (via Next.js internal API)
- edit_file: Edit project files (via Next.js internal API)
- list_files: List project files (via Next.js internal API)
- web_search: Search the web (local execution)
- arxiv_search: Search arXiv papers (local execution)
- plan: Create/update execution plans (Agent mode only)

Usage:
    from tools import ToolRegistry, ToolContext, register_all_tools

    # Initialize tools at startup
    register_all_tools()

    # Get tool definitions for OpenAI
    definitions = ToolRegistry.get_openai_definitions("agent")

    # Execute a tool
    tool = ToolRegistry.get("read_file")
    context = ToolContext(project_id="xxx", user_id="yyy")
    result = await tool.execute({"file_path": "main.tex"}, context)

Legacy Imports (for backward compatibility):
    from tools.arxiv_rag import arxiv_search
    from tools.web_search import web_search
"""

# Base classes
from tools.base import (
    Tool,
    ToolResult,
    ToolContext,
    ToolMode,
    ExecutorType,
)

# Registry
from tools.registry import (
    ToolRegistry,
    register_all_tools,
)

# Concrete Tools
from tools.done import DoneTool
from tools.read_file import ReadFileTool
from tools.edit_file import EditFileTool
from tools.list_files import ListFilesTool
from tools.web_search_tool import WebSearchToolWrapper
from tools.arxiv_search_tool import ArxivSearchToolWrapper
from tools.plan import PlanTool

# Legacy imports for backward compatibility
from tools.arxiv_rag import arxiv_search, ArxivRAGTool
from tools.web_search import web_search, WebSearchTool

__all__ = [
    # Base classes
    "Tool",
    "ToolResult",
    "ToolContext",
    "ToolMode",
    "ExecutorType",
    # Registry
    "ToolRegistry",
    "register_all_tools",
    # Concrete Tools
    "DoneTool",
    "ReadFileTool",
    "EditFileTool",
    "ListFilesTool",
    "WebSearchToolWrapper",
    "ArxivSearchToolWrapper",
    "PlanTool",
    # Legacy (backward compatibility)
    "arxiv_search",
    "ArxivRAGTool",
    "web_search",
    "WebSearchTool",
]
