"""
Services
========

Primary services:
1. TAP: LaTeX completion
2. DeepResearch: deep research report generation
3. Chat 1.5: chat/agent (Q&A + editing) using MainAgent + SubAgent architecture

Each service typically has:
- service.py: core logic
- README.md: documentation

Usage:
    from services.tap import TAPService
    from services.deep_research import DeepResearchService
    from services.chat_1_5 import ChatService
"""

from services.tap.service import TAPService
from services.deep_research.service import DeepResearchService
from services.chat_1_5.service import ChatService

__all__ = [
    "TAPService",
    "DeepResearchService",
    "ChatService",
]
