"""Feishu/Lark channel implementation using lark-oapi SDK."""

import asyncio
import io
import json
from pathlib import Path
from typing import Any

from loguru import logger

from nanobot.bus.events import OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel
from nanobot.config.schema import FeishuConfig
from nanobot.media.manager import MediaManager

try:
    import lark_oapi as lark
    from lark_oapi import ws, EventDispatcherHandler
    from lark_oapi.api.im.v1 import (
        CreateMessageRequest,
        CreateMessageRequestBody,
        CreateFileRequest,
        CreateFileRequestBody,
        GetMessageResourceRequest,
        CreateMessageReactionRequest,
        CreateMessageReactionRequestBody,
        Emoji,
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
        self._media = MediaManager()

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

    @staticmethod
    def _extract_post_text(content_json: dict[str, Any]) -> tuple[str, list[str]]:
        """Extract plain text and image keys from a Feishu 'post' (rich text) message.

        Feishu event payloads use the **flat** format for ``message.content``::

            {"title": "...", "content": [[{"tag": "text", "text": "..."}], ...]}

        The Send-API uses a **wrapped** format::

            {"post": {"zh_cn": {"title": "...", "content": [...]}}}

        This method handles both.

        Returns:
            (text, image_keys) — extracted plain text and list of Feishu image keys.
        """
        # Determine which format we have
        if "content" in content_json and isinstance(content_json["content"], list):
            # Flat format (from event payload): {"title": "...", "content": [...]}
            lang_data = content_json
        elif "post" in content_json:
            # Wrapped format (from Send API): {"post": {"zh_cn": {...}}}
            post_data = content_json["post"]
            lang_data = None
            for key in ("zh_cn", "en_us"):
                if key in post_data:
                    lang_data = post_data[key]
                    break
            if lang_data is None:
                for v in post_data.values():
                    if isinstance(v, dict):
                        lang_data = v
                        break
            if not lang_data:
                return "", []
        else:
            return "", []

        title = lang_data.get("title", "")
        paragraphs = lang_data.get("content", [])

        text_parts: list[str] = []
        image_keys: list[str] = []

        if title:
            text_parts.append(title)

        for paragraph in paragraphs:
            if not isinstance(paragraph, list):
                continue
            para_text: list[str] = []
            for block in paragraph:
                if not isinstance(block, dict):
                    continue
                tag = block.get("tag", "")
                if tag == "text":
                    para_text.append(block.get("text", ""))
                elif tag == "a":
                    para_text.append(block.get("text", ""))
                elif tag == "at":
                    user_name = block.get("user_name") or block.get("user_id", "")
                    if user_name:
                        para_text.append(f"@{user_name}")
                elif tag == "img":
                    image_key = block.get("image_key", "")
                    if image_key:
                        image_keys.append(image_key)
                    para_text.append("[Image]")
                elif tag == "media":
                    para_text.append("[Media]")
            if para_text:
                text_parts.append("".join(para_text))

        return "\n".join(text_parts), image_keys

    async def _download_feishu_image(
        self, message_id: str, image_key: str
    ) -> str | None:
        """Download an image from Feishu using its image_key.

        Returns the local file path on success, or None on failure.
        """
        if not self._lark_client:
            logger.warning("Feishu client not initialized, cannot download image")
            return None

        try:
            request = (
                GetMessageResourceRequest.builder()
                .message_id(message_id)
                .file_key(image_key)
                .type("image")
                .build()
            )

            response = await asyncio.to_thread(
                self._lark_client.im.v1.message_resource.get, request
            )

            if not response.success():
                logger.error(
                    f"Failed to download Feishu image {image_key}: "
                    f"code={response.code}, msg={response.msg}"
                )
                return None

            # Save via MediaManager
            raw_bytes = response.file.read()
            file_path = self._media.save(
                data=raw_bytes,
                channel="feishu",
                original_name=f"{image_key[:20]}.png",
                extension=".png",
            )

            logger.info(f"Downloaded Feishu image: {image_key[:20]}... -> {file_path}")
            return file_path

        except Exception as e:
            logger.error(f"Error downloading Feishu image {image_key}: {e}")
            return None

    async def _download_feishu_file(
        self, message_id: str, file_key: str, file_name: str = ""
    ) -> str | None:
        """Download a file from Feishu using its file_key.

        Returns the local file path on success, or None on failure.
        """
        if not self._lark_client:
            logger.warning("Feishu client not initialized, cannot download file")
            return None

        try:
            request = (
                GetMessageResourceRequest.builder()
                .message_id(message_id)
                .file_key(file_key)
                .type("file")
                .build()
            )

            response = await asyncio.to_thread(
                self._lark_client.im.v1.message_resource.get, request
            )

            if not response.success():
                logger.error(
                    f"Failed to download Feishu file {file_key}: "
                    f"code={response.code}, msg={response.msg}"
                )
                return None

            # Save via MediaManager
            raw_bytes = response.file.read()
            original_name = file_name or f"{file_key[:20]}.bin"
            extension = Path(original_name).suffix if original_name else ".bin"

            file_path = self._media.save(
                data=raw_bytes,
                channel="feishu",
                original_name=original_name,
                extension=extension or ".bin",
            )

            logger.info(f"Downloaded Feishu file: {original_name} -> {file_path}")
            return file_path

        except Exception as e:
            logger.error(f"Error downloading Feishu file {file_key}: {e}")
            return None

    async def _add_reaction(self, message_id: str, emoji_type: str = "DONE") -> None:
        """Add an emoji reaction (thumbs-up / done) to a Feishu message.

        This is fire-and-forget; failures are logged but never raised.
        """
        if not self._lark_client or not message_id:
            return

        try:
            body = (
                CreateMessageReactionRequestBody.builder()
                .reaction_type(Emoji.builder().emoji_type(emoji_type).build())
                .build()
            )

            request = (
                CreateMessageReactionRequest.builder()
                .message_id(message_id)
                .request_body(body)
                .build()
            )

            response = await asyncio.to_thread(
                self._lark_client.im.v1.message_reaction.create, request
            )

            if not response.success():
                logger.debug(
                    f"Failed to add reaction to {message_id}: "
                    f"code={response.code}, msg={response.msg}"
                )
            else:
                logger.debug(f"Added reaction '{emoji_type}' to message {message_id}")

        except Exception as e:
            logger.debug(f"Error adding reaction: {e}")

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

            msg_type = message.message_type
            message_id = message.message_id or ""

            # Parse message content based on type
            content = ""
            media_paths: list[str] = []
            image_keys: list[str] = []
            metadata: dict[str, Any] = {
                "message_id": message_id,
                "chat_type": message.chat_type,
                "msg_type": msg_type,
            }

            try:
                content_json = json.loads(message.content)

                if msg_type == "text":
                    # Text messages: {"text": "..."}
                    content = content_json.get("text", "")

                elif msg_type == "post":
                    # Rich text (post) messages: extract text and image keys
                    content, image_keys = self._extract_post_text(content_json)

                elif msg_type == "image":
                    # Standalone image messages: {"image_key": "..."}
                    img_key = content_json.get("image_key", "")
                    if img_key:
                        image_keys.append(img_key)
                    content = "[User sent an image]"

                elif msg_type == "file":
                    # File messages: {"file_key": "...", "file_name": "...", "size": "..."}
                    file_key = content_json.get("file_key", "")
                    file_name = content_json.get("file_name", "file")
                    if file_key and message_id:
                        local_path = await self._download_feishu_file(
                            message_id, file_key, file_name
                        )
                        if local_path:
                            media_paths.append(local_path)
                    content = f"[User sent a file: {file_name}]"

                else:
                    logger.debug(f"Ignoring unsupported message type: {msg_type}")
                    return

            except (json.JSONDecodeError, TypeError):
                content = message.content or ""

            if not content:
                return

            # Download images from Feishu
            if image_keys and message_id:
                for img_key in image_keys:
                    local_path = await self._download_feishu_image(message_id, img_key)
                    if local_path:
                        media_paths.append(local_path)

            logger.info(
                f"Feishu {msg_type} from {sender_id}: {content[:100]}..."
                + (f" ({len(media_paths)} media files)" if media_paths else "")
            )

            # Acknowledge receipt with an emoji reaction (fire-and-forget)
            if message_id:
                asyncio.create_task(self._add_reaction(message_id, "DONE"))

            # Forward to the message bus
            await self._handle_message(
                sender_id=sender_id,
                chat_id=chat_id,
                content=content,
                media=media_paths if media_paths else None,
                metadata=metadata,
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
            # Read file bytes into memory first, then wrap in BytesIO.
            # This avoids leaking file handles (the old `open(path, "rb")`
            # was never closed, causing FD exhaustion on repeated compiles).
            file_bytes = path.read_bytes()
            file_stream = io.BytesIO(file_bytes)

            upload_body = (
                CreateFileRequestBody.builder()
                .file_type(file_type)
                .file_name(path.name)
                .file(file_stream)
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
