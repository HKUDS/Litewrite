"""Feishu/Lark channel implementation using lark-oapi SDK."""

import asyncio
import json
from pathlib import Path
from typing import Any

from loguru import logger

from nanobot.bus.events import OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel
from nanobot.config.schema import FeishuConfig

try:
    import lark_oapi as lark
    from lark_oapi import ws, EventDispatcherHandler
    from lark_oapi.api.im.v1 import (
        CreateMessageRequest,
        CreateMessageRequestBody,
        CreateFileRequest,
        CreateFileRequestBody,
    )

    FEISHU_AVAILABLE = True
except ImportError:
    FEISHU_AVAILABLE = False


class FeishuChannel(BaseChannel):
    """
    Feishu/Lark channel using WebSocket long-connection.

    Uses lark-oapi SDK's ws.Client for receiving messages (no public IP needed).
    Uses lark-oapi API client for sending messages and uploading files.
    """

    name = "feishu"

    def __init__(self, config: FeishuConfig, bus: MessageBus):
        super().__init__(config, bus)
        self.config: FeishuConfig = config
        self._ws_client: Any = None
        self._lark_client: Any = None
        self._loop: asyncio.AbstractEventLoop | None = None

    async def start(self) -> None:
        """Start the Feishu bot with WebSocket long-connection."""
        if not FEISHU_AVAILABLE:
            logger.error("lark-oapi not installed. Run: pip install lark-oapi")
            return

        if not self.config.app_id or not self.config.app_secret:
            logger.error("Feishu app_id or app_secret not configured")
            return

        self._running = True
        self._loop = asyncio.get_running_loop()

        # Create lark API client for sending messages
        self._lark_client = (
            lark.Client.builder()
            .app_id(self.config.app_id)
            .app_secret(self.config.app_secret)
            .log_level(lark.LogLevel.DEBUG)
            .build()
        )

        logger.info("Starting Feishu bot (WebSocket mode)...")

        # Run blocking WebSocket client in a separate thread
        await asyncio.to_thread(self._run_ws_client)

    def _run_ws_client(self) -> None:
        """Run the blocking WebSocket client (called in a thread)."""
        # Build event handler
        handler = (
            EventDispatcherHandler.builder("", "")
            .register_p2_im_message_receive_v1(self._on_message_sync)
            .build()
        )

        # Create and start WebSocket client
        self._ws_client = ws.Client(
            self.config.app_id,
            self.config.app_secret,
            event_handler=handler,
            log_level=lark.LogLevel.DEBUG,
        )

        logger.info("Feishu WebSocket client connecting...")
        self._ws_client.start()

    def _on_message_sync(self, data: Any) -> None:
        """
        Handle incoming message from Feishu SDK (called from SDK thread).
        Bridges to async via run_coroutine_threadsafe.
        """
        if self._loop is None:
            return

        asyncio.run_coroutine_threadsafe(self._handle_feishu_message(data), self._loop)

    async def _handle_feishu_message(self, data: Any) -> None:
        """Process a Feishu message event and forward to the message bus."""
        try:
            # Extract message data from the event
            event = data.event
            message = event.message
            sender = event.sender

            # Get sender open_id
            sender_id = sender.sender_id.open_id if sender.sender_id else ""
            chat_id = message.chat_id or ""

            # Only handle text messages for now
            msg_type = message.message_type
            if msg_type != "text":
                logger.debug(f"Ignoring non-text message type: {msg_type}")
                return

            # Parse message content (Feishu wraps text in JSON: {"text": "..."})
            content = ""
            try:
                content_json = json.loads(message.content)
                content = content_json.get("text", "")
            except (json.JSONDecodeError, TypeError):
                content = message.content or ""

            if not content:
                return

            logger.debug(f"Feishu message from {sender_id}: {content[:50]}...")

            # Forward to the message bus
            await self._handle_message(
                sender_id=sender_id,
                chat_id=chat_id,
                content=content,
                metadata={
                    "message_id": message.message_id,
                    "chat_type": message.chat_type,
                    "msg_type": msg_type,
                },
            )

        except Exception as e:
            logger.error(f"Error handling Feishu message: {e}")

    async def stop(self) -> None:
        """Stop the Feishu bot."""
        self._running = False
        # The ws.Client doesn't have a clean stop mechanism;
        # it will terminate when the process exits.
        logger.info("Feishu channel stopped")

    async def send(self, msg: OutboundMessage) -> None:
        """Send a message through Feishu."""
        if not self._lark_client:
            logger.warning("Feishu client not initialized")
            return

        try:
            # Send text content
            if msg.content:
                await self._send_text(msg.chat_id, msg.content)

            # Send file attachments
            if msg.media:
                for file_path in msg.media:
                    await self._send_file(msg.chat_id, file_path)

        except Exception as e:
            logger.error(f"Error sending Feishu message: {e}")

    async def _send_text(self, chat_id: str, content: str) -> None:
        """Send a text message to a Feishu chat."""
        body = (
            CreateMessageRequestBody.builder()
            .receive_id(chat_id)
            .msg_type("text")
            .content(json.dumps({"text": content}))
            .build()
        )

        request = (
            CreateMessageRequest.builder()
            .receive_id_type("chat_id")
            .request_body(body)
            .build()
        )

        # Run sync API call in thread to avoid blocking the event loop
        response = await asyncio.to_thread(
            self._lark_client.im.v1.message.create, request
        )

        if not response.success():
            logger.error(
                f"Failed to send Feishu text: code={response.code}, msg={response.msg}"
            )

    async def _send_file(self, chat_id: str, file_path: str) -> None:
        """Upload a file to Feishu and send it as a file message."""
        path = Path(file_path)
        if not path.exists():
            logger.error(f"File not found: {file_path}")
            return

        # Determine file type for Feishu API
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            file_type = "pdf"
        elif suffix in (".png", ".jpg", ".jpeg", ".gif"):
            file_type = "image"
        else:
            file_type = "stream"

        try:
            # Step 1: Upload file to Feishu
            upload_body = (
                CreateFileRequestBody.builder()
                .file_type(file_type)
                .file_name(path.name)
                .file(open(path, "rb"))
                .build()
            )

            upload_request = (
                CreateFileRequest.builder().request_body(upload_body).build()
            )

            upload_response = await asyncio.to_thread(
                self._lark_client.im.v1.file.create, upload_request
            )

            if not upload_response.success():
                logger.error(
                    f"Failed to upload file to Feishu: code={upload_response.code}, "
                    f"msg={upload_response.msg}"
                )
                return

            file_key = upload_response.data.file_key

            # Step 2: Send file message
            msg_body = (
                CreateMessageRequestBody.builder()
                .receive_id(chat_id)
                .msg_type("file")
                .content(json.dumps({"file_key": file_key}))
                .build()
            )

            msg_request = (
                CreateMessageRequest.builder()
                .receive_id_type("chat_id")
                .request_body(msg_body)
                .build()
            )

            msg_response = await asyncio.to_thread(
                self._lark_client.im.v1.message.create, msg_request
            )

            if not msg_response.success():
                logger.error(
                    f"Failed to send file message: code={msg_response.code}, "
                    f"msg={msg_response.msg}"
                )
            else:
                logger.info(f"Sent file {path.name} to Feishu chat {chat_id}")

        except Exception as e:
            logger.error(f"Error sending file to Feishu: {e}")
