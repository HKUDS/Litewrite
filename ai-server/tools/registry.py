"""
Tool Registry
=============

Central registry for all available Tools.

Features:
- Register tools by name
- Get tools by name or mode
- Generate OpenAI-compatible tool definitions
- Singleton pattern for global access

Usage:
    from tools.registry import ToolRegistry

    # Register a tool
    ToolRegistry.register(MyTool())

    # Get a tool
    tool = ToolRegistry.get("my_tool")

    # Get all tools for a mode
    tools = ToolRegistry.get_tools_for_mode("agent")

    # Get OpenAI definitions
    definitions = ToolRegistry.get_openai_definitions("agent")
"""

from typing import Dict, List, Optional
from tools.base import Tool


class ToolRegistry:
    """
    Singleton registry for Tool instances.

    All tools should be registered here to be available to Agents.
    """

    _tools: Dict[str, Tool] = {}
    _initialized: bool = False

    @classmethod
    def register(cls, tool: Tool) -> None:
        """
        Register a tool instance.

        Args:
            tool: Tool instance to register

        Raises:
            ValueError: If tool with same name already registered
        """
        if not tool.name:
            raise ValueError(f"Tool must have a name: {tool}")

        if tool.name in cls._tools:
            # Allow re-registration (for hot reload)
            print(f"[ToolRegistry] Re-registering tool: {tool.name}")

        cls._tools[tool.name] = tool
        print(f"[ToolRegistry] Registered tool: {tool.name}")

    @classmethod
    def unregister(cls, name: str) -> bool:
        """
        Unregister a tool by name.

        Args:
            name: Tool name to unregister

        Returns:
            True if tool was unregistered, False if not found
        """
        if name in cls._tools:
            del cls._tools[name]
            return True
        return False

    @classmethod
    def get(cls, name: str) -> Optional[Tool]:
        """
        Get a tool by name.

        Args:
            name: Tool name

        Returns:
            Tool instance or None if not found
        """
        return cls._tools.get(name)

    @classmethod
    def get_all(cls) -> List[Tool]:
        """
        Get all registered tools.

        Returns:
            List of all Tool instances
        """
        return list(cls._tools.values())

    @classmethod
    def get_tools_for_mode(cls, mode: str) -> List[Tool]:
        """
        Get tools available for a specific mode.

        Args:
            mode: "ask" or "agent"

        Returns:
            List of Tool instances available in that mode
        """
        return [tool for tool in cls._tools.values() if tool.is_available_in_mode(mode)]

    @classmethod
    def get_openai_definitions(cls, mode: str) -> List[Dict]:
        """
        Generate OpenAI-compatible tool definitions for a mode.

        Args:
            mode: "ask" or "agent"

        Returns:
            List of tool definitions in OpenAI format
        """
        tools = cls.get_tools_for_mode(mode)
        return [tool.get_openai_schema() for tool in tools]

    @classmethod
    def get_tool_names(cls, mode: Optional[str] = None) -> List[str]:
        """
        Get names of registered tools.

        Args:
            mode: Optional mode filter

        Returns:
            List of tool names
        """
        if mode:
            return [tool.name for tool in cls.get_tools_for_mode(mode)]
        return list(cls._tools.keys())

    @classmethod
    def clear(cls) -> None:
        """Clear all registered tools (mainly for testing)."""
        cls._tools.clear()
        cls._initialized = False

    @classmethod
    def is_initialized(cls) -> bool:
        """Check if registry has been initialized."""
        return cls._initialized

    @classmethod
    def set_initialized(cls) -> None:
        """Mark registry as initialized."""
        cls._initialized = True


def register_all_tools() -> None:
    """
    Register all built-in tools.

    This function is called once at startup to populate the registry.
    """
    if ToolRegistry.is_initialized():
        return

    # Import and register tools
    # These imports are here to avoid circular dependencies
    # Note: Text output is handled directly by agent via context.emit_message_streaming()
    from tools.done import DoneTool
    from tools.read_file import ReadFileTool
    from tools.edit_file import EditFileTool
    from tools.list_files import ListFilesTool
    from tools.web_search_tool import WebSearchToolWrapper
    from tools.arxiv_search_tool import ArxivSearchToolWrapper
    from tools.plan import PlanTool
    from tools.task import TaskTool

    # Register all tools
    ToolRegistry.register(DoneTool())
    ToolRegistry.register(ReadFileTool())
    ToolRegistry.register(EditFileTool())
    ToolRegistry.register(ListFilesTool())
    ToolRegistry.register(WebSearchToolWrapper())
    ToolRegistry.register(ArxivSearchToolWrapper())
    ToolRegistry.register(PlanTool())
    ToolRegistry.register(TaskTool())

    ToolRegistry.set_initialized()
    print(f"[ToolRegistry] Initialized with {len(ToolRegistry.get_all())} tools")


__all__ = [
    "ToolRegistry",
    "register_all_tools",
]
