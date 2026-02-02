"""
Base Agent
==========

Abstract base class for all Agents with unified Agent Loop.

The Agent Loop follows the pattern from MiroFlow and qwen-code:
1. Send message to LLM
2. Check for tool calls
3. Execute tool calls
4. Update message history
5. Check stop conditions
6. Repeat or return final answer

Usage:
    class MyAgent(BaseAgent):
        name = "my_agent"
        system_prompt = "You are a helpful assistant."

        def _get_tools(self) -> List[Tool]:
            return [tool1, tool2]

    agent = MyAgent(context)
    result = await agent.run("Hello!")
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
import logging
import json

from tools.base import Tool, ToolResult, ToolContext, UsageAccumulator
from core.llm import get_llm_client
from core.config import config
from services.chat_1_5.agents.tool_parser import (
    parse_tool_calls,
    generate_tools_prompt,
    generate_tool_calling_instructions,
    format_tool_result,
    strip_legacy_json_blocks,
)
from services.chat_1_5.context_manager import (
    count_tokens,
    should_compress_execution,
    compress_execution_log,
    EXECUTION_LIMIT,
)

logger = logging.getLogger(__name__)


@dataclass
class AgentConfig:
    """Configuration for Agent behavior."""

    max_turns: int = 20
    temperature: float = 0.7
    max_tokens: int = 8192
    model: Optional[str] = None  # Use default from config if None

    def get_model(self) -> str:
        return self.model or config.llm_model


@dataclass
class Message:
    """
    A message in the conversation history.

    For Prompt-based Tool Calling, we use a simplified format:
    - system: System prompt (includes tool descriptions)
    - user: User messages and tool results
    - assistant: Assistant responses (may include JSON tool calls)
    """

    role: str  # "system", "user", "assistant"
    content: str

    def to_openai_format(self) -> Dict[str, Any]:
        """Convert to OpenAI API format (simple text messages)."""
        return {"role": self.role, "content": self.content}


class BaseAgent(ABC):
    """
    Abstract base class for Agents.

    Provides:
    - Unified Agent Loop
    - Message history management
    - Tool execution
    - LLM interaction
    - Credit deduction

    Subclasses must implement:
    - name: Agent identifier
    - system_prompt: System prompt for LLM
    - _get_tools(): Return list of available tools
    """

    # Class attributes (override in subclasses)
    name: str = "base_agent"
    system_prompt: str = "You are a helpful assistant."

    def __init__(
        self,
        context: ToolContext,
        agent_config: Optional[AgentConfig] = None,
    ):
        """
        Initialize the agent.

        Args:
            context: Tool execution context (project_id, user_id, emitter)
            agent_config: Optional configuration override
        """
        self.context = context
        self.config = agent_config or AgentConfig()

        # Instance variables - per-request state
        self.message_history: List[Message] = []
        self.turn_count: int = 0
        self.total_tokens_used: int = 0

        # Injected context from previous conversations (set by service.py)
        self.injected_context: Optional[str] = None

        # Execution context tracking for compression
        self._execution_logs: List[str] = []  # Raw execution log strings
        self._execution_tokens: int = 0  # Current execution context token count

        # Optional usage accumulation: use shared accumulator or create new one
        # SubAgents share the same accumulator with MainAgent for unified usage tracking
        if context._usage_accumulator is None:
            context._usage_accumulator = UsageAccumulator()
        self._accumulator = context._usage_accumulator

        # Get tools for this agent
        self._tools = self._get_tools()
        self._tool_map = {tool.name: tool for tool in self._tools}

    @abstractmethod
    def _get_tools(self) -> List[Tool]:
        """
        Get the list of tools available to this agent.

        Subclasses must implement this to define their tool set.

        Returns:
            List of Tool instances
        """
        pass

    def _get_tools_prompt(self) -> str:
        """
        Generate the tools description prompt for Prompt-based Tool Calling.

        Returns:
            Formatted string with tool descriptions and calling instructions
        """
        if not self._tools:
            return ""

        # Pass mode to generate_tools_prompt for mode-aware tools (like TaskTool)
        current_mode = self.context.mode if self.context else None

        parts = [
            generate_tools_prompt(self._tools, mode=current_mode),
            generate_tool_calling_instructions(),
        ]
        return "\n\n".join(parts)

    def _build_full_system_prompt(self) -> str:
        """
        Build the full system prompt including tool descriptions.

        Returns:
            Complete system prompt with base prompt + tool descriptions
        """
        tools_prompt = self._get_tools_prompt()

        if tools_prompt:
            return f"{self.system_prompt}\n\n{tools_prompt}"
        return self.system_prompt

    async def run(self, query: str) -> str:
        """
        Run the Agent Loop (non-streaming wrapper).

        Collects events from run_streaming() and returns the final response.
        Uses shared usage accumulation via run_streaming() (OSS: no payments/credits).

        Args:
            query: User's input query

        Returns:
            Final response text from the agent
        """
        logger.info(f"[{self.name}] Starting run with query: {query[:100]}...")

        result = ""
        async for event in self.run_streaming(query):
            event_type = event.get("type", "")
            event_data = event.get("data", {})

            if event_type == "message":
                # Handle both streaming format {"chunk": ...} and direct format {"content": ...}
                chunk = event_data.get("chunk") or event_data.get("content", "")
                if chunk:
                    result += chunk
            elif event_type == "error":
                return f"[Error] {event_data.get('message', 'Unknown error')}"
            elif event_type == "done":
                # Combine accumulated result with summary to preserve intermediate messages
                summary = event_data.get("summary", "")
                if result and summary:
                    return result + summary
                elif summary:
                    return summary
                # If no summary, continue to return result below

        return result or "[No response]"

    async def run_streaming(self, query: str):
        """
        Run the Agent Loop with streaming output.

        This is the core implementation. It's an async generator that yields
        events as the agent executes. Subclasses can override _agent_loop()
        to customize the agent loop behavior.

        Args:
            query: User's input query

        Yields:
            Dict events with type and data:
            - {"type": "status", "data": {"status": "...", "message": "..."}}
            - {"type": "message", "data": {"content": "..."}}
            - {"type": "error", "data": {"code": "...", "message": "..."}}
            - {"type": "warning", "data": {"message": "..."}}
            - {"type": "done", "data": {"summary": "...", "success": True}}
        """
        # OSS: payments/credits removed
        async for event in self._agent_loop(query):
            yield event

    async def _agent_loop(self, query: str):
        """
        Internal agent loop implementation (Template Method pattern).

        This is the core agent loop. Subclasses can customize behavior by
        overriding hook methods instead of duplicating the entire loop:
        - _on_loop_start(): Yield initial events (e.g., status event)
        - _call_llm_with_retry(): Custom LLM call with retry logic

        Args:
            query: User's input query

        Yields:
            Dict events with type and data
        """
        # Hook: yield initial events (subclasses can override)
        async for event in self._on_loop_start():
            yield event

        # Build full system prompt with tool descriptions
        full_system_prompt = self._build_full_system_prompt()

        # Format current goal with tags
        goal_content = f"<goal>\n{query}\n</goal>"

        # Initialize message history
        # Structure: [system prompt] -> [context (optional)] -> [goal]
        self.message_history = [
            Message(role="system", content=full_system_prompt),
        ]

        # Add injected context if available (from previous conversations)
        if self.injected_context:
            self.message_history.append(
                Message(role="system", content=self.injected_context)
            )

        # Add current goal
        self.message_history.append(Message(role="user", content=goal_content))

        self.turn_count = 0

        # Agent Loop
        while self.turn_count < self.config.max_turns:
            self.turn_count += 1
            self._log_turn_start()

            # 1. Call LLM with optional retry (subclasses can override)
            user_text, full_content, tool_calls = await self._call_llm_with_retry()

            if full_content is None:
                logger.error(f"[{self.name}] LLM call failed")
                yield {
                    "type": "error",
                    "data": {"message": "LLM call failed"},
                }
                return

            # 2. Emit user_text as message if present
            if user_text and user_text.strip():
                # Use streaming to emit the message
                await self.context.emit_message_streaming(
                    content=user_text.strip(),
                    chunk_size=10,
                    delay=0.02,
                )

            # 3. Check if there are tool calls
            if not tool_calls:
                # No tool calls - task is complete
                logger.info(f"[{self.name}] No tool calls, task complete")
                # Yield any collected events (from emit_message_streaming in non-streaming mode)
                collected_events = self.context.get_and_clear_events()
                for event in collected_events:
                    yield event
                # Set summary to empty string since content was already streamed above
                yield {
                    "type": "done",
                    "data": {"summary": "", "success": True},
                }
                return

            # 4. Execute tool calls
            tool_results = await self._execute_tool_calls(tool_calls)

            # 5. Yield any events collected by Tools (e.g., from DoneTool)
            collected_events = self.context.get_and_clear_events()
            for event in collected_events:
                yield event

            # 6. Update message history with assistant response and tool results
            await self._update_history_with_tool_calls(
                full_content, tool_calls, tool_results
            )

            # 7. Check stop conditions (done tool called)
            if self._should_stop(tool_results):
                logger.info(f"[{self.name}] Stop condition met (done tool called)")
                # For SubAgents, 'done' events are filtered in ToolContext.emit(),
                # so we need to yield the done event explicitly with extracted summary.
                # For non-SubAgents, the done event was already yielded via collected_events.
                if self.context._is_subagent:
                    summary = self._get_done_summary(tool_results)
                    yield {
                        "type": "done",
                        "data": {"summary": summary, "success": True},
                    }
                return

        # Max turns reached without calling done
        logger.warning(f"[{self.name}] Max turns ({self.config.max_turns}) reached")

        yield {
            "type": "warning",
            "data": {"message": f"Max turns ({self.config.max_turns}) reached"},
        }

        # Generate final answer when max_turns reached
        final = await self._generate_final_answer()
        yield {"type": "message", "data": {"chunk": final}}
        yield {"type": "done", "data": {"summary": "", "success": False}}

    async def _on_loop_start(self):
        """
        Hook method called at the start of the agent loop.

        Subclasses can override to yield initial events (e.g., status events).
        Default implementation yields nothing.

        Yields:
            Dict events with type and data
        """
        # Default: no initial events (empty async generator)
        if False:  # pragma: no cover
            yield  # Makes this an async generator

    def _log_turn_start(self) -> None:
        """
        Log the start of a new turn.

        Subclasses can override to change logging level or add extra logging.
        """
        logger.info(f"[{self.name}] Turn {self.turn_count}/{self.config.max_turns}")

    async def _call_llm_with_retry(
        self,
    ) -> Tuple[Optional[str], Optional[str], Optional[List[Dict[str, Any]]]]:
        """
        Call LLM with optional retry logic.

        Subclasses can override to add custom retry behavior.
        Default implementation calls _call_llm() once without retry.

        Returns:
            Tuple of (user_text, full_content, tool_calls)
        """
        return await self._call_llm()

    async def _call_llm(
        self,
    ) -> Tuple[Optional[str], Optional[str], Optional[List[Dict[str, Any]]]]:
        """
        Call the LLM with current message history.

        Uses Prompt-based Tool Calling - tools are described in the system prompt,
        and tool calls are parsed from <tool_call>...</tool_call> tags in the response.

        Returns:
            Tuple of (user_text, full_content, tool_calls)
            - user_text: Text to show to user (before tool calls)
            - full_content: Original full response (for history)
            - tool_calls: List of tool call dicts, or None if no tool calls
        """
        try:
            client = get_llm_client()

            # Build messages in OpenAI format (simple text messages)
            messages = [msg.to_openai_format() for msg in self.message_history]

            # Debug: Log full LLM input
            self._log_llm_request(messages)

            # Call LLM without tools parameter (Prompt-based Tool Calling)
            response = await client.chat.completions.create(
                model=self.config.get_model(),
                messages=messages,
                temperature=self.config.temperature,
                max_tokens=self.config.max_tokens,
            )

            # Extract response content
            choice = response.choices[0]
            content = choice.message.content or ""
            finish_reason = choice.finish_reason

            # Debug: Log full LLM output
            self._log_llm_response(content, response)

            # Check for empty response (API error or model issue)
            if not content.strip():
                logger.warning(
                    f"[{self.name}] LLM returned empty response! "
                    f"finish_reason={finish_reason}, "
                    f"model={response.model}"
                )
                # Return error indicator - caller should handle this
                return None, None, None

            # Parse tool calls - returns (text_before, tool_calls, text_after)
            # text_after is logged as warning inside parse_tool_calls if not empty
            user_text, tool_calls, _ = parse_tool_calls(content)

            return user_text, content, tool_calls

        except Exception as e:
            logger.error(f"[{self.name}] LLM call error: {e}")
            return None, None, None

    def _log_llm_request(self, messages: List[Dict[str, Any]]) -> None:
        """
        Log full LLM request for debugging.

        Only logs at DEBUG level - requires CHAT_DEBUG=1.
        """
        logger.debug(f"[{self.name}] {'='*60}")
        logger.debug(f"[{self.name}] LLM REQUEST - Turn {self.turn_count}")
        logger.debug(f"[{self.name}] Model: {self.config.get_model()}")
        logger.debug(f"[{self.name}] Messages: {len(messages)}")
        logger.debug(f"[{self.name}] {'-'*60}")

        for i, msg in enumerate(messages):
            role = msg.get("role", "unknown").upper()
            content = msg.get("content", "")

            logger.debug(f"[{self.name}] [{i}] {role}:")
            # Log content line by line for readability
            for line in content.split("\n"):
                logger.debug(f"[{self.name}]     {line}")
            logger.debug(f"[{self.name}]")

        logger.debug(f"[{self.name}] {'='*60}")

    def _log_llm_response(self, content: str, response: Any) -> None:
        """
        Log full LLM response for debugging.

        Only logs at DEBUG level - requires CHAT_DEBUG=1.
        """
        # Extract usage info
        usage = getattr(response, "usage", None)
        tokens_info = ""
        if usage:
            tokens_info = f" (tokens: {usage.prompt_tokens}+{usage.completion_tokens}={usage.total_tokens})"

        logger.debug(f"[{self.name}] {'='*60}")
        logger.debug(
            f"[{self.name}] LLM RESPONSE - Turn {self.turn_count}{tokens_info}"
        )
        logger.debug(f"[{self.name}] Content length: {len(content)} chars")
        logger.debug(f"[{self.name}] {'-'*60}")

        # Log content line by line
        for line in content.split("\n"):
            logger.debug(f"[{self.name}]     {line}")

        logger.debug(f"[{self.name}] {'='*60}")

    async def _execute_tool_calls(
        self, tool_calls: List[Dict[str, Any]]
    ) -> List[Tuple[str, ToolResult]]:
        """
        Execute a list of tool calls.

        Args:
            tool_calls: List of tool call dicts from LLM

        Returns:
            List of (tool_call_id, ToolResult) tuples
        """
        results = []

        for tc in tool_calls:
            call_id = tc["id"]
            func = tc["function"]
            tool_name = func["name"]

            try:
                # Parse arguments
                args_str = func["arguments"]
                args = json.loads(args_str) if args_str else {}
            except json.JSONDecodeError as e:
                logger.error(f"[{self.name}] Failed to parse tool args: {e}")
                results.append(
                    (
                        call_id,
                        ToolResult(
                            success=False,
                            text=f"Failed to parse arguments: {e}",
                            error=str(e),
                        ),
                    )
                )
                continue

            # Get the tool
            tool = self._tool_map.get(tool_name)
            if not tool:
                logger.warning(f"[{self.name}] Unknown tool: {tool_name}")
                results.append(
                    (
                        call_id,
                        ToolResult(
                            success=False,
                            text=f"Unknown tool: {tool_name}",
                            error=f"Tool '{tool_name}' not found",
                        ),
                    )
                )
                continue

            # Execute the tool
            logger.info(f"[{self.name}] Executing tool: {tool_name}")
            logger.debug(f"[{self.name}] Tool {tool_name} args: {args}")
            try:
                result = await tool.execute(args, self.context)
                results.append((call_id, result))
                logger.info(
                    f"[{self.name}] Tool {tool_name} result: success={result.success}"
                )
                # Log full result text in debug mode
                if result.text:
                    # Truncate long results
                    text_preview = (
                        result.text[:500] + "..."
                        if len(result.text) > 500
                        else result.text
                    )
                    logger.debug(
                        f"[{self.name}] Tool {tool_name} output:\n{text_preview}"
                    )
            except Exception as e:
                logger.error(f"[{self.name}] Tool {tool_name} error: {e}")
                results.append(
                    (
                        call_id,
                        ToolResult(
                            success=False,
                            text=f"Tool execution error: {e}",
                            error=str(e),
                        ),
                    )
                )

        return results

    async def _update_history_with_tool_calls(
        self,
        full_content: str,
        tool_calls: List[Dict[str, Any]],
        tool_results: List[Tuple[str, ToolResult]],
    ) -> None:
        """
        Update message history with execution log.

        Combines assistant's action and tool results into a single <execution_log>
        so the LLM clearly understands:
        - [YOUR ACTION]: What it already did (its own previous output)
        - [RESULT]: The outcome of those actions

        This prevents the LLM from repeating actions it has already performed.

        Also checks execution context token count and triggers compression if needed.

        Args:
            full_content: Full LLM response (including tool calls)
            tool_calls: Tool calls parsed from assistant response
            tool_results: Results of executing those tool calls
        """
        # Get the assistant content for history
        assistant_content = self._reconstruct_assistant_content(
            full_content, tool_calls
        )

        # Format tool results
        results_parts = []
        for call_id, result in tool_results:
            # Find the tool name for this call
            tool_name = "unknown"
            for tc in tool_calls:
                if tc["id"] == call_id:
                    tool_name = tc["function"]["name"]
                    break

            formatted = format_tool_result(tool_name, result.text, result.success)
            results_parts.append(formatted)

        tool_results_content = (
            "\n\n".join(results_parts) if results_parts else "(No results)"
        )

        # Create unified execution_log that clearly shows:
        # 1. This is what YOU (the LLM) already did
        # 2. These are the results
        # 3. Continue from here, don't repeat
        execution_log = f"""<execution_log turn="{self.turn_count}">
[YOUR ACTION]:
{assistant_content}

[RESULT]:
{tool_results_content}
</execution_log>

Continue based on the above execution log. Analyze the results and decide your NEXT action.
Do NOT repeat actions that already have results above."""

        # Track execution log for potential compression
        self._execution_logs.append(execution_log)
        log_tokens = count_tokens(execution_log)
        self._execution_tokens += log_tokens

        logger.debug(
            f"[{self.name}] Execution context: +{log_tokens} tokens, "
            f"total={self._execution_tokens}/{EXECUTION_LIMIT}"
        )

        # Check if execution context needs compression
        if should_compress_execution(self._execution_tokens):
            await self._compress_execution_context()

        self.message_history.append(
            Message(
                role="system",
                content=execution_log,
            )
        )

    async def _compress_execution_context(self) -> None:
        """
        Compress execution context when it exceeds threshold.

        Replaces individual execution_log messages with a single compressed summary.
        """
        logger.info(
            f"[{self.name}] Compressing execution context: "
            f"{self._execution_tokens} tokens exceeds threshold"
        )

        # Compress execution logs
        user_id = self.context.user_id if self.context else None
        project_id = self.context.project_id if self.context else None
        compressed, new_tokens = await compress_execution_log(
            self._execution_logs, user_id=user_id, project_id=project_id
        )

        # Remove old execution_log messages from history
        self.message_history = [
            msg
            for msg in self.message_history
            if not (msg.role == "system" and "<execution_log" in msg.content)
        ]

        # Add compressed summary as single message
        compressed_msg = f"""<execution_summary>
The following is a summary of previous execution steps:

{compressed}

Continue from here. Do NOT repeat actions mentioned in the summary.
</execution_summary>"""

        self.message_history.append(
            Message(
                role="system",
                content=compressed_msg,
            )
        )

        # Reset tracking
        self._execution_logs = [compressed]  # Keep compressed as base
        self._execution_tokens = new_tokens

        logger.info(
            f"[{self.name}] Execution context compressed: " f"now {new_tokens} tokens"
        )

    def _reconstruct_assistant_content(
        self,
        full_content: str,
        tool_calls: List[Dict[str, Any]],
    ) -> str:
        """
        Get the assistant content for history.

        Since we now pass the full_content directly (which already contains
        the original <tool_call> tags), we just return it as-is.

        If full_content doesn't contain <tool_call> tags (legacy format),
        we reconstruct using the new format.

        Args:
            full_content: Original full response from LLM
            tool_calls: Parsed tool calls (used for reconstruction if needed)

        Returns:
            Full content for history
        """
        # If content already has <tool_call> tags, return as-is
        if "<tool_call>" in full_content:
            return full_content

        # Legacy format - reconstruct with new format
        if not tool_calls:
            return full_content

        # Extract text part (remove legacy JSON blocks)
        text = strip_legacy_json_blocks(full_content)

        # Reconstruct with new format
        tool_list = []
        for tc in tool_calls:
            tool_name = tc["function"]["name"]
            args = json.loads(tc["function"]["arguments"])
            tool_list.append({"tool": tool_name, "params": args})

        tool_call_block = (
            f"<tool_call>\n{json.dumps(tool_list, indent=2)}\n</tool_call>"
        )

        if text:
            return f"{text}\n\n{tool_call_block}"
        return tool_call_block

    def _should_stop(self, tool_results: List[Tuple[str, ToolResult]]) -> bool:
        """
        Check if the agent should stop.

        Stops if any tool result has should_stop=True (e.g., done tool).

        Args:
            tool_results: Results from tool execution

        Returns:
            True if agent should stop
        """
        for _, result in tool_results:
            if result.should_stop:
                return True
        return False

    def _get_done_summary(self, tool_results: List[Tuple[str, ToolResult]]) -> str:
        """
        Extract the summary from tool results when done tool was called.

        This is needed for SubAgents where 'done' events are filtered out
        in ToolContext.emit(), so the done event never gets collected.
        We extract the summary directly from the tool result instead.

        Note: We extract from result.data["summary"] (the raw summary) rather than
        result.text (which includes "Task completed:" prefix) to maintain consistency
        with how MainAgents receive summaries from DoneTool.emit().

        Args:
            tool_results: Results from tool execution

        Returns:
            Summary string from the done tool result, or empty string if not found
        """
        for _, result in tool_results:
            if result.should_stop:
                # Extract raw summary from data to match DoneTool.emit() format
                # This ensures SubAgents and MainAgents receive consistent summary formats
                if result.data and "summary" in result.data:
                    return result.data["summary"]
                # Fallback to text if data.summary is not available
                if result.text:
                    return result.text
        return ""

    async def _generate_final_answer(self) -> str:
        """
        Generate a final answer when max turns reached without calling done.

        This is called when the agent loop ends without a natural response.
        Instead of calling LLM again (extra cost), extract the last response
        from message history.
        """
        # Find the last assistant message in history
        for msg in reversed(self.message_history):
            if msg.role == "assistant" and msg.content.strip():
                # Return the last assistant response with warning
                return f"[Max turns reached] {msg.content}"

        # Fallback if no assistant message found
        return "[Max turns reached] Task was not completed within the allowed iterations. Please try again with a simpler request."

    def get_message_history(self) -> List[Dict[str, Any]]:
        """Get message history in OpenAI format."""
        return [msg.to_openai_format() for msg in self.message_history]

    def get_stats(self) -> Dict[str, Any]:
        """Get agent execution statistics including accumulated usage."""
        totals = self._accumulator.get_total()
        return {
            "agent_name": self.name,
            "turns": self.turn_count,
            "total_tokens": self.total_tokens_used,
            "messages_count": len(self.message_history),
            "accumulated_cost": totals["cost"],
            "accumulated_input_tokens": totals["input_tokens"],
            "accumulated_output_tokens": totals["output_tokens"],
        }


__all__ = ["BaseAgent", "AgentConfig", "Message"]
