"""
Read File Tool
==============

Tool for reading project files.

This tool calls Next.js internal API directly via HTTP to read files.
No SSE delegation needed - simple request/response pattern.

Next.js has direct access to:
- Yjs WebSocket server (live content)
- S3 storage
- Shadow documents (pending edits)

Execution flow:
1. Agent calls read_file tool
2. Tool makes HTTP POST to Next.js /api/internal/files/read
3. Next.js returns file content directly
4. Tool returns content to Agent

Usage by Agent:
    {"tool": "read_file", "params": {"file_path": "main.tex"}}
"""

from typing import Dict, Any, List, Optional
import httpx
import logging

from tools.base import Tool, ToolResult, ToolContext, ToolMode, ExecutorType
from core.config import config

logger = logging.getLogger(__name__)

# HTTP timeout for Next.js API calls
HTTP_TIMEOUT = 30.0  # seconds


def add_line_numbers(
    content: str,
    start_line: int = 1,
    locked_ranges: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """
    Add line numbers to content for precise positioning.

    Format:
    - Normal line: [Line X] content
    - Locked line: [Line X, Locked by UserName] content

    Args:
        content: The text content to add line numbers to
        start_line: Starting line number (1-based)
        locked_ranges: List of lock info dicts with startLine, endLine, userName

    Returns:
        Content with each line prefixed by line number
    """
    lines = content.split("\n")
    numbered_lines = []
    locked_ranges = locked_ranges or []

    for i, line in enumerate(lines, start=start_line):
        # Check if this line is locked by another user
        lock_user = None
        for lock in locked_ranges:
            lock_start = lock.get("startLine", 0)
            lock_end = lock.get("endLine", 0)
            if lock_start <= i <= lock_end:
                lock_user = lock.get("userName", "another user")
                break

        if lock_user:
            numbered_lines.append(f"[Line {i}, Locked by {lock_user}] {line}")
        else:
            numbered_lines.append(f"[Line {i}] {line}")

    return "\n".join(numbered_lines)


class ReadFileTool(Tool):
    """
    Tool for reading project files.

    Features:
    - Calls Next.js internal API directly via HTTP
    - Simple request/response pattern (no SSE delegation)
    - Supports line range reading
    - Emits file_locked event for vibe lock
    - Available in both Ask and Agent modes
    """

    name = "read_file"
    description = """Read the content of a specific file from the project.

Usage tips:
- To read the entire file, just provide file_path (no start_line/end_line needed)
- When reading a specific section, expand the range slightly (e.g., add 5-10 lines before and after) to get more context
- Lines marked with [Locked by UserName] are being edited by others - do not modify them"""

    parameters = {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the file, relative to project root (e.g., 'main.tex', 'figs/case.tex', 'sections/intro.tex'). Use list_files to see available files.",
            },
            "start_line": {
                "type": "integer",
                "description": "Start line number (1-indexed). Omit to read from beginning. Tip: expand range for more context.",
            },
            "end_line": {
                "type": "integer",
                "description": "End line number (1-indexed). Omit to read to end. Tip: expand range for more context.",
            },
        },
        "required": ["file_path"],
    }

    mode = ToolMode.ALL
    executor = ExecutorType.LOCAL  # Direct HTTP call, no SSE delegation

    async def execute(
        self,
        params: Dict[str, Any],
        context: ToolContext,
        timeout: float = HTTP_TIMEOUT,
    ) -> ToolResult:
        """
        Execute the read_file tool.

        Makes HTTP call to Next.js internal API to read file content.

        Args:
            params: {"file_path": str, "start_line"?: int, "end_line"?: int}
            context: Execution context
            timeout: HTTP timeout in seconds (default: 30s)

        Returns:
            ToolResult with file content or error
        """
        file_path = params.get("file_path")

        if not file_path:
            return ToolResult(
                success=False,
                text="No file path provided",
                error="file_path is required",
            )

        # Emit status
        context.emit_status(f"Reading {file_path}...")

        # Emit file_locked event - prevents others from modifying during read
        context.emit("file_locked", {"filePath": file_path})

        # Build request payload
        payload = {
            "projectId": context.project_id,
            "userId": context.user_id,
            "filePath": file_path,
        }

        # Add optional line range
        if params.get("start_line"):
            payload["startLine"] = params["start_line"]
        if params.get("end_line"):
            payload["endLine"] = params["end_line"]

        # Make HTTP call to Next.js internal API
        url = f"{config.nextjs_api_url}/api/internal/files/read"
        logger.info(f"[ReadFile] Calling {url} for {file_path}")
        logger.debug(f"[ReadFile] Payload: {payload}")

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "X-Internal-Secret": config.internal_api_secret,
                    },
                )

                logger.info(f"[ReadFile] Response status: {response.status_code}")

                # Check if response is valid before parsing
                if response.status_code != 200:
                    logger.error(
                        f"[ReadFile] HTTP error {response.status_code}: {response.text[:500]}"
                    )
                    return ToolResult(
                        success=False,
                        text=f"HTTP error {response.status_code} reading file",
                        error=f"HTTP {response.status_code}",
                    )

                # Try to parse JSON
                try:
                    result = response.json()
                except Exception as json_err:
                    logger.error(
                        f"[ReadFile] JSON parse error: {json_err}, response text: {response.text[:500]}"
                    )
                    return ToolResult(
                        success=False,
                        text="Invalid response from server",
                        error=f"JSON parse error: {json_err}",
                    )

                logger.debug(
                    f"[ReadFile] Response: success={result.get('success')}, file={file_path}"
                )

                return self._process_result(result, file_path)

        except httpx.TimeoutException:
            logger.error(f"[ReadFile] Timeout reading {file_path}")
            return ToolResult(
                success=False,
                text=f"Timeout reading file: {file_path}",
                error=f"HTTP timeout after {timeout}s",
            )
        except httpx.ConnectError as e:
            logger.error(f"[ReadFile] Connection error to {url}: {e}")
            return ToolResult(
                success=False,
                text="Cannot connect to Next.js server",
                error=f"Connection error: {e}",
            )
        except Exception as e:
            logger.error(f"[ReadFile] Error reading {file_path}: {e}")
            return ToolResult(
                success=False,
                text=f"Error reading file: {str(e)}",
                error=str(e),
            )

    def _process_result(
        self,
        result: Dict[str, Any],
        file_path: str,
    ) -> ToolResult:
        """
        Process the result from Next.js execution.

        Adds line numbers to content for precise Agent positioning.
        Locked ranges are extracted from the Next.js response.

        Args:
            result: Result from Next.js, expected format:
                {
                    "success": bool,
                    "data": {
                        "content": str,
                        "lineRange": {"start": int, "end": int} | None,
                        "totalLines": int,
                        "lockedRanges": [{"startLine": int, "endLine": int, "userName": str}] | None
                    },
                    "error": str | None
                }
            file_path: Original file path

        Returns:
            ToolResult with line-numbered file content
        """
        if not result.get("success"):
            return ToolResult(
                success=False,
                text=f"Failed to read file: {result.get('error', 'Unknown error')}",
                error=result.get("error"),
            )

        data = result.get("data", {})
        content = data.get("content", "")
        line_range = data.get("lineRange")
        total_lines = data.get("totalLines")
        locked_ranges = data.get("lockedRanges")  # Line-level locks
        vibe_lock = data.get("vibeLock", {})  # Entire file lock

        # Determine starting line number
        start_line = line_range.get("start", 1) if line_range else 1

        # Add line numbers to content (with lock indicators if present)
        numbered_content = add_line_numbers(content, start_line, locked_ranges)

        # Build result text for Agent
        if line_range:
            header = f"Content of {file_path} (lines {line_range['start']}-{line_range['end']}):"
        else:
            lines_info = f" ({total_lines} lines)" if total_lines else ""
            header = f"Content of {file_path}{lines_info}:"

        # Add vibe lock warning if the file is locked by another user's AI
        vibe_lock_warning = ""
        is_vibe_locked = vibe_lock.get("isLocked", False)
        if is_vibe_locked:
            locked_by = vibe_lock.get("lockedBy", {})
            user_name = locked_by.get("userName", "another user")
            vibe_lock_warning = (
                f"[WARNING: This file is currently being processed by {user_name}'s AI.\n"
                f" You can READ the content but CANNOT EDIT until they finish.]\n\n"
            )

        text = f"{vibe_lock_warning}{header}\n\n{numbered_content}"

        return ToolResult(
            success=True,
            text=text,
            data={
                "file_path": file_path,
                "content": content,  # Raw content without line numbers
                "numbered_content": numbered_content,  # Content with line numbers
                "line_range": line_range,
                "total_lines": total_lines,
                "locked_ranges": locked_ranges,  # Line-level locks
                "vibe_lock": vibe_lock,  # Entire file lock info
                "is_vibe_locked": is_vibe_locked,  # Quick check flag
            },
        )


__all__ = ["ReadFileTool", "add_line_numbers"]
