"""
System Prompts for Chat Service 1.5 Agents.

Each agent has a specialized prompt tailored to its role:
- main_agent: Orchestrating prompt for MainAgent
- read_agent: File reading and analysis prompt
- edit_agent: File editing prompt
- research_agent: Research and search prompt

All prompts are generated dynamically with max_turns from AgentConfig.
Use the getter functions to generate prompts with actual config values.
"""

from services.chat_1_5.prompts.main_agent import get_main_agent_prompt
from services.chat_1_5.prompts.read_agent import get_read_agent_prompt
from services.chat_1_5.prompts.edit_agent import get_edit_agent_prompt
from services.chat_1_5.prompts.research_agent import get_research_agent_prompt

__all__ = [
    "get_main_agent_prompt",
    "get_read_agent_prompt",
    "get_edit_agent_prompt",
    "get_research_agent_prompt",
]
