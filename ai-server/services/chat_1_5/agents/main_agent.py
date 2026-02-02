"""
Main Agent
==========

The MainAgent orchestrates Ask/Agent modes for Litewrite.

Features:
- Mode-based tool filtering (Ask vs Agent)
- SubAgent delegation via task tool
- Plan generation for complex tasks
- SSE event emission for frontend

Usage:
    context = ToolContext(project_id="xxx", user_id="yyy", _emitter=emitter)
    agent = MainAgent(context, mode="agent")
    result = await agent.run("Help me write an introduction")
"""

from typing import List, Optional, Dict, Any, Tuple
import logging

from services.chat_1_5.agents.base import BaseAgent, AgentConfig
from services.chat_1_5.prompts.main_agent import get_main_agent_prompt
from tools.base import Tool, ToolContext
from tools.registry import ToolRegistry

logger = logging.getLogger(__name__)


class MainAgent(BaseAgent):
    """
    Main orchestrating agent for Ask/Agent modes.

    Responsibilities:
    - Handle user queries
    - Select and execute appropriate tools
    - Delegate to SubAgents for complex tasks
    - Emit SSE events for frontend

    Tool availability by mode:
    - Ask mode: read_file, list_files, done, plan, web_search, arxiv_search
    - Agent mode: All above + edit_file, task (for SubAgent delegation)
    """

    name = "main_agent"

    def __init__(
        self,
        context: ToolContext,
        mode: str = "ask",
        agent_config: Optional[AgentConfig] = None,
    ):
        """
        Initialize the MainAgent.

        Args:
            context: Tool execution context
            mode: "ask" or "agent"
            agent_config: Optional configuration override
        """
        self.mode = mode

        # Call parent init first to set self.config
        super().__init__(context, agent_config)

        # Set system prompt based on mode, with actual max_turns from config
        self.system_prompt = get_main_agent_prompt(
            mode, max_turns=self.config.max_turns
        )

        logger.info(
            f"[MainAgent] Initialized in {mode} mode with {len(self._tools)} tools, max_turns={self.config.max_turns}"
        )

    def _get_tools(self) -> List[Tool]:
        """
        Get tools available for the current mode.

        Returns:
            List of Tool instances available in this mode
        """
        # Get tools from registry based on mode
        tools = ToolRegistry.get_tools_for_mode(self.mode)

        # Log available tools
        tool_names = [t.name for t in tools]
        logger.debug(f"[MainAgent] Available tools for {self.mode} mode: {tool_names}")

        return tools

    async def _on_loop_start(self):
        """
        Emit initial status event for frontend.

        Overrides BaseAgent._on_loop_start() to emit a "thinking" status
        event when the agent loop starts.

        Yields:
            Initial status event
        """
        yield {
            "type": "status",
            "data": {"status": "thinking", "message": "Processing..."},
        }

    def _log_turn_start(self) -> None:
        """
        Log turn start at debug level (internal detail, not for frontend).

        Overrides BaseAgent._log_turn_start() to use debug level.
        """
        logger.debug(f"[MainAgent] Turn {self.turn_count}/{self.config.max_turns}")

    async def _call_llm_with_retry(
        self,
    ) -> Tuple[Optional[str], Optional[str], Optional[List[Dict[str, Any]]]]:
        """
        Call LLM with single retry on empty response.

        Overrides BaseAgent._call_llm_with_retry() to add retry logic
        for improved reliability.

        Returns:
            Tuple of (user_text, full_content, tool_calls)
        """
        user_text, full_content, tool_calls = await self._call_llm()

        if full_content is None:
            # Retry once on empty response
            logger.warning("[MainAgent] LLM returned empty, retrying...")
            user_text, full_content, tool_calls = await self._call_llm()

            if full_content is None:
                logger.error("[MainAgent] LLM failed after retry")

        return user_text, full_content, tool_calls


__all__ = ["MainAgent"]
