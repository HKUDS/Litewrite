"""
Edit Agent
==========

Specialized SubAgent for file editing tasks.

Features:
- Read file contents before editing
- Make precise edits with line references
- Handle complex multi-part edits
- Ensure edits maintain document integrity

Usage:
    agent = EditAgent(context)
    result = await agent.run_task("Simplify the introduction in main.tex")
"""

from typing import List, Optional
import logging

from services.chat_1_5.agents.sub_agent import SubAgent
from services.chat_1_5.agents.base import AgentConfig
from services.chat_1_5.prompts.edit_agent import get_edit_agent_prompt
from tools.base import Tool, ToolMode, ToolContext
from tools.registry import ToolRegistry

logger = logging.getLogger(__name__)


class EditAgent(SubAgent):
    """
    SubAgent specialized for file editing operations.

    Tool set:
    - read_file: Read file contents (always before editing)
    - edit_file: Edit file contents
    - done: Signal task completion

    Use cases:
    - Complex multi-part edits
    - Refactoring document sections
    - Applying changes across multiple locations
    - Making edits that require careful analysis first
    """

    name = "edit_agent"
    description = "Specialized agent for file editing operations. Use when you need to make complex edits or modifications to documents."
    mode = ToolMode.AGENT  # Only available in Agent mode (requires edit_file)

    # EditAgent tools (done is required for explicit task completion)
    # Note: message tool removed - text output is handled automatically by the agent
    ALLOWED_TOOLS = ["read_file", "edit_file", "done"]

    def __init__(
        self,
        context: ToolContext,
        agent_config: Optional[AgentConfig] = None,
    ):
        """Initialize EditAgent with dynamic system prompt."""
        # Call parent init first to set self.config
        super().__init__(context, agent_config)

        # Set system prompt with actual max_turns
        self.system_prompt = get_edit_agent_prompt(max_turns=self.config.max_turns)

    def _get_tools(self) -> List[Tool]:
        """
        Get tools for EditAgent.

        Returns:
            List of Tool instances for editing operations
        """
        tools = []

        for tool_name in self.ALLOWED_TOOLS:
            tool = ToolRegistry.get(tool_name)
            if tool:
                tools.append(tool)
            else:
                logger.warning(f"[EditAgent] Tool not found: {tool_name}")

        return tools


__all__ = ["EditAgent"]
