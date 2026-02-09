#!/usr/bin/env python3
"""
Litewrite nanobot Service
=========================

AI assistant gateway for Litewrite, providing:
- Feishu bot integration (WebSocket long-connection)
- Litewrite project operations (list/read/edit/compile via Internal API)
- LLM-powered agent with tool use

Usage:
    python main.py
    python main.py --verbose

Environment variables (set via docker-compose):
    NANOBOT__LITEWRITE__URL            Litewrite API base URL
    NANOBOT__LITEWRITE__API_SECRET     Internal API secret
    NANOBOT__CHANNELS__FEISHU__ENABLED Enable Feishu channel
    NANOBOT__CHANNELS__FEISHU__APP_ID  Feishu App ID
    NANOBOT__CHANNELS__FEISHU__APP_SECRET  Feishu App Secret
    NANOBOT__PROVIDERS__OPENROUTER__API_KEY  LLM API key
"""

import asyncio
import sys
from pathlib import Path

# Ensure the nanobot package is importable
sys.path.insert(0, str(Path(__file__).parent))

from loguru import logger  # noqa: E402


def main():
    """Start the nanobot gateway."""
    from nanobot.config.loader import load_config
    from nanobot.bus.queue import MessageBus
    from nanobot.providers.litellm_provider import LiteLLMProvider
    from nanobot.agent.loop import AgentLoop
    from nanobot.channels.manager import ChannelManager

    verbose = "--verbose" in sys.argv or "-v" in sys.argv

    if verbose:
        import logging

        logging.basicConfig(level=logging.DEBUG)

    logger.info("Starting nanobot gateway...")

    config = load_config()

    # Create message bus
    bus = MessageBus()

    # Create LLM provider
    api_key = config.get_api_key()
    api_base = config.get_api_base()

    if not api_key:
        logger.error(
            "No API key configured. Set NANOBOT__PROVIDERS__OPENROUTER__API_KEY"
        )
        sys.exit(1)

    provider = LiteLLMProvider(
        api_key=api_key,
        api_base=api_base,
        default_model=config.agents.defaults.model,
    )

    # Create agent loop
    agent = AgentLoop(
        bus=bus,
        provider=provider,
        workspace=config.workspace_path,
        model=config.agents.defaults.model,
        max_iterations=config.agents.defaults.max_tool_iterations,
        brave_api_key=config.tools.web.search.api_key or None,
        exec_config=config.tools.exec,
        litewrite_config=config.litewrite,
        feishu_config=config.channels.feishu,
    )

    # Create channel manager
    channels = ChannelManager(config, bus)

    if channels.enabled_channels:
        logger.info(
            "Channels enabled: {}",
            ", ".join(channels.enabled_channels),
        )
    else:
        logger.warning("No channels enabled")

    if config.litewrite.api_secret:
        logger.info("Litewrite integration: {}", config.litewrite.url)
    else:
        logger.warning("Litewrite integration not configured (no api_secret)")

    async def run():
        try:
            await asyncio.gather(
                agent.run(),
                channels.start_all(),
            )
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            agent.stop()
            await channels.stop_all()

    print("=" * 50)
    print("Litewrite nanobot Service")
    print("=" * 50)
    print(f"  LLM Model:  {config.agents.defaults.model}")
    print(f"  Litewrite:  {config.litewrite.url}")
    enabled = ", ".join(channels.enabled_channels) or "none"
    print(f"  Channels:   {enabled}")
    print("=" * 50)

    asyncio.run(run())


if __name__ == "__main__":
    main()
