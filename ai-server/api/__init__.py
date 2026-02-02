"""
API - unified routes
====================

REST endpoints:
- /api/tap/complete: TAP completion
- /api/deep-research/stream: Deep research (SSE)
- /api/chat/run: Chat (SSE)
- /api/ai-draw/chat: AI Draw (SSE)
- /api/ai-table/chat: AI Table (SSE)

Usage:
    from api import create_app

    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=6612)
"""

from api.app import create_app, app

__all__ = ["create_app", "app"]
