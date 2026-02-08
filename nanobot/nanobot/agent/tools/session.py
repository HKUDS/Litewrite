"""Session management tools for viewing, clearing, and summarizing chat history."""

from __future__ import annotations

from typing import Any, TYPE_CHECKING

from nanobot.agent.tools.base import Tool

if TYPE_CHECKING:
    from nanobot.providers.base import LLMProvider
    from nanobot.session.manager import Session, SessionManager


class _SessionToolBase(Tool):
    """Base class for session management tools.

    These tools operate on the *current* session.  The session reference is
    set by ``AgentLoop`` at the start of each message processing cycle via
    ``set_session()``.
    """

    def __init__(self, session_manager: "SessionManager"):
        self._manager = session_manager
        self._session: "Session | None" = None

    def set_session(self, session: "Session") -> None:
        """Set the active session (called per-message by AgentLoop)."""
        self._session = session


# ---------------------------------------------------------------------------
# session_info
# ---------------------------------------------------------------------------


class SessionInfoTool(_SessionToolBase):
    """Inspect metadata about the current conversation session."""

    @property
    def name(self) -> str:
        return "session_info"

    @property
    def description(self) -> str:
        return (
            "Show information about the current chat session: total message "
            "count, creation time, last update, and estimated token count. "
            "Useful for understanding how much context is available."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {"type": "object", "properties": {}}

    async def execute(self, **kwargs: Any) -> str:
        if self._session is None:
            return "Error: No active session."

        total = len(self._session.messages)

        # Rough token estimate (≈4 chars/token for English, ≈2 for Chinese)
        char_count = sum(len(m.get("content", "")) for m in self._session.messages)
        est_tokens = char_count // 3  # conservative average

        lines = [
            f"Session: {self._session.key}",
            f"Total messages: {total}",
            f"Created: {self._session.created_at.isoformat()}",
            f"Last updated: {self._session.updated_at.isoformat()}",
            f"Estimated tokens: ~{est_tokens}",
        ]
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# session_get_history
# ---------------------------------------------------------------------------


class SessionGetHistoryTool(_SessionToolBase):
    """Retrieve past conversation messages."""

    @property
    def name(self) -> str:
        return "session_get_history"

    @property
    def description(self) -> str:
        return (
            "Get past messages in the current session. You can specify how many "
            "messages to retrieve and an offset to scroll through history."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "count": {
                    "type": "integer",
                    "description": "Number of messages to retrieve (default 20, max 100).",
                },
                "offset": {
                    "type": "integer",
                    "description": (
                        "Skip this many recent messages (0 = most recent). "
                        "Use to page through older history."
                    ),
                },
            },
        }

    async def execute(
        self, count: int = 20, offset: int = 0, **kwargs: Any
    ) -> str:
        if self._session is None:
            return "Error: No active session."

        count = max(1, min(count, 100))
        offset = max(0, offset)
        total = len(self._session.messages)

        if total == 0:
            return "The session has no messages."

        # Slice from end (most recent first)
        end_idx = total - offset
        start_idx = max(0, end_idx - count)

        if end_idx <= 0:
            return f"Offset {offset} exceeds total messages ({total})."

        msgs = self._session.messages[start_idx:end_idx]

        lines = [f"Messages {start_idx + 1}–{end_idx} of {total}:"]
        for i, m in enumerate(msgs, start=start_idx + 1):
            role = m.get("role", "?")
            content = m.get("content", "")
            ts = m.get("timestamp", "")
            # Truncate long messages for overview
            preview = content[:200] + ("…" if len(content) > 200 else "")
            lines.append(f"\n[{i}] {role} ({ts}):\n{preview}")

        return "\n".join(lines)


# ---------------------------------------------------------------------------
# session_clear
# ---------------------------------------------------------------------------


class SessionClearTool(_SessionToolBase):
    """Clear the current session's conversation history."""

    @property
    def name(self) -> str:
        return "session_clear"

    @property
    def description(self) -> str:
        return (
            "Clear all messages in the current chat session. "
            "This is irreversible. Use when the conversation has become too "
            "long or when the user explicitly asks to start fresh."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "confirm": {
                    "type": "boolean",
                    "description": "Must be true to confirm clearing. Safety check.",
                },
            },
            "required": ["confirm"],
        }

    async def execute(self, confirm: bool = False, **kwargs: Any) -> str:
        if self._session is None:
            return "Error: No active session."

        if not confirm:
            return "Clear cancelled. Set confirm=true to proceed."

        count = len(self._session.messages)
        self._session.clear()
        self._manager.save(self._session)
        return f"Session cleared. {count} message(s) removed."


# ---------------------------------------------------------------------------
# session_summarize
# ---------------------------------------------------------------------------


class SessionSummarizeTool(_SessionToolBase):
    """Compress session history by replacing old messages with a summary."""

    def __init__(
        self,
        session_manager: "SessionManager",
        provider: "LLMProvider | None" = None,
        model: str | None = None,
    ):
        super().__init__(session_manager)
        self._provider = provider
        self._model = model

    def set_provider(self, provider: "LLMProvider", model: str) -> None:
        self._provider = provider
        self._model = model

    @property
    def name(self) -> str:
        return "session_summarize"

    @property
    def description(self) -> str:
        return (
            "Compress the session history by summarizing older messages and "
            "keeping only the most recent ones. This reduces token usage while "
            "preserving important context. The summary replaces old messages."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "keep_recent": {
                    "type": "integer",
                    "description": (
                        "Number of most-recent messages to keep verbatim "
                        "(default 10). Older messages are replaced by a summary."
                    ),
                },
            },
        }

    async def execute(self, keep_recent: int = 10, **kwargs: Any) -> str:
        if self._session is None:
            return "Error: No active session."

        if self._provider is None:
            return "Error: LLM provider not configured for summarization."

        total = len(self._session.messages)
        keep_recent = max(2, min(keep_recent, total))

        if total <= keep_recent:
            return (
                f"Only {total} message(s) in session — nothing to summarize. "
                f"(keep_recent={keep_recent})"
            )

        # Split into old (to summarize) and recent (to keep)
        old_messages = self._session.messages[: total - keep_recent]
        recent_messages = self._session.messages[total - keep_recent :]

        # Build summarization prompt
        conversation_text = "\n".join(
            f"[{m.get('role', '?')}] {m.get('content', '')}" for m in old_messages
        )

        summarize_messages = [
            {
                "role": "system",
                "content": (
                    "You are a conversation summarizer. Produce a concise summary "
                    "of the following conversation. Preserve key facts, decisions, "
                    "project names, file names, and any important context. "
                    "The summary will be used as context for future interactions. "
                    "Write the summary in the same language as the conversation."
                ),
            },
            {
                "role": "user",
                "content": f"Summarize this conversation:\n\n{conversation_text}",
            },
        ]

        try:
            response = await self._provider.chat(
                messages=summarize_messages,
                model=self._model,
            )
            summary_text = response.content or "No summary generated."
        except Exception as e:
            return f"Error generating summary: {e}"

        # Replace old messages with a single summary message
        summary_msg = {
            "role": "system",
            "content": (
                f"[Session summary — {len(old_messages)} messages compressed]\n\n"
                f"{summary_text}"
            ),
            "timestamp": self._session.messages[0].get("timestamp", ""),
        }

        self._session.messages = [summary_msg] + recent_messages
        self._manager.save(self._session)

        return (
            f"Session compressed: {len(old_messages)} old messages replaced by a "
            f"summary. {len(recent_messages)} recent messages kept. "
            f"New total: {len(self._session.messages)} messages."
        )
