"""
SubAgent implementations for Chat Service 1.5.

SubAgents are specialized agents for specific tasks:
- ReadAgent: File reading and analysis
- EditAgent: File editing operations
- ResearchAgent: Web and academic search
"""

from services.chat_1_5.subagents.read_agent import ReadAgent
from services.chat_1_5.subagents.edit_agent import EditAgent
from services.chat_1_5.subagents.research_agent import ResearchAgent

__all__ = [
    "ReadAgent",
    "EditAgent",
    "ResearchAgent",
]
