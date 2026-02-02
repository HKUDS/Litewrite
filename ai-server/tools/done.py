"""
Done Tool
=========

Tool for signaling task completion.

This tool allows the Agent to explicitly signal that it has completed
the user's request. When called, it sets should_stop=True in the result,
which tells the Agent loop to stop.

Usage by Agent:
    {"tool": "done", "params": {"summary": "Task completed successfully", "success": true}}
"""

from typing import Dict, Any
from tools.base import Tool, ToolResult, ToolContext, ToolMode, ExecutorType


class DoneTool(Tool):
    """
    Tool for signaling task completion.

    Features:
    - Signals end of Agent loop (should_stop=True)
    - Sends done event to frontend
    - Available in both Ask and Agent modes
    - Local execution
    """

    name = "done"
    description = """Call this tool when you have completed the user's request.
Provide a brief summary of what was accomplished and whether the task was successful.
This will end the current interaction."""

    parameters = {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "Brief summary of what was accomplished",
            },
            "success": {
                "type": "boolean",
                "description": "Whether the task was completed successfully",
                "default": True,
            },
        },
        "required": ["summary"],
    }

    mode = ToolMode.ALL
    executor = ExecutorType.LOCAL

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        """
        Execute the done tool - signal task completion.

        Args:
            params: {"summary": str, "success": bool}
            context: Execution context with emitter

        Returns:
            ToolResult with should_stop=True
        """
        summary = params.get("summary", "Task completed")
        success = params.get("success", True)

        # Emit done event to frontend
        # Note: conversationId should be added by the caller/Agent layer
        context.emit(
            "done",
            {
                "summary": summary,
                "success": success,
            },
        )

        return ToolResult(
            success=success,
            text=f"Task {'completed' if success else 'finished with issues'}: {summary}",
            should_stop=True,  # This tells the Agent to stop
            data={
                "summary": summary,
                "success": success,
            },
        )


__all__ = ["DoneTool"]
