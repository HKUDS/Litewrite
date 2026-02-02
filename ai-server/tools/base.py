"""
Tool Base Classes
==================

Unified Tool Layer for Agent systems.

This module defines the base classes for all Tools:
- Tool: Abstract base class for all tools
- ToolResult: Standard result format returned by tools
- ToolContext: Execution context with SSE emitter capabilities

All tools now use LOCAL execution strategy with direct HTTP calls
to Next.js internal APIs (no SSE delegation needed).
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, Callable, List
from enum import Enum
import asyncio
import uuid
import logging

logger = logging.getLogger(__name__)


class ToolMode(str, Enum):
    """Tool availability mode"""

    ASK = "ask"  # Available in Ask mode only
    AGENT = "agent"  # Available in Agent mode only
    ALL = "all"  # Available in both modes


class ExecutorType(str, Enum):
    """Tool execution strategy"""

    LOCAL = "local"  # Execute locally in Python (may call external APIs)
    NEXTJS = "nextjs"  # Legacy: Delegate to Next.js via tool_call event (deprecated)


# Events that should be filtered out for SubAgents
# SubAgent 'done' events should not reach the frontend
SUBAGENT_FILTERED_EVENTS = {"done"}


class UsageAccumulator:
    """
    Accumulator for API usage costs.

    Shared between MainAgent and SubAgents to keep a single usage total
    for the session (optional).

    Note: This class is used in async-only contexts where agents and
    sub-agents run sequentially within a single event loop. No thread
    synchronization is needed.

    Usage:
        accumulator = UsageAccumulator()
        accumulator.add(cost=0.001, input_tokens=100, output_tokens=50, model="gpt-4")
        # ... more calls ...
        total = accumulator.get_total()  # Get accumulated values
    """

    def __init__(self):
        self._cost: float = 0.0
        self._input_tokens: int = 0
        self._output_tokens: int = 0
        self._model: str = ""

    def add(
        self,
        cost: float,
        input_tokens: int,
        output_tokens: int,
        model: str,
    ) -> None:
        """
        Add usage to the accumulator.

        Args:
            cost: API cost in dollars
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
            model: Model name (last one is kept)
        """
        self._cost += cost
        self._input_tokens += input_tokens
        self._output_tokens += output_tokens
        if model:
            self._model = model

    def get_total(self) -> Dict[str, Any]:
        """
        Get accumulated totals.

        Returns:
            Dict with cost, input_tokens, output_tokens, model
        """
        return {
            "cost": self._cost,
            "input_tokens": self._input_tokens,
            "output_tokens": self._output_tokens,
            "model": self._model,
        }

    def is_empty(self) -> bool:
        """Check if accumulator has any usage."""
        return self._cost <= 0 and self._input_tokens <= 0

    def __repr__(self) -> str:
        return (
            f"<UsageAccumulator cost=${self._cost:.6f} "
            f"tokens={self._input_tokens}+{self._output_tokens}>"
        )


@dataclass
class ToolResult:
    """
    Standard result format for tool execution.

    Attributes:
        success: Whether the tool executed successfully
        text: Human-readable result text (returned to Agent for reasoning)
        data: Optional structured data
        should_stop: If True, Agent should stop its loop (used by done tool)
        error: Error message if success is False
    """

    success: bool
    text: str
    data: Optional[Dict[str, Any]] = None
    should_stop: bool = False
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "success": self.success,
            "text": self.text,
        }
        if self.data:
            result["data"] = self.data
        if self.error:
            result["error"] = self.error
        if self.should_stop:
            result["should_stop"] = True
        return result


@dataclass
class ToolContext:
    """
    Execution context for tools.

    Provides:
    - Project and user information
    - Mode (ask/agent)
    - SSE event emitter for frontend communication
    - Event collection for streaming mode
    - Shared usage accumulator (optional)

    Attributes:
        project_id: Current project ID
        user_id: Current user ID
        mode: Execution mode ("ask" or "agent")
        _emitter: SSE event emitter function (optional)
        _collected_events: List to collect events when no emitter is provided
        _is_subagent: Whether this context is for a SubAgent (internal flag)
        _usage_accumulator: Shared accumulator for session usage (optional)
    """

    project_id: str
    user_id: Optional[str] = None
    mode: str = "ask"
    _emitter: Optional[Callable[[str, Dict[str, Any]], None]] = None
    _collected_events: List[Dict[str, Any]] = field(default_factory=list)
    _is_subagent: bool = False
    _usage_accumulator: Optional[UsageAccumulator] = None

    def emit(self, event_type: str, data: Dict[str, Any]) -> None:
        """
        Emit an SSE event to the frontend.

        If an emitter is provided, sends directly.
        Otherwise, collects events for later retrieval via get_and_clear_events().

        For SubAgent contexts, 'done' events are filtered out to prevent
        SubAgent completion from being sent to frontend.

        Args:
            event_type: Event type (e.g., "status", "message", "file_edit")
            data: Event data payload
        """
        # Filter 'done' events from SubAgents (regardless of emitter presence)
        if self._is_subagent and event_type in SUBAGENT_FILTERED_EVENTS:
            return

        if self._emitter:
            self._emitter(event_type, data)
        else:
            # Collect events for streaming mode
            self._collected_events.append({"type": event_type, "data": data})

    def get_and_clear_events(self) -> List[Dict[str, Any]]:
        """
        Get all collected events and clear the collection.

        This is used by run_streaming to yield events emitted by Tools.

        Returns:
            List of collected events
        """
        events = self._collected_events.copy()
        self._collected_events.clear()
        return events

    def emit_status(self, message: str, status: str = "working") -> None:
        """
        Emit a status update event.

        Args:
            message: Status message
            status: Status type (default: "working")
        """
        self.emit("status", {"status": status, "message": message})

    async def emit_message_streaming(
        self,
        content: str,
        chunk_size: int = 10,
        delay: float = 0.02,
        message_id: Optional[str] = None,
    ) -> None:
        """
        Emit message content with fake streaming effect.

        Args:
            content: Full message content
            chunk_size: Characters per chunk
            delay: Delay between chunks in seconds
            message_id: Message ID for frontend to track
        """
        msg_id = message_id or f"msg_{uuid.uuid4().hex[:8]}"

        for i in range(0, len(content), chunk_size):
            chunk = content[i : i + chunk_size]
            self.emit("message", {"chunk": chunk, "messageId": msg_id})
            await asyncio.sleep(delay)

    def emit_tool_call(self, calls: List[Dict[str, Any]]) -> None:
        """
        Emit tool_call event for Next.js delegation.

        Args:
            calls: List of tool calls, each with id, type, params
        """
        self.emit("tool_call", {"calls": calls})

    def accumulate_usage(
        self,
        cost: float,
        input_tokens: int,
        output_tokens: int,
        model: str,
    ) -> bool:
        """
        Accumulate usage to the shared accumulator if available.

        This is used by tools that make their own LLM calls (e.g., edit_file, plan)
        to contribute their usage to the session total (optional).

        Args:
            cost: API cost in dollars
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
            model: Model name

        Returns:
            True if accumulated (accumulator exists), False otherwise
        """
        if self._usage_accumulator is not None:
            self._usage_accumulator.add(
                cost=cost,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                model=model,
            )
            return True
        return False

    async def record_usage_from_response(
        self,
        response: Any,
        action: str,
        tool_name: str = "tool",
    ) -> None:
        """
        Extract usage from an LLM response and optionally accumulate it.

        OSS variant: there is no payments/credits system. This helper exists only
        to keep tool implementations consistent and to optionally accumulate
        token usage when a usage accumulator is present.

        Args:
            response: LLM response object (e.g., from OpenAI/OpenRouter)
            action: Action name for optional usage tracking (e.g., "edit_summary", "plan_generation")
            tool_name: Tool name for logging (e.g., "Edit", "Plan")
        """
        # OSS: payments/credits removed.
        return

    def for_subagent(self) -> "ToolContext":
        """
        Create a new ToolContext for SubAgent execution.

        The returned context:
        - Shares the same project_id, user_id, mode
        - Uses the same emitter (filtering is handled by emit() via _is_subagent flag)
        - Has its own _collected_events list
        - Is marked as _is_subagent=True
        - Shares the same _usage_accumulator for unified usage tracking

        This prevents SubAgent's 'done' tool from sending done events
        to the frontend, while still allowing other events (file_edit,
        status, file_locked, etc.) to pass through.

        Returns:
            New ToolContext suitable for SubAgent execution
        """
        # Pass the real emitter - filtering of 'done' events is handled
        # by emit() method via the _is_subagent flag
        return ToolContext(
            project_id=self.project_id,
            user_id=self.user_id,
            mode=self.mode,
            _emitter=self._emitter,
            _collected_events=[],  # SubAgent has its own event collection
            _is_subagent=True,
            _usage_accumulator=self._usage_accumulator,  # Share accumulator for unified usage tracking
        )


class Tool(ABC):
    """
    Abstract base class for all Tools.

    Subclasses must implement:
    - name: Tool name (used in function calling)
    - description: Description for LLM
    - parameters: JSON Schema for parameters
    - execute(): Async execution method

    Class Attributes:
        name: Tool identifier
        description: Human-readable description for LLM
        parameters: JSON Schema dict for tool parameters
        mode: Availability mode (ask/agent/all)
        executor: Execution strategy (local/nextjs)
    """

    name: str = ""
    description: str = ""
    parameters: Dict[str, Any] = {}
    mode: ToolMode = ToolMode.ALL
    executor: ExecutorType = ExecutorType.LOCAL

    @abstractmethod
    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        """
        Execute the tool.

        Args:
            params: Tool parameters (validated against self.parameters schema)
            context: Execution context with emitter and project info

        Returns:
            ToolResult with success status and result text
        """
        pass

    def get_openai_schema(self) -> Dict[str, Any]:
        """
        Generate OpenAI function calling schema.

        Returns:
            Dict in OpenAI tool format
        """
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def is_available_in_mode(self, mode: str) -> bool:
        """
        Check if tool is available in the given mode.

        Args:
            mode: "ask" or "agent"

        Returns:
            True if tool is available
        """
        if self.mode == ToolMode.ALL:
            return True
        return self.mode.value == mode

    def get_prompt_description(self) -> str:
        """
        Generate a prompt-friendly description of the tool.

        This is used for Prompt-based Tool Calling, where tools are
        described in the system prompt rather than via API parameters.

        Returns:
            Formatted string describing the tool and its parameters
        """
        lines = [f"## {self.name}", self.description, ""]

        if self.parameters and "properties" in self.parameters:
            lines.append("Parameters:")
            props = self.parameters["properties"]
            required = self.parameters.get("required", [])

            for param_name, param_info in props.items():
                param_type = param_info.get("type", "any")
                param_desc = param_info.get("description", "")
                is_required = param_name in required
                req_marker = "(required)" if is_required else "(optional)"

                # Handle enum types
                if "enum" in param_info:
                    enum_values = ", ".join(f'"{v}"' for v in param_info["enum"])
                    lines.append(
                        f"- `{param_name}` ({param_type}, {req_marker}): {param_desc} [values: {enum_values}]"
                    )
                else:
                    lines.append(
                        f"- `{param_name}` ({param_type}, {req_marker}): {param_desc}"
                    )

            lines.append("")

        return "\n".join(lines)

    def __repr__(self) -> str:
        return (
            f"<Tool {self.name} mode={self.mode.value} executor={self.executor.value}>"
        )


__all__ = [
    "Tool",
    "ToolResult",
    "ToolContext",
    "ToolMode",
    "ExecutorType",
    "UsageAccumulator",
    "SUBAGENT_FILTERED_EVENTS",
]
