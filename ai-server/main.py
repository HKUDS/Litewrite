#!/usr/bin/env python3
"""
Litewrite AI Server
===================

AI services for collaborative writing:
1. TAP: code completion
2. DeepResearch: deep research report generation
3. Chat: chat/agent (Q&A + editing)
4. AI Draw: Draw.io diagram generation
5. AI Table: LaTeX table generation

Usage:
    # Start server
    python main.py

    # Enable Chat Agent debug mode
    CHAT_DEBUG=1 python main.py
    # or
    python main.py --chat-debug

    # or with uvicorn
    uvicorn main:app --host 0.0.0.0 --port 6612 --reload

API docs:
    - Swagger UI: http://localhost:6612/docs
    - ReDoc: http://localhost:6612/redoc

Logs:
    - Chat Agent logs: ai-server/logs/chat_agent.log (when CHAT_DEBUG=1)
"""

import os
import sys
import logging
import argparse
from pathlib import Path

# Ensure we can import core/tools/services/api
sys.path.insert(0, str(Path(__file__).parent))


# ============================================================================
# CLI args - MUST run before importing app!
# ============================================================================
# Reason: services/chat/logger.py reads CHAT_DEBUG at import time.
# Import chain: api.app -> api.tap -> services.tap -> services/__init__.py
#             -> services.chat.service -> services.chat.logger
# Therefore we must set env vars before `from api.app import app`.
# ============================================================================


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description="Litewrite AI Server")
    parser.add_argument(
        "--chat-debug",
        action="store_true",
        help="Enable Chat Agent debug logging (writes to logs/chat_agent.log)",
    )
    parser.add_argument("--port", type=int, default=None, help="Override API port")
    return parser.parse_args()


# Only parse args / set env vars when executed as __main__.
# (uvicorn reload won't enter this block, but will inherit env vars.)
if __name__ == "__main__":
    _args = parse_args()
    if _args.chat_debug:
        os.environ["CHAT_DEBUG"] = "1"


# Logging setup
def setup_logging():
    """Configure logging."""
    # Formatter
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    # TAP logger (configure on parent; children inherit)
    tap_logger = logging.getLogger("tap")
    tap_logger.setLevel(logging.INFO)
    # Avoid duplicate handlers
    if not tap_logger.handlers:
        tap_logger.addHandler(console_handler)
    # Do not propagate to avoid duplicate output
    tap_logger.propagate = False


setup_logging()

# Import app instance (required by uvicorn/gunicorn)
from api.app import app  # noqa: F401 - gunicorn references main:app

if __name__ == "__main__":
    import uvicorn
    from core.config import config

    # Use args parsed above (_args is set before importing app)
    # Override port if specified
    port = _args.port or config.api_port

    # Check if CHAT_DEBUG is enabled
    chat_debug = os.getenv("CHAT_DEBUG", "0").lower() in ("1", "true", "yes")

    print("=" * 60)
    print("Litewrite AI Server v2.0.0")
    print("=" * 60)
    print(f"API Port: {port}")
    print(f"LLM Model: {config.llm_model}")
    print("=" * 60)
    print("Services:")
    print("  - TAP:          POST /api/tap/complete")
    print("  - DeepResearch: POST /api/deep-research/stream")
    print("  - Chat:         POST /api/chat/run")
    print("  - AI Draw:      POST /api/ai-draw/chat")
    print("  - AI Table:     POST /api/ai-table/chat")
    print("=" * 60)
    if chat_debug:
        print("🔍 CHAT DEBUG MODE ENABLED")
        print("   Logs: ai-server/logs/chat_agent.log")
        print("=" * 60)
    print(f"Docs:      http://localhost:{port}/docs")
    print("=" * 60)

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )
