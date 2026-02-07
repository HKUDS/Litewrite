"""
Chat Service 1.5
================

Entry point service for the Chat Service 1.5.

This service provides the same interface as the original ChatService
but uses the MainAgent + SubAgent architecture.

Usage:
    service = ChatService()
    async for event in service.run(
        project_id="xxx",
        user_id="yyy",
        user_message="Help me write an introduction",
        mode="agent",
    ):
        # Handle events
        pass
"""

from typing import AsyncGenerator, Dict, Any, Optional, List
from dataclasses import dataclass
import logging

from services.chat_1_5.agents.main_agent import MainAgent
from services.chat_1_5.agents.base import AgentConfig
from services.chat_1_5.context_manager import (
    count_tokens,
    should_compress_history,
    compress_history,
    get_history_usage,
    EXECUTION_LIMIT,
)
from tools.base import ToolContext
from tools.registry import register_all_tools

logger = logging.getLogger(__name__)


@dataclass
class SSEOutput:
    """SSE output event for streaming."""

    event: str
    data: Dict[str, Any]

    def to_sse(self) -> str:
        """Convert to SSE format string."""
        import json

        data_str = json.dumps(self.data, ensure_ascii=False)
        return f"event: {self.event}\ndata: {data_str}\n\n"


class ChatService:
    """
    Chat Service 1.5

    Features:
    - MainAgent + SubAgent architecture
    - Mode-based tool filtering (Ask vs Agent)
    - Unified Agent Loop
    - SSE streaming support
    """

    def __init__(self, verbose: bool = False):
        """
        Initialize the ChatService.

        Args:
            verbose: Enable verbose logging
        """
        # Ensure tools are registered
        register_all_tools()
        self.verbose = verbose
        logger.info("[ChatService 1.5] Initialized")

    async def run(
        self,
        project_id: str,
        user_message: str,
        mode: str = "ask",
        user_id: Optional[str] = None,
        history: Optional[List[Dict[str, Any]]] = None,
        compressed_history: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        referenced_files: Optional[List[str]] = None,
        attached_contents: Optional[Dict[str, str]] = None,
        session_id: Optional[str] = None,
        agent_config: Optional[AgentConfig] = None,
    ) -> AsyncGenerator[SSEOutput, None]:
        """
        Run the chat service.

        Args:
            project_id: Current project ID
            user_message: User's input message
            mode: "ask" or "agent"
            user_id: Optional user identifier (attribution only)
            history: Optional conversation history (legacy, use compressed_history instead)
            compressed_history: Pre-formatted history string (preferred)
            attachments: Optional file attachments
            referenced_files: Files referenced in conversation
            attached_contents: Content of attached files
            session_id: Session identifier for history compression updates
            agent_config: Optional agent configuration

        Yields:
            SSEOutput events for streaming
        """
        logger.info(
            f"[ChatService 1.5] Run: project={project_id}, user={user_id}, mode={mode}"
        )

        # Build the query with context
        query = self._build_query(
            user_message=user_message,
            attachments=attachments,
            attached_contents=attached_contents,
        )

        # Create tool context
        context = ToolContext(
            project_id=project_id,
            user_id=user_id,
            mode=mode,
        )

        # Create main agent
        agent = MainAgent(
            context=context,
            mode=mode,
            agent_config=agent_config,
        )

        # Handle history injection with compression check
        history_tokens = 0
        if compressed_history:
            # New format: use compressed_history directly
            history_tokens = count_tokens(compressed_history)
            logger.info(f"[ChatService 1.5] compressedHistory: {history_tokens} tokens")

            # Check if compression is needed
            if should_compress_history(history_tokens):
                logger.info(
                    "[ChatService 1.5] History exceeds threshold, compressing..."
                )

                # Compress history if needed
                new_history, new_tokens = await compress_history(
                    compressed_history, user_id=user_id, project_id=project_id
                )

                # Emit history_compressed event
                yield SSEOutput(
                    event="history_compressed",
                    data={
                        "compressedHistory": new_history,
                        "tokensBefore": history_tokens,
                        "tokensAfter": new_tokens,
                    },
                )

                # Use compressed history
                compressed_history = new_history
                history_tokens = new_tokens

            # Inject as context
            self._inject_compressed_history(agent, compressed_history)

        elif history:
            # Legacy format: convert history list to context
            self._inject_history(agent, history)
            # Estimate tokens for legacy format
            history_tokens = sum(
                count_tokens(str(h.get("content", ""))) for h in history
            )

        # Emit initial token usage
        yield SSEOutput(
            event="token_usage",
            data={
                **get_history_usage(history_tokens),
                "executionTokens": 0,
                "executionLimit": EXECUTION_LIMIT,
            },
        )

        # Run with streaming
        try:
            async for event in agent.run_streaming(query):
                event_type = event.get("type", "unknown")
                event_data = event.get("data", {})

                yield SSEOutput(event=event_type, data=event_data)

        except Exception as e:
            logger.error(f"[ChatService 1.5] Error: {e}", exc_info=True)
            yield SSEOutput(event="error", data={"message": str(e)})

    def _build_query(
        self,
        user_message: str,
        attachments: Optional[List[Dict[str, Any]]] = None,
        attached_contents: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        Build the query string with file references (without content).

        The LLM should use read_file tool to get the actual content.
        We only indicate which files/lines the user referenced.

        Args:
            user_message: User's input message
            attachments: File attachments (references only, content ignored)
            attached_contents: Historical attached contents (ignored)

        Returns:
            Formatted query string with file references
        """
        parts = [user_message]

        # Add file references (without content - LLM uses read_file to get content)
        if attachments:
            refs = []
            for att in attachments:
                file_path = att.get("filePath", "")
                line_range = att.get("lineRange")

                if file_path:
                    if line_range:
                        refs.append(
                            f"[[FILE:{file_path}:{line_range['start']}-{line_range['end']}]]"
                        )
                    else:
                        refs.append(f"[[FILE:{file_path}]]")

            if refs:
                # Prepend file references to user message
                parts = [" ".join(refs) + " " + user_message]

        # Note: attached_contents (historical) is ignored
        # LLM should use read_file if it needs to re-read historical files

        return "\n".join(parts)

    async def run_sync(
        self,
        project_id: str,
        user_id: str,
        query: str,
        mode: str = "ask",
        conversation_history: Optional[List[Dict[str, Any]]] = None,
        agent_config: Optional[AgentConfig] = None,
        direct_apply: bool = False,
    ) -> str:
        """
        Run the chat service synchronously (non-streaming).

        Args:
            project_id: Current project ID
            user_id: Current user ID
            query: User's input query
            mode: "ask" or "agent"
            conversation_history: Optional previous conversation history
            agent_config: Optional agent configuration
            direct_apply: If True, file edits bypass shadow documents and write
                         directly to storage. Used by nanobot/API consumers.

        Returns:
            Final response text
        """
        logger.info(
            f"[ChatService 1.5] Run sync: project={project_id}, user={user_id}, mode={mode}, direct_apply={direct_apply}"
        )

        # Create tool context (no emitter for sync mode)
        context = ToolContext(
            project_id=project_id,
            user_id=user_id,
            mode=mode,
            direct_apply=direct_apply,
        )

        # Create main agent
        agent = MainAgent(
            context=context,
            mode=mode,
            agent_config=agent_config,
        )

        # Inject conversation history if provided
        if conversation_history:
            self._inject_history(agent, conversation_history)

        # Run synchronously
        try:
            result = await agent.run(query)
            return result
        except Exception as e:
            logger.error(f"[ChatService 1.5] Error: {e}")
            return f"Error: {str(e)}"

    def _inject_history(
        self,
        agent: MainAgent,
        history: List[Dict[str, Any]],
    ) -> None:
        """
        Inject conversation history into the agent as <context>.

        The history from Next.js contains display-layer messages:
        - User's previous queries
        - AI's responses to user
        - Does NOT include tool calls and results

        This history is formatted as <context> for background reference,
        NOT as <execution_log> which is for current-turn progress.

        Args:
            agent: The MainAgent instance
            history: Conversation history to inject
        """

        logger.debug(
            f"[ChatService] _inject_history called with {len(history) if history else 0} messages"
        )

        if not history:
            logger.debug("[ChatService] No history to inject (empty or None)")
            return

        # Format history as <context> block
        # This is previous conversation for reference, not current execution
        context_parts = []
        for item in history:
            role = item.get("role", "user")
            content = item.get("content", "")

            if role == "system":
                # Skip system messages
                continue

            # Skip empty content
            if not content or not content.strip():
                continue

            if role == "user":
                context_parts.append(f"User: {content}")
            elif role == "assistant":
                context_parts.append(f"Assistant: {content}")

        logger.debug(
            f"[ChatService] Injecting history context: {len(context_parts)} messages"
        )

        if context_parts:
            context_content = (
                "<context>\n# Previous Conversation\n"
                + "\n\n".join(context_parts)
                + "\n</context>"
            )
            # Store as a special marker for base.py to handle
            agent.injected_context = context_content

    def _inject_compressed_history(
        self,
        agent: MainAgent,
        compressed_history: str,
    ) -> None:
        """
        Inject pre-formatted compressed history into the agent.

        This is the new preferred method that uses the compressedHistory
        string directly from the session, avoiding re-formatting.

        Args:
            agent: The MainAgent instance
            compressed_history: Pre-formatted history string
        """
        if not compressed_history or not compressed_history.strip():
            logger.debug("[ChatService] No compressed history to inject")
            return

        logger.debug(
            f"[ChatService] Injecting compressed history: {len(compressed_history)} chars"
        )

        # Wrap in context tags
        context_content = (
            f"<context>\n# Previous Conversation\n{compressed_history}\n</context>"
        )
        agent.injected_context = context_content


# Convenience function
async def chat(
    project_id: str,
    user_id: str,
    query: str,
    mode: str = "ask",
    direct_apply: bool = False,
    **kwargs,
) -> str:
    """
    Convenience function for synchronous chat.

    Args:
        project_id: Current project ID
        user_id: Current user ID
        query: User's input query
        mode: "ask" or "agent"
        direct_apply: If True, file edits write directly to storage
        **kwargs: Additional arguments passed to run_sync

    Returns:
        Final response text
    """
    service = ChatService()
    return await service.run_sync(
        project_id=project_id,
        user_id=user_id,
        query=query,
        mode=mode,
        direct_apply=direct_apply,
        **kwargs,
    )


__all__ = ["ChatService", "chat"]
