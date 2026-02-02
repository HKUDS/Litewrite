"""
Read Agent
==========

Specialized SubAgent for file reading and analysis tasks.

Features:
- Read file contents
- List project files
- Analyze document structure
- Search for content patterns

Usage:
    agent = ReadAgent(context)
    result = await agent.run_task("Analyze the structure of main.tex")
"""

from typing import List, Optional
import logging

from services.chat_1_5.agents.sub_agent import SubAgent
from services.chat_1_5.agents.base import AgentConfig
from services.chat_1_5.prompts.read_agent import get_read_agent_prompt
from tools.base import Tool, ToolContext
from tools.registry import ToolRegistry

logger = logging.getLogger(__name__)


class ReadAgent(SubAgent):
    """
    SubAgent specialized for file reading and analysis.

    Tool set:
    - read_file: Read file contents
    - list_files: List project files
    - done: Signal task completion

    Use cases:
    - Analyzing document structure
    - Finding specific content
    - Understanding project layout
    - Summarizing file contents
    """

    name = "read_agent"
    description = "Specialized agent for file reading and document analysis. Use when you need to analyze multiple files or search for content across the project."

    # ReadAgent tools (done is required for explicit task completion)
    # Note: message tool removed - text output is handled automatically by the agent
    ALLOWED_TOOLS = ["read_file", "list_files", "done"]

    def __init__(
        self,
        context: ToolContext,
        agent_config: Optional[AgentConfig] = None,
    ):
        """Initialize ReadAgent with dynamic system prompt."""
        # Call parent init first to set self.config
        super().__init__(context, agent_config)

        # Set system prompt with actual max_turns
        self.system_prompt = get_read_agent_prompt(max_turns=self.config.max_turns)

    def _get_tools(self) -> List[Tool]:
        """
        Get tools for ReadAgent.

        Returns:
            List of Tool instances for reading operations
        """
        tools = []

        for tool_name in self.ALLOWED_TOOLS:
            tool = ToolRegistry.get(tool_name)
            if tool:
                tools.append(tool)
            else:
                logger.warning(f"[ReadAgent] Tool not found: {tool_name}")

        return tools


__all__ = ["ReadAgent"]
