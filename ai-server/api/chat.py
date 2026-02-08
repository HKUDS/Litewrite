"""
Chat API Router
===============

Unified API for Chat modes (Q&A and editing).

Modes:
- ask: Read-only Q&A mode with context gathering
- agent: Full agent mode with file editing capabilities

Flow:
1. Next.js sends request with session history and mode
2. AI Agent decides if tools are needed
3. If tools needed: emit tool_call event, wait for results
4. Next.js executes tools and sends results back via /api/tools/result
5. PendingCallsManager resolves the waiting Future
6. Agent continues with tool result and generates response

Endpoints:
- POST /run: Main chat endpoint (SSE streaming)
- POST /continue: Continue after tool execution (legacy)
"""

import logging
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class LineRange(BaseModel):
    """Line range"""

    start: int
    end: int


class Attachment(BaseModel):
    """Attachment reference"""

    type: str  # "file" | "selection"
    filePath: str
    content: Optional[str] = None  # File content (filled by Next.js)
    lineRange: Optional[LineRange] = None


class SessionMessageItem(BaseModel):
    """Item in session message (new format)"""

    type: str  # "text" | "action"
    content: Optional[str] = None  # For text items
    action: Optional[Dict[str, Any]] = None  # For action items


class SessionMessage(BaseModel):
    """Message from session history (supports both new items format and legacy content format)"""

    role: str  # "user" | "assistant"
    # New format: ordered list of text and action items
    items: Optional[List[SessionMessageItem]] = None
    # Legacy format: plain content string
    content: Optional[str] = None
    fileRefs: Optional[List[Dict[str, Any]]] = None
    hasLatex: Optional[bool] = False
    actions: Optional[List[Dict[str, Any]]] = (
        None  # Actions performed by assistant (legacy)
    )
    latexBlocks: Optional[List[Dict[str, Any]]] = None  # LaTeX blocks (legacy)
    diagrams: Optional[List[Dict[str, Any]]] = None  # Draw.io diagrams
    timestamp: Optional[int] = None

    def get_text_content(self) -> str:
        """Extract text content from items (new format) or content field (legacy)"""
        if self.items:
            # New format: join all text items
            return "".join(
                item.content or ""
                for item in self.items
                if item.type == "text" and item.content
            )
        # Legacy format
        return self.content or ""


class ToolResult(BaseModel):
    """Tool execution result from Next.js"""

    callId: str
    type: str  # "read_file" | "search_keyword" | "search_section" | "list_files"
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class ChatRequest(BaseModel):
    """Chat request with session support (Ask + Agent modes)"""

    projectId: str
    message: str
    attachments: List[Attachment] = []
    # Actor/user id for file locks & pending edits attribution (NOT payments/credits)
    actorId: Optional[str] = None

    # Mode: "ask" (read-only) or "agent" (full editing)
    mode: str = "ask"

    # Direct apply mode: when True, file edits are written directly to storage
    # instead of creating shadow documents. Used by nanobot/API consumers.
    directApply: bool = False

    # Session support
    sessionId: Optional[str] = None

    # Compressed history (preferred) - pre-formatted history string
    # This replaces the history array for context management
    compressedHistory: Optional[str] = None

    # Legacy history format (deprecated, use compressedHistory instead)
    history: Optional[List[SessionMessage]] = []
    referencedFiles: Optional[List[str]] = []

    # Historical attached contents: key = "filename (lines x-y)", value = content
    attachedContents: Optional[Dict[str, str]] = {}

    # Project context
    fileList: Optional[List[str]] = None

    # Tool results (for continuation after tool_call)
    toolResults: Optional[List[ToolResult]] = None

    # [DEPRECATED] File locks - no longer used, read_file tool shows locks directly
    # Kept for backward compatibility with frontend
    fileLocks: Optional[Dict[str, List[Dict[str, Any]]]] = None

    # Legacy fields
    projectContent: Optional[str] = None
    conversationId: Optional[str] = None


class SyncChatRequest(BaseModel):
    """Synchronous chat request for programmatic invocation (e.g., from nanobot)"""

    projectId: str
    message: str
    userId: Optional[str] = None
    mode: str = "agent"
    referencedFiles: Optional[List[str]] = []
    conversationHistory: Optional[List[Dict[str, Any]]] = None


# ============================================================================
# API Endpoints
# ============================================================================


@router.post("/run")
async def run_chat(request: ChatRequest):
    """
    Chat execution endpoint (SSE streaming output)

    Supports both Ask (read-only Q&A) and Agent (editing) modes.

    Flow:
    1. Receives request with session history, mode, and current message
    2. Agent analyzes if tools are needed
    3. If tools needed: emits tool_call event
    4. If toolResults provided: continues with gathered context
    5. Generates and streams response

    Events (all modes):
    - status: Status updates
    - message: Message content (streaming)
    - suggestion: Action suggestions
    - reference: Context references
    - tool_call: Agent requests tool execution
    - context: Agent using context
    - done: Completion
    - error: Errors

    Events (Agent mode only):
    - file_edit: File edit request (Search/Replace)
    """
    from services.chat_1_5 import ChatService

    service = ChatService(verbose=True)

    # Convert attachments format
    attachments = [
        {
            "type": att.type,
            "filePath": att.filePath,
            "content": att.content,
            "lineRange": att.lineRange.model_dump() if att.lineRange else None,
        }
        for att in request.attachments
    ]

    # Convert history format (supports both new items format and legacy content format)
    logger.debug(
        f"[chat.py] request.history has {len(request.history) if request.history else 0} messages"
    )
    if request.history and len(request.history) > 0:
        first_msg = request.history[0]
        logger.debug(
            f"[chat.py] First history message: role={first_msg.role}, items={first_msg.items}, content={first_msg.content[:50] if first_msg.content else 'None'}..."
        )
    history = [
        {
            "role": msg.role,
            "content": msg.get_text_content(),  # Extract text from items or use legacy content
            "fileRefs": msg.fileRefs,
            "hasLatex": msg.hasLatex,
            "timestamp": msg.timestamp,
            "actions": msg.actions,
            "latexBlocks": msg.latexBlocks,  # Include LaTeX blocks (tables, etc.)
            "diagrams": msg.diagrams,  # Include diagrams
        }
        for msg in (request.history or [])
    ]
    logger.debug(f"[chat.py] Converted history: {len(history)} messages")

    async def event_generator():
        async for output in service.run(
            project_id=request.projectId,
            user_message=request.message,
            history=history,
            compressed_history=request.compressedHistory,  # New: pre-formatted history
            attachments=attachments,
            referenced_files=request.referencedFiles or [],
            attached_contents=request.attachedContents or {},
            session_id=request.sessionId or request.conversationId,
            mode=request.mode,  # "ask" or "agent"
            user_id=request.actorId,
        ):
            yield output.to_sse()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/continue")
async def continue_with_tools(request: ChatRequest):
    """
    [DEPRECATED] Continue generation after tool execution

    This endpoint is deprecated. The agent now executes tools internally
    and does not require external tool results. Use /run instead.
    """
    return {
        "error": "This endpoint is deprecated. The agent now handles tool execution internally. Use /run instead.",
        "code": "ENDPOINT_DEPRECATED",
    }


@router.get("/health")
async def health():
    """Health check"""
    return {"status": "ok", "service": "chat", "version": "2.0"}


@router.get("/config")
async def get_config():
    """
    Get chat configuration for frontend sync.

    Returns context window limits and compression settings.
    This allows frontend to display accurate progress indicators.
    """
    from core.config import config

    return {
        "historyLimit": config.context_history_limit,
        "executionLimit": config.context_execution_limit,
        "compressionThreshold": config.context_compression_threshold,
        "compressionTarget": config.context_compression_target,
    }


@router.post("/run-sync")
async def run_chat_sync(request: SyncChatRequest):
    """
    Synchronous chat endpoint for programmatic invocation.

    Unlike /run which streams SSE events, this endpoint waits for the agent
    to complete and returns a JSON response. Used by nanobot and other API
    consumers that need to invoke litewrite's built-in AI agent.

    The agent runs in direct-apply mode: file edits are written directly
    to storage (via /api/internal/files/edit) instead of creating shadow
    documents that require frontend review.

    Returns:
        JSON with success status and the agent's response text.
    """
    from services.chat_1_5 import ChatService

    service = ChatService(verbose=True)

    # Build query with file references if provided
    query_parts = [request.message]
    if request.referencedFiles:
        refs = [f"[[FILE:{f}]]" for f in request.referencedFiles]
        query_parts = [" ".join(refs) + " " + request.message]
    query = "\n".join(query_parts)

    try:
        result = await service.run_sync(
            project_id=request.projectId,
            user_id=request.userId or "",
            query=query,
            mode=request.mode,
            conversation_history=request.conversationHistory,
            direct_apply=True,  # Always direct-apply for sync endpoint
        )

        return {
            "success": True,
            "response": result,
        }

    except Exception as e:
        logger.error(f"[run-sync] Error: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "response": "",
        }
