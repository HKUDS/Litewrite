"""
Sub Agent Base Class
====================

Base class for specialized SubAgents.

SubAgents are stateless agents that:
- Execute specific types of tasks
- Have their own tool set
- Return results to MainAgent via Task Tool

Usage:
    class MySubAgent(SubAgent):
        name = "my_agent"
        description = "Handles specific tasks"
        system_prompt = "You are a specialized agent..."

        def _get_tools(self) -> List[Tool]:
            return [tool1, tool2]
"""

from typing import List, Optional
import logging

from services.chat_1_5.agents.base import BaseAgent, AgentConfig
from tools.base import Tool, ToolContext, ToolMode

logger = logging.getLogger(__name__)


class SubAgent(BaseAgent):
    """
    Base class for SubAgents.

    SubAgents are specialized agents that handle specific types of tasks.
    They are stateless - each invocation is independent.

    Key differences from MainAgent:
    - Simpler, more focused tool sets
    - Same max_turns as MainAgent (from AgentConfig, default: 20)
    - No access to task tool (prevents recursive SubAgent calls)
    - Results are returned to MainAgent as tool results

    Subclasses must define:
    - name: Unique identifier
    - description: Description for Task Tool
    - system_prompt: System prompt
    - _get_tools(): Available tools
    """

    # Class attributes (override in subclasses)
    name: str = "sub_agent"
    description: str = "A specialized sub-agent"
    system_prompt: str = "You are a helpful assistant."
    mode: ToolMode = ToolMode.ALL  # Which mode(s) this SubAgent is available in

    @classmethod
    def is_available_in_mode(cls, mode: str) -> bool:
        """
        Check if this SubAgent is available in the given mode.

        Args:
            mode: "ask" or "agent"

        Returns:
            True if SubAgent is available in that mode
        """
        if cls.mode == ToolMode.ALL:
            return True
        return cls.mode.value == mode

    def __init__(
        self,
        context: ToolContext,
        agent_config: Optional[AgentConfig] = None,
    ):
        """
        Initialize the SubAgent.

        Args:
            context: Tool execution context
            agent_config: Optional configuration override
        """
        super().__init__(context, agent_config)

        logger.info(f"[SubAgent:{self.name}] Initialized with {len(self._tools)} tools")

    async def run_task(self, task_prompt: str) -> str:
        """
        Execute a task and return the result.

        This is the main entry point called by Task Tool.

        Args:
            task_prompt: The task description from MainAgent

        Returns:
            Result text to return to MainAgent
        """
        logger.info(f"[SubAgent:{self.name}] Running task: {task_prompt[:100]}...")

        # Run the agent loop
        result = await self.run(task_prompt)

        logger.info(
            f"[SubAgent:{self.name}] Task completed, result length: {len(result)}"
        )

        return result

    def _get_tools(self) -> List[Tool]:
        """
        Get tools available to this SubAgent.

        Must be implemented by subclasses.
        Default implementation returns empty list.

        Returns:
            List of Tool instances
        """
        return []

    async def _generate_final_answer(self) -> str:
        """
        Generate final answer for SubAgent when max_turns reached.

        This is only called when SubAgent didn't call done tool explicitly.
        Instead of calling LLM again (extra cost), extract the last response
        from message history.
        """
        # Find the last assistant message in history
        for msg in reversed(self.message_history):
            if msg.role == "assistant" and msg.content.strip():
                # Return the last assistant response
                return f"[Max turns reached] {msg.content}"

        # Fallback if no assistant message found
        return "[Max turns reached] Task was not completed within the allowed iterations. Please try again with a simpler request."


__all__ = ["SubAgent"]
