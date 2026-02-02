"""
List Files Tool
===============

Tool for listing project files via Next.js internal API.

This tool allows the Agent to get the current project file structure
in real-time, which is important in collaborative editing scenarios
where files may be added/deleted by other users.

The tool calls Next.js internal API directly via HTTP.

Usage by Agent:
    {
        "tool": "list_files",
        "params": {
            "directory": "",        # Optional: subdirectory to list
            "recursive": true,      # Optional: list recursively
            "pattern": "*.tex"      # Optional: filter by pattern
        }
    }
"""

from typing import Dict, Any, Optional
import httpx
import logging
from tools.base import (
    Tool,
    ToolResult,
    ToolContext,
    ToolMode,
    ExecutorType,
)
from core.config import config

logger = logging.getLogger(__name__)

# HTTP timeout for Next.js API calls
HTTP_TIMEOUT = 30.0  # seconds


class ListFilesTool(Tool):
    """
    Tool for listing project files.

    Features:
    - Calls Next.js internal API directly via HTTP
    - Supports directory filtering
    - Supports recursive listing
    - Supports pattern matching (e.g., *.tex)
    - Available in both Ask and Agent modes

    This is useful for:
    - Understanding project structure
    - Finding relevant files before reading
    - Checking if a file exists before editing
    """

    name = "list_files"
    description = """List files in the project.

Use this tool to:
- Understand the project structure
- Find relevant files before reading them
- Check what files exist in a directory
- Find files matching a pattern (e.g., all .tex files)

Parameters:
- directory (optional): Subdirectory to list. Empty string for project root.
- recursive (optional): Whether to list files in subdirectories. Default: true.
- pattern (optional): Filter files by pattern. E.g., "*.tex", "*.png", "chapter*.tex"

Returns a list of files with their paths and types (file/directory)."""

    parameters = {
        "type": "object",
        "properties": {
            "directory": {
                "type": "string",
                "description": "Directory to list. Empty string or omit for project root. E.g., 'chapters/', 'images/'",
                "default": "",
            },
            "recursive": {
                "type": "boolean",
                "description": "Whether to list files recursively in subdirectories. Default: true.",
                "default": True,
            },
            "pattern": {
                "type": "string",
                "description": "Optional filter pattern. E.g., '*.tex' for all LaTeX files, '*.png' for images.",
            },
        },
        "required": [],
    }

    mode = ToolMode.ALL  # Available in both Ask and Agent modes
    executor = ExecutorType.LOCAL  # Direct HTTP call, no SSE delegation

    async def execute(
        self,
        params: Dict[str, Any],
        context: ToolContext,
        timeout: float = HTTP_TIMEOUT,
    ) -> ToolResult:
        """
        Execute the list_files tool via HTTP call to Next.js.

        Args:
            params: {
                "directory": str,   # Optional: subdirectory
                "recursive": bool,  # Optional: recursive listing
                "pattern": str,     # Optional: filter pattern
            }
            context: Execution context with emitter
            timeout: HTTP timeout in seconds (default: 30s)

        Returns:
            ToolResult with file listing
        """
        directory = params.get("directory", "")
        recursive = params.get("recursive", True)
        pattern = params.get("pattern")

        # Emit status
        dir_display = directory if directory else "project root"
        context.emit_status(f"Listing files in {dir_display}...")

        # Build request payload
        payload = {
            "projectId": context.project_id,
            "directory": directory,
            "recursive": recursive,
        }

        # Add optional pattern
        if pattern:
            payload["pattern"] = pattern

        # Make HTTP call to Next.js internal API
        url = f"{config.nextjs_api_url}/api/internal/files/list"
        logger.info(f"[ListFiles] Calling {url} for dir={directory}")
        logger.debug(f"[ListFiles] Payload: {payload}")

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

                logger.info(f"[ListFiles] Response status: {response.status_code}")

                # Check if response is valid before parsing
                if response.status_code != 200:
                    logger.error(
                        f"[ListFiles] HTTP error {response.status_code}: {response.text[:500]}"
                    )
                    return ToolResult(
                        success=False,
                        text=f"HTTP error {response.status_code} listing files",
                        error=f"HTTP {response.status_code}",
                    )

                # Try to parse JSON
                try:
                    result = response.json()
                except Exception as json_err:
                    logger.error(
                        f"[ListFiles] JSON parse error: {json_err}, response text: {response.text[:500]}"
                    )
                    return ToolResult(
                        success=False,
                        text="Invalid response from server",
                        error=f"JSON parse error: {json_err}",
                    )

                logger.debug(
                    f"[ListFiles] Response: success={result.get('success')}, dir={directory}"
                )

                return self._process_result(result, directory, pattern)

        except httpx.TimeoutException:
            logger.error(f"[ListFiles] Timeout listing {directory}")
            return ToolResult(
                success=False,
                text="Timeout listing files",
                error=f"HTTP timeout after {timeout}s",
            )
        except httpx.ConnectError as e:
            logger.error(f"[ListFiles] Connection error to {url}: {e}")
            return ToolResult(
                success=False,
                text="Cannot connect to Next.js server",
                error=f"Connection error: {e}",
            )
        except Exception as e:
            logger.error(f"[ListFiles] Error listing {directory}: {e}")
            return ToolResult(
                success=False,
                text=f"Error listing files: {str(e)}",
                error=str(e),
            )

    def _process_result(
        self,
        result: Dict[str, Any],
        directory: str,
        pattern: Optional[str],
    ) -> ToolResult:
        """
        Process the result from Next.js execution.

        Args:
            result: Result from Next.js, expected format:
                {
                    "success": bool,
                    "data": {
                        "files": [
                            {"path": str, "type": "file"|"directory"},
                            ...
                        ],
                        "total": int
                    },
                    "error": str | None
                }
            directory: The directory that was listed
            pattern: The filter pattern used (if any)

        Returns:
            ToolResult with formatted file listing
        """
        if not result.get("success"):
            error_msg = result.get("error", "Unknown error")
            return ToolResult(
                success=False,
                text=f"Failed to list files: {error_msg}",
                error=error_msg,
            )

        data = result.get("data", {})
        files = data.get("files", [])
        total = data.get("total", len(files))

        # Format files for display
        dir_display = directory if directory else "project root"

        if not files:
            text = f"No files found in {dir_display}"
            if pattern:
                text += f" matching '{pattern}'"
            return ToolResult(
                success=True,
                text=text,
                data={"files": [], "total": 0, "directory": directory},
            )

        # Group files by type for better readability
        directories = [f for f in files if f.get("type") == "directory"]
        regular_files = [f for f in files if f.get("type") != "directory"]

        # Build text output
        lines = [f"Files in {dir_display} ({total} items):"]

        if pattern:
            lines[0] += f" [filter: {pattern}]"

        lines.append("")

        # List directories first
        if directories:
            lines.append("Directories:")
            for d in directories[:20]:  # Limit display
                lines.append(f"  [dir] {d.get('path', 'unknown')}/")
            if len(directories) > 20:
                lines.append(f"  ... and {len(directories) - 20} more directories")
            lines.append("")

        # Then list files
        if regular_files:
            lines.append("Files:")
            for f in regular_files[:50]:  # Limit display
                path = f.get("path", "unknown")
                lines.append(f"  - {path}")
            if len(regular_files) > 50:
                lines.append(f"  ... and {len(regular_files) - 50} more files")

        text = "\n".join(lines)

        return ToolResult(
            success=True,
            text=text,
            data={
                "files": files,
                "total": total,
                "directory": directory,
                "pattern": pattern,
                "directories_count": len(directories),
                "files_count": len(regular_files),
            },
        )


__all__ = ["ListFilesTool"]
