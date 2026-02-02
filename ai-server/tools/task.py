"""
Task Tool
=========

Tool for delegating tasks to specialized SubAgents.

This tool allows the MainAgent to delegate complex tasks to
specialized SubAgents that have focused tool sets and expertise.

Usage by Agent:
    {
        "tool": "task",
        "params": {
            "agent_type": "read_agent",
            "task_prompt": "Analyze the structure of main.tex and find all sections"
        }
    }

Returns:
    The result text from the SubAgent execution.
"""

from typing import Dict, Any
import logging

from tools.base import Tool, ToolResult, ToolContext, ToolMode, ExecutorType

logger = logging.getLogger(__name__)


class TaskTool(Tool):
    """
    Tool for delegating tasks to SubAgents.

    Features:
    - Dynamically discovers available SubAgents based on current mode
    - Creates SubAgent instances on demand
    - Passes ToolContext for SSE event routing
    - Returns SubAgent results as tool results

    Available in both Ask and Agent modes, but with different SubAgents:
    - Ask mode: read_agent, research_agent
    - Agent mode: read_agent, edit_agent, research_agent
    """

    name = "task"
    description_template = """Delegate a task to a specialized SubAgent.

Use this tool when you need to:
- Perform complex file analysis (use read_agent)
- Make complex multi-part edits (use edit_agent, Agent mode only)
- Research and search for information (use research_agent)

The SubAgent will execute the task and return a summary of results.

Available SubAgents:
{subagent_descriptions}
"""

    # Will be set dynamically
    description = description_template

    parameters = {
        "type": "object",
        "properties": {
            "agent_type": {
                "type": "string",
                "description": "The SubAgent to delegate to",
                "enum": [],  # Populated dynamically based on mode
            },
            "task_prompt": {
                "type": "string",
                "description": "Detailed description of the task for the SubAgent",
            },
        },
        "required": ["agent_type", "task_prompt"],
    }

    mode = ToolMode.ALL  # Available in both Ask and Agent modes
    executor = ExecutorType.LOCAL  # Executes locally

    def __init__(self):
        """Initialize with default schema."""
        super().__init__() if hasattr(super(), "__init__") else None
        # Initialize with all SubAgents (will be filtered at runtime)
        self._update_schema_for_mode(None)

    def _update_schema_for_mode(self, mode: str = None) -> None:
        """
        Update the parameters schema with SubAgents available in the given mode.

        Args:
            mode: "ask" or "agent", or None for all
        """
        try:
            from services.chat_1_5.agents.registry import (
                SubAgentRegistry,
                register_all_subagents,
            )

            # Ensure SubAgents are registered
            register_all_subagents()

            # Get SubAgent names and descriptions for this mode
            names = SubAgentRegistry.get_names(mode)
            descriptions_text = SubAgentRegistry.get_descriptions_text(mode)

            # Update enum
            self.parameters["properties"]["agent_type"]["enum"] = names

            # Update description
            self.description = self.description_template.format(
                subagent_descriptions=descriptions_text
            )

        except Exception as e:
            logger.warning(f"[TaskTool] Failed to update schema: {e}")
            # Use defaults
            if mode == "ask":
                self.parameters["properties"]["agent_type"]["enum"] = [
                    "read_agent",
                    "research_agent",
                ]
                self.description = self.description_template.format(
                    subagent_descriptions="- read_agent: File reading and analysis\n- research_agent: Web and academic search"
                )
            else:
                self.parameters["properties"]["agent_type"]["enum"] = [
                    "read_agent",
                    "edit_agent",
                    "research_agent",
                ]
                self.description = self.description_template.format(
                    subagent_descriptions="- read_agent: File reading and analysis\n- edit_agent: File editing\n- research_agent: Web and academic search"
                )

    async def execute(
        self,
        params: Dict[str, Any],
        context: ToolContext,
    ) -> ToolResult:
        """
        Execute the task by delegating to a SubAgent.

        Args:
            params: Tool parameters (agent_type, task_prompt)
            context: Tool execution context

        Returns:
            ToolResult with SubAgent's response
        """
        agent_type = params.get("agent_type")
        task_prompt = params.get("task_prompt")
        current_mode = context.mode

        # Validate parameters
        if not agent_type:
            return ToolResult(
                success=False,
                text="No agent_type specified",
                error="agent_type is required",
            )

        if not task_prompt:
            return ToolResult(
                success=False,
                text="No task_prompt specified",
                error="task_prompt is required",
            )

        logger.info(
            f"[TaskTool] Delegating to {agent_type} in {current_mode} mode: {task_prompt[:100]}..."
        )

        try:
            # Import registry
            from services.chat_1_5.agents.registry import (
                SubAgentRegistry,
                register_all_subagents,
            )

            # Ensure SubAgents are registered
            register_all_subagents()

            # Check if SubAgent is available in current mode
            agent_class = SubAgentRegistry.get(agent_type)
            if agent_class is None:
                available = SubAgentRegistry.get_names(current_mode)
                return ToolResult(
                    success=False,
                    text=f"Unknown SubAgent: {agent_type}. Available in {current_mode} mode: {', '.join(available)}",
                    error=f"SubAgent '{agent_type}' not found",
                )

            if not agent_class.is_available_in_mode(current_mode):
                available = SubAgentRegistry.get_names(current_mode)
                return ToolResult(
                    success=False,
                    text=f"SubAgent '{agent_type}' is not available in {current_mode} mode. Available: {', '.join(available)}",
                    error=f"SubAgent '{agent_type}' requires agent mode",
                )

            # Create SubAgent context with filtered emitter
            # This allows SubAgent to emit file_edit, status, etc. but blocks 'done' events
            # from reaching the frontend (SubAgent's done only ends its own loop)
            subagent_context = context.for_subagent()

            # Create SubAgent instance with filtered context
            agent = SubAgentRegistry.create(agent_type, subagent_context)

            logger.debug(
                "[TaskTool] Created SubAgent with filtered context (blocks 'done' events)"
            )

            # Execute the task
            result_text = await agent.run_task(task_prompt)

            # Get agent stats
            stats = agent.get_stats()

            logger.info(
                f"[TaskTool] {agent_type} completed: "
                f"turns={stats['turns']}, tokens={stats['total_tokens']}"
            )

            return ToolResult(
                success=True,
                text=result_text,
                data={
                    "agent_type": agent_type,
                    "task_prompt": task_prompt,
                    "stats": stats,
                },
            )

        except Exception as e:
            logger.error(f"[TaskTool] Error executing {agent_type}: {e}")
            return ToolResult(
                success=False,
                text=f"SubAgent execution failed: {str(e)}",
                error=str(e),
            )

    def get_prompt_description(self, mode: str = None) -> str:
        """
        Generate a prompt-friendly description based on current mode.

        Overrides base to filter SubAgents by mode.

        Args:
            mode: Current mode ("ask" or "agent")

        Returns:
            Formatted string describing the tool and available SubAgents
        """
        # Update schema for this mode
        self._update_schema_for_mode(mode)

        # Use parent implementation
        return super().get_prompt_description()


__all__ = ["TaskTool"]
