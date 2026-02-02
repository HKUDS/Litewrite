"""
Agent implementations for Chat Service 1.5.

Classes:
- BaseAgent: Abstract base class with unified Agent Loop
- MainAgent: Main orchestrating agent for Ask/Agent modes
- SubAgent: Base class for specialized sub-agents
- SubAgentRegistry: Registry for sub-agent classes
"""

from services.chat_1_5.agents.base import BaseAgent
from services.chat_1_5.agents.main_agent import MainAgent
from services.chat_1_5.agents.sub_agent import SubAgent
from services.chat_1_5.agents.registry import SubAgentRegistry

__all__ = [
    "BaseAgent",
    "MainAgent",
    "SubAgent",
    "SubAgentRegistry",
]
