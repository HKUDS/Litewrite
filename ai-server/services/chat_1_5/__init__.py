"""
Chat Service 1.5 - New Agent Architecture
==========================================

A MainAgent + SubAgent + Tools architecture for Ask/Agent modes.

Features:
- Unified Agent Loop (BaseAgent)
- MainAgent for orchestration
- SubAgents for specialized tasks
- Mode-based tool filtering (Ask vs Agent)
- Reuses existing Tool Layer

Usage:
    from services.chat_1_5 import ChatService

    service = ChatService()
    async for event in service.run(
        project_id="xxx",
        user_id="yyy",
        query="Help me write an introduction",
        mode="agent",
    ):
        print(event)

Debug Mode:
    CHAT_DEBUG=1 python main.py

    Debug logs will be:
    - Printed to console (short format)
    - Written to logs/chat_1_5.log (detailed format)
"""

import os
import logging
from pathlib import Path

# ============================================================================
# Logger Configuration for Chat 1.5
# ============================================================================

CHAT_DEBUG = os.getenv("CHAT_DEBUG", "0").lower() in ("1", "true", "yes")
LOG_DIR = Path(__file__).parent.parent.parent / "logs"
LOG_FILE = LOG_DIR / "chat_1_5.log"


def _setup_chat_1_5_logging():
    """
    Configure logging for chat_1_5 module and tools module.

    When CHAT_DEBUG=1:
    - Sets level to DEBUG
    - Outputs to console (short format)
    - Writes to logs/chat_1_5.log (detailed format)

    Also configures tools module logging to the same file.
    """
    # Get the root logger for chat_1_5 module
    logger = logging.getLogger("services.chat_1_5")

    # Also configure the agents and subagents loggers
    agent_logger = logging.getLogger("services.chat_1_5.agents")
    subagent_logger = logging.getLogger("services.chat_1_5.subagents")

    # Configure tools module loggers (so tool logs also go to chat_1_5.log)
    tools_logger = logging.getLogger("tools")

    # Configure api.chat logger (so api/chat.py logs also go to chat_1_5.log)
    api_chat_logger = logging.getLogger("api.chat")

    # All loggers to configure
    all_loggers = [logger, agent_logger, subagent_logger, tools_logger, api_chat_logger]

    if CHAT_DEBUG:
        # Set level to DEBUG
        for lg in all_loggers:
            lg.setLevel(logging.DEBUG)

        # Create logs directory
        LOG_DIR.mkdir(parents=True, exist_ok=True)

        # Console formatter (short)
        console_formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(message)s",
            datefmt="%H:%M:%S",
        )

        # File formatter (detailed)
        file_formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

        # Console handler
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.DEBUG)
        console_handler.setFormatter(console_formatter)

        # File handler
        file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(file_formatter)

        # Add handlers to loggers (avoid duplicates)
        for lg in all_loggers:
            has_console = any(
                isinstance(h, logging.StreamHandler)
                and not isinstance(h, logging.FileHandler)
                for h in lg.handlers
            )
            has_file = any(
                isinstance(h, logging.FileHandler) and h.baseFilename == str(LOG_FILE)
                for h in lg.handlers
            )

            if not has_console:
                lg.addHandler(console_handler)
            if not has_file:
                lg.addHandler(file_handler)

            # Don't propagate to root logger (avoid duplicate output)
            lg.propagate = False

        print(f"[ChatService 1.5] DEBUG mode enabled. Log file: {LOG_FILE}")
    else:
        # Default level (INFO for tools to see important logs)
        logger.setLevel(logging.INFO)
        agent_logger.setLevel(logging.INFO)
        subagent_logger.setLevel(logging.INFO)
        tools_logger.setLevel(logging.INFO)

        # Even in non-debug mode, write tools INFO logs to file
        LOG_DIR.mkdir(parents=True, exist_ok=True)

        file_formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

        file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(file_formatter)

        # Add file handler to tools logger
        has_file = any(
            isinstance(h, logging.FileHandler) and h.baseFilename == str(LOG_FILE)
            for h in tools_logger.handlers
        )
        if not has_file:
            tools_logger.addHandler(file_handler)
        tools_logger.propagate = False


# Initialize logging on import
_setup_chat_1_5_logging()

from services.chat_1_5.service import ChatService

__all__ = ["ChatService", "CHAT_DEBUG"]
