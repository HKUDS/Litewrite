"""Agent loop: the core processing engine."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import TYPE_CHECKING

from loguru import logger

from nanobot.bus.events import InboundMessage, OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.providers.base import LLMProvider
from nanobot.agent.context import ContextBuilder
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.agent.tools.filesystem import (
    ReadFileTool,
    WriteFileTool,
    EditFileTool,
    ListDirTool,
)
from nanobot.agent.tools.shell import ExecTool
from nanobot.agent.tools.web import WebSearchTool, WebFetchTool
from nanobot.agent.tools.message import MessageTool
from nanobot.agent.tools.spawn import SpawnTool
from nanobot.agent.tools.session import (
    SessionInfoTool,
    SessionGetHistoryTool,
    SessionClearTool,
    SessionSummarizeTool,
)
from nanobot.agent.subagent import SubagentManager
from nanobot.session.manager import SessionManager

if TYPE_CHECKING:
    from nanobot.config.schema import ExecToolConfig, FeishuConfig, LitewriteConfig


class AgentLoop:
    """
    The agent loop is the core processing engine.

    It:
    1. Receives messages from the bus
    2. Builds context with history, memory, skills
    3. Calls the LLM
    4. Executes tool calls
    5. Sends responses back
    """

    def __init__(
        self,
        bus: MessageBus,
        provider: LLMProvider,
        workspace: Path,
        model: str | None = None,
        max_iterations: int = 20,
        brave_api_key: str | None = None,
        exec_config: "ExecToolConfig | None" = None,
        litewrite_config: "LitewriteConfig | None" = None,
        feishu_config: "FeishuConfig | None" = None,
    ):
        from nanobot.config.schema import ExecToolConfig

        self.bus = bus
        self.provider = provider
        self.workspace = workspace
        self.model = model or provider.get_default_model()
        self.max_iterations = max_iterations
        self.brave_api_key = brave_api_key
        self.exec_config = exec_config or ExecToolConfig()
        self.litewrite_config = litewrite_config
        self.feishu_config = feishu_config

        self.context = ContextBuilder(workspace)
        self.sessions = SessionManager(workspace)
        self.tools = ToolRegistry()
        self.subagents = SubagentManager(
            provider=provider,
            workspace=workspace,
            bus=bus,
            model=self.model,
            brave_api_key=brave_api_key,
            exec_config=self.exec_config,
        )

        self._running = False
        self._register_default_tools()

    def _register_default_tools(self) -> None:
        """Register the default set of tools."""
        # File tools (workspace-sandboxed)
        self.tools.register(ReadFileTool(workspace=self.workspace))
        self.tools.register(WriteFileTool(workspace=self.workspace))
        self.tools.register(EditFileTool(workspace=self.workspace))
        self.tools.register(ListDirTool(workspace=self.workspace))

        # Shell tool
        self.tools.register(
            ExecTool(
                working_dir=str(self.workspace),
                timeout=self.exec_config.timeout,
                restrict_to_workspace=self.exec_config.restrict_to_workspace,
            )
        )

        # Web tools
        # Note: WebSearchTool (Brave) removed — litewrite_deep_research covers
        # search via ai-server (arXiv + web). Only keep WebFetchTool for URL fetching.
        if self.brave_api_key:
            self.tools.register(WebSearchTool(api_key=self.brave_api_key))
        self.tools.register(WebFetchTool())

        # Message tool
        message_tool = MessageTool(send_callback=self.bus.publish_outbound)
        self.tools.register(message_tool)

        # Spawn tool (for subagents)
        spawn_tool = SpawnTool(manager=self.subagents)
        self.tools.register(spawn_tool)

        # Session management tools
        self.tools.register(SessionInfoTool(self.sessions))
        self.tools.register(SessionGetHistoryTool(self.sessions))
        self.tools.register(SessionClearTool(self.sessions))
        summarize_tool = SessionSummarizeTool(
            self.sessions, provider=self.provider, model=self.model
        )
        self.tools.register(summarize_tool)

        # Litewrite tools (registered when Litewrite integration is configured)
        if self.litewrite_config and self.litewrite_config.api_secret:
            self._register_litewrite_tools()

    def _register_litewrite_tools(self) -> None:
        """Register Litewrite integration tools.

        Only *management-level* tools are exposed to the bot.  All file
        reading / editing / listing is delegated to the ``litewrite_agent``
        tool which internally invokes Litewrite's AI sub-agents.  This keeps
        the bot in a **Manager** role and prevents it from bypassing the
        agent's orchestration layer.
        """
        from nanobot.agent.tools.litewrite import (
            LitewriteClient,
            # Manager-level tools
            LitewriteListProjectsTool,
            LitewriteCompileTool,
            LitewriteAgentTool,
            # Project management
            LitewriteCreateProjectTool,
            LitewriteDeleteProjectTool,
            LitewriteRenameProjectTool,
            # Version management
            LitewriteListVersionsTool,
            LitewriteSaveVersionTool,
            LitewriteRestoreVersionTool,
            # File management
            LitewriteUploadFileTool,
            LitewriteCreateFileTool,
            # Import tools
            LitewriteImportArxivTool,
            LitewriteImportGithubTool,
            LitewriteImportUploadTool,
        )
        from nanobot.agent.tools.deep_research import LitewriteDeepResearchTool

        client = LitewriteClient(
            base_url=self.litewrite_config.url,
            api_secret=self.litewrite_config.api_secret,
        )

        # Resolve default owner ID from Feishu config
        default_owner_id = ""
        if self.feishu_config:
            default_owner_id = self.feishu_config.default_litewrite_user_id

        # Core tools — litewrite_agent is the primary interface for
        # reading, analysing, writing, and editing project files.
        self.tools.register(LitewriteListProjectsTool(client, default_owner_id))
        self.tools.register(LitewriteAgentTool(client, default_owner_id))
        self.tools.register(LitewriteCompileTool(client, default_owner_id))

        # Project management
        self.tools.register(LitewriteCreateProjectTool(client, default_owner_id))
        self.tools.register(LitewriteDeleteProjectTool(client))
        self.tools.register(LitewriteRenameProjectTool(client))

        # Version management
        self.tools.register(LitewriteListVersionsTool(client))
        self.tools.register(LitewriteSaveVersionTool(client, default_owner_id))
        self.tools.register(LitewriteRestoreVersionTool(client))

        # File management
        self.tools.register(LitewriteUploadFileTool(client))
        self.tools.register(LitewriteCreateFileTool(client))

        # Import tools (arXiv, GitHub/GitLab, file upload)
        self.tools.register(LitewriteImportArxivTool(client, default_owner_id))
        self.tools.register(LitewriteImportGithubTool(client, default_owner_id))
        self.tools.register(LitewriteImportUploadTool(client, default_owner_id))

        # Deep Research tool (calls AI server directly)
        self.tools.register(
            LitewriteDeepResearchTool(
                ai_server_url=self.litewrite_config.ai_server_url,
            )
        )

        logger.info(f"Litewrite tools registered (url={self.litewrite_config.url})")

    async def run(self) -> None:
        """Run the agent loop, processing messages from the bus."""
        self._running = True
        logger.info("Agent loop started")

        while self._running:
            try:
                # Wait for next message
                msg = await asyncio.wait_for(self.bus.consume_inbound(), timeout=1.0)

                # Process it
                try:
                    response = await self._process_message(msg)
                    if response:
                        await self.bus.publish_outbound(response)
                except Exception as e:
                    logger.error(f"Error processing message: {e}", exc_info=True)
                    # Send generic error response (do not leak internal details)
                    await self.bus.publish_outbound(
                        OutboundMessage(
                            channel=msg.channel,
                            chat_id=msg.chat_id,
                            content="Sorry, I encountered an error processing your message. Please try again.",
                        )
                    )
            except asyncio.TimeoutError:
                continue

    def stop(self) -> None:
        """Stop the agent loop."""
        self._running = False
        logger.info("Agent loop stopping")

    async def _process_message(self, msg: InboundMessage) -> OutboundMessage | None:
        """
        Process a single inbound message.

        Args:
            msg: The inbound message to process.

        Returns:
            The response message, or None if no response needed.
        """
        # Handle system messages (subagent announces)
        # The chat_id contains the original "channel:chat_id" to route back to
        if msg.channel == "system":
            return await self._process_system_message(msg)

        logger.info(f"Processing message from {msg.channel}:{msg.sender_id}")

        # Get or create session
        session = self.sessions.get_or_create(msg.session_key)

        # ── Slash commands (handled before LLM) ──────────────────────────
        if msg.content.strip() == "/clear":
            count = len(session.messages)
            session.clear()
            self.sessions.save(session)
            logger.info(
                f"Session {msg.session_key} cleared via /clear ({count} messages)"
            )
            return OutboundMessage(
                channel=msg.channel,
                chat_id=msg.chat_id,
                content=f"✅ Chat history cleared ({count} messages removed). Starting fresh!",
            )

        # Update tool contexts
        message_tool = self.tools.get("message")
        if isinstance(message_tool, MessageTool):
            message_tool.set_context(msg.channel, msg.chat_id)

        spawn_tool = self.tools.get("spawn")
        if isinstance(spawn_tool, SpawnTool):
            spawn_tool.set_context(msg.channel, msg.chat_id)

        # Set compile tool context so it can auto-send PDFs
        compile_tool = self.tools.get("litewrite_compile")
        if compile_tool is not None:
            from nanobot.agent.tools.litewrite import LitewriteCompileTool

            if isinstance(compile_tool, LitewriteCompileTool):
                compile_tool.set_context(
                    msg.channel, msg.chat_id, self.bus.publish_outbound
                )

        # Set session context on session tools
        from nanobot.agent.tools.session import _SessionToolBase

        for tool in self.tools._tools.values():
            if isinstance(tool, _SessionToolBase):
                tool.set_session(session)

        # Build initial messages (use get_history for LLM-formatted messages)
        messages = self.context.build_messages(
            history=session.get_history(),
            current_message=msg.content,
            media=msg.media if msg.media else None,
        )

        # Agent loop
        iteration = 0
        final_content = None
        any_tool_called = False

        while iteration < self.max_iterations:
            iteration += 1

            # Call LLM
            logger.info(
                f"Agent iteration {iteration}/{self.max_iterations} "
                f"(tools_available={len(self.tools)}, history_msgs={len(messages)})"
            )
            response = await self.provider.chat(
                messages=messages, tools=self.tools.get_definitions(), model=self.model
            )

            # Handle tool calls
            if response.has_tool_calls:
                tool_names = [tc.name for tc in response.tool_calls]
                logger.info(f"LLM requested tool calls: {tool_names}")
                any_tool_called = True

                # Add assistant message with tool calls
                tool_call_dicts = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": json.dumps(
                                tc.arguments
                            ),  # Must be JSON string
                        },
                    }
                    for tc in response.tool_calls
                ]
                messages = self.context.add_assistant_message(
                    messages, response.content, tool_call_dicts
                )

                # Execute tools
                for tool_call in response.tool_calls:
                    args_str = json.dumps(tool_call.arguments)
                    logger.info(
                        f"Executing tool: {tool_call.name}({args_str})"
                    )
                    result = await self.tools.execute(
                        tool_call.name, tool_call.arguments
                    )
                    result_preview = result[:200] if len(result) > 200 else result
                    logger.info(
                        f"Tool {tool_call.name} result: {result_preview}"
                    )
                    messages = self.context.add_tool_result(
                        messages, tool_call.id, tool_call.name, result
                    )
            else:
                # No tool calls — check for suspected hallucination
                final_content = response.content or ""
                logger.info(
                    f"LLM returned text (no tool calls) at iteration {iteration}: "
                    f"{final_content[:120]}..."
                )

                # Hallucination guard: if the model claims it performed an
                # action (compile, send PDF, edit file, etc.) on the FIRST
                # iteration without ever calling a tool, inject a correction
                # prompt and retry.
                if not any_tool_called and iteration == 1:
                    if self._looks_like_hallucinated_action(final_content):
                        logger.warning(
                            "Hallucination detected: model claims action without "
                            "tool calls. Injecting correction prompt."
                        )
                        messages = self.context.add_assistant_message(
                            messages, final_content
                        )
                        messages.append(
                            {
                                "role": "user",
                                "content": (
                                    "[System] You did NOT actually perform any action — "
                                    "you MUST call the appropriate tool function to "
                                    "complete the user's request. You cannot claim "
                                    "an action was done without calling a tool. "
                                    "Available tools include: litewrite_agent, "
                                    "litewrite_compile, litewrite_create_file, "
                                    "litewrite_list_projects, litewrite_import_arxiv, "
                                    "etc. Please call the correct tool(s) NOW."
                                ),
                            }
                        )
                        final_content = None
                        continue

                break

        if final_content is None:
            final_content = "I've completed processing but have no response to give."

        # Save to session
        session.add_message("user", msg.content)
        session.add_message("assistant", final_content)
        self.sessions.save(session)

        return OutboundMessage(
            channel=msg.channel, chat_id=msg.chat_id, content=final_content
        )

    async def _process_system_message(
        self, msg: InboundMessage
    ) -> OutboundMessage | None:
        """
        Process a system message (e.g., subagent announce).

        The chat_id field contains "original_channel:original_chat_id" to route
        the response back to the correct destination.
        """
        logger.info(f"Processing system message from {msg.sender_id}")

        # Parse origin from chat_id (format: "channel:chat_id")
        if ":" in msg.chat_id:
            parts = msg.chat_id.split(":", 1)
            origin_channel = parts[0]
            origin_chat_id = parts[1]
        else:
            # Fallback
            origin_channel = "cli"
            origin_chat_id = msg.chat_id

        # Use the origin session for context
        session_key = f"{origin_channel}:{origin_chat_id}"
        session = self.sessions.get_or_create(session_key)

        # Update tool contexts
        message_tool = self.tools.get("message")
        if isinstance(message_tool, MessageTool):
            message_tool.set_context(origin_channel, origin_chat_id)

        spawn_tool = self.tools.get("spawn")
        if isinstance(spawn_tool, SpawnTool):
            spawn_tool.set_context(origin_channel, origin_chat_id)

        # Set session context on session tools
        from nanobot.agent.tools.session import _SessionToolBase

        for tool in self.tools._tools.values():
            if isinstance(tool, _SessionToolBase):
                tool.set_session(session)

        # Build messages with the announce content
        messages = self.context.build_messages(
            history=session.get_history(), current_message=msg.content
        )

        # Agent loop (limited for announce handling)
        iteration = 0
        final_content = None

        while iteration < self.max_iterations:
            iteration += 1

            response = await self.provider.chat(
                messages=messages, tools=self.tools.get_definitions(), model=self.model
            )

            if response.has_tool_calls:
                tool_call_dicts = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": json.dumps(tc.arguments),
                        },
                    }
                    for tc in response.tool_calls
                ]
                messages = self.context.add_assistant_message(
                    messages, response.content, tool_call_dicts
                )

                for tool_call in response.tool_calls:
                    args_str = json.dumps(tool_call.arguments)
                    logger.debug(
                        f"Executing tool: {tool_call.name} with arguments: {args_str}"
                    )
                    result = await self.tools.execute(
                        tool_call.name, tool_call.arguments
                    )
                    messages = self.context.add_tool_result(
                        messages, tool_call.id, tool_call.name, result
                    )
            else:
                final_content = response.content
                break

        if final_content is None:
            final_content = "Background task completed."

        # Save to session (mark as system message in history)
        session.add_message("user", f"[System: {msg.sender_id}] {msg.content}")
        session.add_message("assistant", final_content)
        self.sessions.save(session)

        return OutboundMessage(
            channel=origin_channel, chat_id=origin_chat_id, content=final_content
        )

    @staticmethod
    def _looks_like_hallucinated_action(text: str) -> bool:
        """Detect if the model's text response looks like it performed an
        action that should have required a tool call.

        Returns ``True`` when suspicious patterns are found.
        """
        if not text:
            return False
        t = text.lower()
        # Patterns that strongly suggest the model is claiming it did something
        # that requires a tool call.
        action_phrases = [
            # Compilation
            "编译成功",
            "编译完成",
            "pdf已发送",
            "pdf 已发送",
            "pdf已编译",
            "compilation successful",
            "pdf sent",
            # Project operations
            "已创建项目",
            "项目已创建",
            "project created",
            # File operations
            "已修改",
            "修改完成",
            "文件已编辑",
            "file edited",
            "已创建",
            "已保存",
            "已完成",
            "已新建",
            "已添加",
            "已写入",
            "已生成",
            "已导入",
            "已上传",
            "file created",
            "successfully created",
            "saved to",
            # Agent operations
            "已总结",
            "已分析",
            "已重写",
            "已更新",
        ]
        return any(phrase in t for phrase in action_phrases)

    async def process_direct(
        self, content: str, session_key: str = "cli:direct"
    ) -> str:
        """
        Process a message directly (for CLI usage).

        Args:
            content: The message content.
            session_key: Session identifier.

        Returns:
            The agent's response.
        """
        msg = InboundMessage(
            channel="cli", sender_id="user", chat_id="direct", content=content
        )

        response = await self._process_message(msg)
        return response.content if response else ""
