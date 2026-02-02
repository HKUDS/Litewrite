"""
Research Agent
==============

Specialized SubAgent for web and academic search tasks.

Features:
- Web search for general information
- arXiv search for academic papers
- Compile and summarize findings
- Suggest citations

Usage:
    agent = ResearchAgent(context)
    result = await agent.run_task("Find papers about transformer architectures")
"""

from typing import List, Optional
import logging

from services.chat_1_5.agents.sub_agent import SubAgent
from services.chat_1_5.agents.base import AgentConfig
from services.chat_1_5.prompts.research_agent import get_research_agent_prompt
from tools.base import Tool, ToolContext
from tools.registry import ToolRegistry

logger = logging.getLogger(__name__)


class ResearchAgent(SubAgent):
    """
    SubAgent specialized for research and search tasks.

    Tool set:
    - web_search: Search the web
    - arxiv_search: Search arXiv
    - done: Signal task completion

    Use cases:
    - Finding academic references
    - Researching topics
    - Gathering background information
    - Compiling literature reviews
    """

    name = "research_agent"
    description = "Specialized agent for web and academic search. Use when you need to find information, research topics, or gather academic references."

    # ResearchAgent tools (done is required for explicit task completion)
    # Note: message tool removed - text output is handled automatically by the agent
    ALLOWED_TOOLS = ["web_search", "arxiv_search", "done"]

    def __init__(
        self,
        context: ToolContext,
        agent_config: Optional[AgentConfig] = None,
    ):
        """Initialize ResearchAgent with dynamic system prompt."""
        # Call parent init first to set self.config
        super().__init__(context, agent_config)

        # Set system prompt with actual max_turns
        self.system_prompt = get_research_agent_prompt(max_turns=self.config.max_turns)

    def _get_tools(self) -> List[Tool]:
        """
        Get tools for ResearchAgent.

        Returns:
            List of Tool instances for research operations
        """
        tools = []

        for tool_name in self.ALLOWED_TOOLS:
            tool = ToolRegistry.get(tool_name)
            if tool:
                tools.append(tool)
            else:
                logger.warning(f"[ResearchAgent] Tool not found: {tool_name}")

        return tools


__all__ = ["ResearchAgent"]
