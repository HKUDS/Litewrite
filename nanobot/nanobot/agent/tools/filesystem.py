"""File system tools: read, write, edit."""

from pathlib import Path
from typing import Any


from nanobot.agent.tools.base import Tool


def _resolve_and_check(
    raw_path: str, workspace: Path | None
) -> tuple[Path | None, str]:
    """
    Resolve a path and verify it is within the allowed workspace.

    Returns (resolved_path, error_message).  error_message is empty on success.
    """
    try:
        file_path = Path(raw_path).expanduser().resolve()
    except Exception as e:
        return None, f"Invalid path: {e}"

    if workspace is not None:
        ws = workspace.expanduser().resolve()
        # Allow paths under workspace or under ~/.nanobot (data dir)
        nanobot_data = Path.home() / ".nanobot"
        nanobot_data_resolved = nanobot_data.resolve()
        if not (
            file_path == ws
            or ws in file_path.parents
            or file_path == nanobot_data_resolved
            or nanobot_data_resolved in file_path.parents
        ):
            return None, (
                f"Error: Access denied. Path '{raw_path}' is outside the allowed workspace. "
                f"Allowed: {ws} and {nanobot_data_resolved}"
            )

    return file_path, ""


class ReadFileTool(Tool):
    """Tool to read file contents."""

    def __init__(self, workspace: Path | None = None):
        self._workspace = workspace

    @property
    def name(self) -> str:
        return "read_file"

    @property
    def description(self) -> str:
        return "Read the contents of a file at the given path."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "The file path to read"}
            },
            "required": ["path"],
        }

    async def execute(self, path: str, **kwargs: Any) -> str:
        file_path, err = _resolve_and_check(path, self._workspace)
        if err:
            return err
        assert file_path is not None
        try:
            if not file_path.exists():
                return f"Error: File not found: {path}"
            if not file_path.is_file():
                return f"Error: Not a file: {path}"

            content = file_path.read_text(encoding="utf-8")
            return content
        except PermissionError:
            return f"Error: Permission denied: {path}"
        except Exception as e:
            return f"Error reading file: {str(e)}"


class WriteFileTool(Tool):
    """Tool to write content to a file."""

    def __init__(self, workspace: Path | None = None):
        self._workspace = workspace

    @property
    def name(self) -> str:
        return "write_file"

    @property
    def description(self) -> str:
        return "Write content to a file at the given path. Creates parent directories if needed."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "The file path to write to"},
                "content": {"type": "string", "description": "The content to write"},
            },
            "required": ["path", "content"],
        }

    async def execute(self, path: str, content: str, **kwargs: Any) -> str:
        file_path, err = _resolve_and_check(path, self._workspace)
        if err:
            return err
        assert file_path is not None
        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")
            return f"Successfully wrote {len(content)} bytes to {path}"
        except PermissionError:
            return f"Error: Permission denied: {path}"
        except Exception as e:
            return f"Error writing file: {str(e)}"


class EditFileTool(Tool):
    """Tool to edit a file by replacing text."""

    def __init__(self, workspace: Path | None = None):
        self._workspace = workspace

    @property
    def name(self) -> str:
        return "edit_file"

    @property
    def description(self) -> str:
        return "Edit a file by replacing old_text with new_text. The old_text must exist exactly in the file."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "The file path to edit"},
                "old_text": {
                    "type": "string",
                    "description": "The exact text to find and replace",
                },
                "new_text": {
                    "type": "string",
                    "description": "The text to replace with",
                },
            },
            "required": ["path", "old_text", "new_text"],
        }

    async def execute(
        self, path: str, old_text: str, new_text: str, **kwargs: Any
    ) -> str:
        file_path, err = _resolve_and_check(path, self._workspace)
        if err:
            return err
        assert file_path is not None
        try:
            if not file_path.exists():
                return f"Error: File not found: {path}"

            content = file_path.read_text(encoding="utf-8")

            if old_text not in content:
                return (
                    "Error: old_text not found in file. Make sure it matches exactly."
                )

            # Count occurrences
            count = content.count(old_text)
            if count > 1:
                return f"Warning: old_text appears {count} times. Please provide more context to make it unique."

            new_content = content.replace(old_text, new_text, 1)
            file_path.write_text(new_content, encoding="utf-8")

            return f"Successfully edited {path}"
        except PermissionError:
            return f"Error: Permission denied: {path}"
        except Exception as e:
            return f"Error editing file: {str(e)}"


class ListDirTool(Tool):
    """Tool to list directory contents."""

    def __init__(self, workspace: Path | None = None):
        self._workspace = workspace

    @property
    def name(self) -> str:
        return "list_dir"

    @property
    def description(self) -> str:
        return "List the contents of a directory."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "The directory path to list"}
            },
            "required": ["path"],
        }

    async def execute(self, path: str, **kwargs: Any) -> str:
        file_path, err = _resolve_and_check(path, self._workspace)
        if err:
            return err
        assert file_path is not None
        try:
            if not file_path.exists():
                return f"Error: Directory not found: {path}"
            if not file_path.is_dir():
                return f"Error: Not a directory: {path}"

            items = []
            for item in sorted(file_path.iterdir()):
                prefix = "d " if item.is_dir() else "f "
                items.append(f"{prefix}{item.name}")

            if not items:
                return f"Directory {path} is empty"

            return "\n".join(items)
        except PermissionError:
            return f"Error: Permission denied: {path}"
        except Exception as e:
            return f"Error listing directory: {str(e)}"
