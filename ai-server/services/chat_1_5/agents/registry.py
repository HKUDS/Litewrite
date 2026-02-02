"""
SubAgent Registry
=================

Central registry for SubAgent classes.

Features:
- Register SubAgent classes by name
- Get SubAgent class or instance
- List available SubAgents (for Task Tool)

Usage:
    from services.chat_1_5.agents.registry import SubAgentRegistry

    # Register a SubAgent class
    SubAgentRegistry.register(MySubAgent)

    # Get a SubAgent class
    agent_class = SubAgentRegistry.get("my_agent")

    # Create an instance
    agent = SubAgentRegistry.create("my_agent", context)

    # Get descriptions for Task Tool
    descriptions = SubAgentRegistry.get_descriptions()
"""

from typing import Dict, List, Optional, Type
import logging

from services.chat_1_5.agents.sub_agent import SubAgent
from tools.base import ToolContext

logger = logging.getLogger(__name__)


class SubAgentRegistry:
    """
    Singleton registry for SubAgent classes.

    All SubAgents should be registered here to be available
    for delegation via Task Tool.
    """

    _agents: Dict[str, Type[SubAgent]] = {}
    _initialized: bool = False

    @classmethod
    def register(cls, agent_class: Type[SubAgent]) -> None:
        """
        Register a SubAgent class.

        Args:
            agent_class: SubAgent class to register

        Raises:
            ValueError: If agent has no name
        """
        if not agent_class.name:
            raise ValueError(f"SubAgent must have a name: {agent_class}")

        if agent_class.name in cls._agents:
            logger.info(f"[SubAgentRegistry] Re-registering: {agent_class.name}")

        cls._agents[agent_class.name] = agent_class
        logger.info(f"[SubAgentRegistry] Registered: {agent_class.name}")

    @classmethod
    def unregister(cls, name: str) -> bool:
        """
        Unregister a SubAgent by name.

        Args:
            name: SubAgent name to unregister

        Returns:
            True if unregistered, False if not found
        """
        if name in cls._agents:
            del cls._agents[name]
            return True
        return False

    @classmethod
    def get(cls, name: str) -> Optional[Type[SubAgent]]:
        """
        Get a SubAgent class by name.

        Args:
            name: SubAgent name

        Returns:
            SubAgent class or None if not found
        """
        return cls._agents.get(name)

    @classmethod
    def create(cls, name: str, context: ToolContext) -> Optional[SubAgent]:
        """
        Create a SubAgent instance by name.

        Args:
            name: SubAgent name
            context: Tool execution context

        Returns:
            SubAgent instance or None if not found
        """
        agent_class = cls.get(name)
        if agent_class is None:
            return None
        return agent_class(context)

    @classmethod
    def get_all(cls) -> List[Type[SubAgent]]:
        """
        Get all registered SubAgent classes.

        Returns:
            List of SubAgent classes
        """
        return list(cls._agents.values())

    @classmethod
    def get_names(cls, mode: Optional[str] = None) -> List[str]:
        """
        Get names of registered SubAgents.

        Args:
            mode: Optional mode filter ("ask" or "agent")

        Returns:
            List of SubAgent names available in the given mode
        """
        if mode is None:
            return list(cls._agents.keys())

        return [
            name
            for name, agent_class in cls._agents.items()
            if agent_class.is_available_in_mode(mode)
        ]

    @classmethod
    def get_descriptions(cls, mode: Optional[str] = None) -> List[Dict[str, str]]:
        """
        Get descriptions of registered SubAgents.

        This is used by Task Tool to build its parameter schema.

        Args:
            mode: Optional mode filter ("ask" or "agent")

        Returns:
            List of dicts with name and description
        """
        agents = cls._agents.values()
        if mode is not None:
            agents = [a for a in agents if a.is_available_in_mode(mode)]

        return [
            {
                "name": agent_class.name,
                "description": agent_class.description,
            }
            for agent_class in agents
        ]

    @classmethod
    def get_descriptions_text(cls, mode: Optional[str] = None) -> str:
        """
        Get a formatted text of SubAgent descriptions.

        Args:
            mode: Optional mode filter ("ask" or "agent")

        Returns:
            Formatted string listing SubAgents available in the given mode
        """
        agents = list(cls._agents.values())
        if mode is not None:
            agents = [a for a in agents if a.is_available_in_mode(mode)]

        if not agents:
            return "No SubAgents available."

        lines = []
        for agent_class in agents:
            lines.append(f"- {agent_class.name}: {agent_class.description}")
        return "\n".join(lines)

    @classmethod
    def clear(cls) -> None:
        """Clear all registered SubAgents (mainly for testing)."""
        cls._agents.clear()
        cls._initialized = False

    @classmethod
    def is_initialized(cls) -> bool:
        """Check if registry has been initialized."""
        return cls._initialized

    @classmethod
    def set_initialized(cls) -> None:
        """Mark registry as initialized."""
        cls._initialized = True


def register_all_subagents() -> None:
    """
    Register all built-in SubAgents.

    This function is called at startup to populate the registry.
    """
    if SubAgentRegistry.is_initialized():
        return

    # Import and register SubAgents
    # These imports are here to avoid circular dependencies
    from services.chat_1_5.subagents.read_agent import ReadAgent
    from services.chat_1_5.subagents.edit_agent import EditAgent
    from services.chat_1_5.subagents.research_agent import ResearchAgent

    SubAgentRegistry.register(ReadAgent)
    SubAgentRegistry.register(EditAgent)
    SubAgentRegistry.register(ResearchAgent)

    SubAgentRegistry.set_initialized()
    logger.info(
        f"[SubAgentRegistry] Initialized with {len(SubAgentRegistry.get_all())} SubAgents"
    )


__all__ = [
    "SubAgentRegistry",
    "register_all_subagents",
]
