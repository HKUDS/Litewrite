"""Litewrite integration tools for managing LaTeX projects."""

import base64
import mimetypes
from pathlib import Path
from typing import Any, Callable, Awaitable

import httpx
from loguru import logger

from nanobot.agent.tools.base import Tool
from nanobot.bus.events import OutboundMessage


# ---------------------------------------------------------------------------
# Litewrite Agent session ID cache (shared across tool instances)
# Maps project_id -> session_id for reusing the same session per project
# ---------------------------------------------------------------------------
_agent_session_cache: dict[str, str] = {}


class LitewriteClient:
    """HTTP client for Litewrite Internal API."""

    def __init__(self, base_url: str, api_secret: str):
        self.base_url = base_url.rstrip("/")
        self.api_secret = api_secret

    async def request(self, endpoint: str, data: dict[str, Any]) -> dict[str, Any]:
        """Send a POST request to a Litewrite internal API endpoint."""
        url = f"{self.base_url}{endpoint}"
        headers = {"X-Internal-Secret": self.api_secret}

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json=data, headers=headers)
            return resp.json()

    async def validate_project(
        self, project_id: str, owner_id: str = ""
    ) -> tuple[bool, str]:
        """Check whether *project_id* exists.

        Returns ``(True, "")`` on success, or ``(False, error_message)``
        with a helpful listing of available projects when the ID is invalid.
        """
        try:
            data: dict[str, Any] = {}
            if owner_id:
                data["ownerId"] = owner_id
            result = await self.request("/api/internal/projects/list", data)
            projects = result.get("data", {}).get("projects", [])
            ids = {p["id"] for p in projects}
            if project_id in ids:
                return True, ""
            available = ", ".join(
                f"{p['name']} [{p['id']}]" for p in projects
            )
            return False, (
                f"Project '{project_id}' not found. "
                f"Available projects: {available or '(none)'}"
            )
        except Exception as e:
            # If validation itself fails, let the call proceed
            logger.warning(f"Project validation failed: {e}")
            return True, ""


class LitewriteCreateProjectTool(Tool):
    """Tool to create a new Litewrite project."""

    def __init__(self, client: LitewriteClient, default_owner_id: str = ""):
        self._client = client
        self._default_owner_id = default_owner_id

    @property
    def name(self) -> str:
        return "litewrite_create_project"

    @property
    def description(self) -> str:
        return (
            "Create a new LaTeX project in Litewrite. "
            "Returns the project ID which can be used with other litewrite_* tools. "
            "Optionally provide the initial main.tex content."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The project name",
                },
                "description": {
                    "type": "string",
                    "description": "Optional project description",
                },
                "main_file_content": {
                    "type": "string",
                    "description": (
                        "Optional: the complete LaTeX content for main.tex. "
                        "If omitted, a default template will be used."
                    ),
                },
            },
            "required": ["name"],
        }

    async def execute(
        self,
        name: str,
        description: str = "",
        main_file_content: str = "",
        **kwargs: Any,
    ) -> str:
        # Security: require default_owner_id to prevent unauthorized project creation
        if not self._default_owner_id:
            return (
                "Error: No default owner ID configured. "
                "Cannot create project without user scope. "
                "Please configure NANOBOT_DEFAULT_LITEWRITE_USER_ID."
            )

        data: dict[str, Any] = {
            "name": name,
            "ownerId": self._default_owner_id,
        }

        if description:
            data["description"] = description
        if main_file_content:
            data["mainFileContent"] = main_file_content

        result = await self._client.request("/api/internal/projects/create", data)

        if not result.get("success"):
            return f"Error creating project: {result.get('error', 'Unknown error')}"

        project = result.get("data", {})
        return (
            f"Project created successfully!\n"
            f"- ID: {project.get('id')}\n"
            f"- Name: {project.get('name')}\n"
            f"- Main file: {project.get('mainFile', 'main.tex')}\n\n"
            f"You can now use litewrite_edit_file to update the content and litewrite_compile to build the PDF."
        )


class LitewriteListProjectsTool(Tool):
    """Tool to list/search Litewrite projects."""

    def __init__(self, client: LitewriteClient, default_owner_id: str = ""):
        self._client = client
        self._default_owner_id = default_owner_id

    @property
    def name(self) -> str:
        return "litewrite_list_projects"

    @property
    def description(self) -> str:
        return (
            "List LaTeX projects in Litewrite. "
            "Use the search parameter to find projects by name (partial match)."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "search": {
                    "type": "string",
                    "description": "Search keyword to filter projects by name",
                },
            },
        }

    async def execute(self, search: str = "", **kwargs: Any) -> str:
        # Security: require default_owner_id to prevent cross-tenant enumeration
        if not self._default_owner_id:
            return (
                "Error: No default owner ID configured. "
                "Cannot list projects without user scope. "
                "Please configure NANOBOT_DEFAULT_LITEWRITE_USER_ID."
            )

        data: dict[str, Any] = {"ownerId": self._default_owner_id}
        if search:
            data["search"] = search

        result = await self._client.request("/api/internal/projects/list", data)

        if not result.get("success"):
            return f"Error listing projects: {result.get('error', 'Unknown error')}"

        projects = result.get("data", {}).get("projects", [])
        if not projects:
            return "No projects found."

        lines = [f"Found {len(projects)} project(s):"]
        for p in projects:
            lines.append(
                f"- [{p['id']}] {p['name']}"
                + (f" ({p.get('description', '')})" if p.get("description") else "")
                + f" (main: {p.get('mainFile', 'main.tex')})"
            )
        return "\n".join(lines)


class LitewriteListFilesTool(Tool):
    """Tool to list files in a Litewrite project."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_list_files"

    @property
    def description(self) -> str:
        return "List all files in a Litewrite project."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
            },
            "required": ["project_id"],
        }

    async def execute(self, project_id: str, **kwargs: Any) -> str:
        result = await self._client.request(
            "/api/internal/files/list",
            {"projectId": project_id},
        )

        if not result.get("success"):
            return f"Error listing files: {result.get('error', 'Unknown error')}"

        files = result.get("data", {}).get("files", [])
        if not files:
            return "No files found in this project."

        lines = [f"Files in project ({len(files)}):"]
        for f in files:
            size_str = f" ({f['size']} bytes)" if f.get("size") else ""
            lines.append(f"- [{f['type']}] {f['path']}{size_str}")
        return "\n".join(lines)


class LitewriteReadFileTool(Tool):
    """Tool to read a file from a Litewrite project."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_read_file"

    @property
    def description(self) -> str:
        return "Read the content of a file in a Litewrite project."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
                "file_path": {
                    "type": "string",
                    "description": "The file path within the project (e.g. 'main.tex')",
                },
            },
            "required": ["project_id", "file_path"],
        }

    async def execute(self, project_id: str, file_path: str, **kwargs: Any) -> str:
        result = await self._client.request(
            "/api/internal/files/read",
            {"projectId": project_id, "filePath": file_path},
        )

        if not result.get("success"):
            return f"Error reading file: {result.get('error', 'Unknown error')}"

        content = result.get("data", {}).get("content", "")
        total_lines = result.get("data", {}).get("totalLines", 0)
        return f"File: {file_path} ({total_lines} lines)\n\n{content}"


class LitewriteEditFileTool(Tool):
    """Tool to edit (replace) a file in a Litewrite project."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_edit_file"

    @property
    def description(self) -> str:
        return (
            "Replace the entire content of a file in a Litewrite project. "
            "You must provide the complete new file content."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
                "file_path": {
                    "type": "string",
                    "description": "The file path within the project (e.g. 'main.tex')",
                },
                "content": {
                    "type": "string",
                    "description": "The complete new file content",
                },
            },
            "required": ["project_id", "file_path", "content"],
        }

    async def execute(
        self, project_id: str, file_path: str, content: str, **kwargs: Any
    ) -> str:
        result = await self._client.request(
            "/api/internal/files/edit",
            {"projectId": project_id, "filePath": file_path, "content": content},
        )

        if not result.get("success"):
            return f"Error editing file: {result.get('error', 'Unknown error')}"

        length = result.get("data", {}).get("length", len(content))
        return f"Successfully updated {file_path} ({length} chars)"


class LitewriteAgentTool(Tool):
    """Tool to invoke litewrite's built-in AI agent for writing/editing tasks.

    Maintains a per-project session cache so that consecutive calls to the
    same project reuse the same conversation session.  This allows the
    litewrite agent to see prior conversation context and ensures the
    session appears in the web UI's Conversation History as "nanobot".
    """

    def __init__(self, client: LitewriteClient, default_owner_id: str = ""):
        self._client = client
        self._default_owner_id = default_owner_id

    @property
    def name(self) -> str:
        return "litewrite_agent"

    @property
    def description(self) -> str:
        return (
            "Invoke Litewrite's built-in AI agent to handle complex writing and editing tasks. "
            "The agent understands LaTeX structure and can read files, plan multi-step edits, "
            "and apply precise line-based changes. Use this for writing new content, "
            "rewriting/restructuring sections, complex multi-file edits, or analyzing documents. "
            "Edits are applied directly to the project files."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
                "message": {
                    "type": "string",
                    "description": (
                        "The instruction for the agent. Be specific about what to write, "
                        "edit, or analyze. Examples: 'Add an abstract section to main.tex', "
                        "'Rewrite the introduction to be more concise', "
                        "'Fix all citation formatting issues'"
                    ),
                },
                "mode": {
                    "type": "string",
                    "enum": ["agent", "ask"],
                    "description": (
                        "Agent mode: 'agent' (default) for editing/writing tasks, "
                        "'ask' for read-only analysis and Q&A about the project"
                    ),
                },
                "referenced_files": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Optional list of file paths to reference. The agent will "
                        "prioritize reading these files. E.g. ['main.tex', 'sections/intro.tex']"
                    ),
                },
            },
            "required": ["project_id", "message"],
        }

    async def execute(
        self,
        project_id: str,
        message: str,
        mode: str = "agent",
        referenced_files: list[str] | None = None,
        **kwargs: Any,
    ) -> str:
        # Validate project ID before calling the agent (catches hallucinated IDs)
        valid, err = await self._client.validate_project(
            project_id, self._default_owner_id
        )
        if not valid:
            logger.warning(f"litewrite_agent: {err}")
            return f"Error: {err}"

        # Look up cached session ID for this project
        cached_session_id = _agent_session_cache.get(project_id)

        logger.info(
            f"Invoking Litewrite agent: project={project_id}, mode={mode}, "
            f"message_len={len(message)}, session={cached_session_id or '(new)'}"
        )

        data: dict[str, Any] = {
            "projectId": project_id,
            "message": message,
            "mode": mode,
        }

        if self._default_owner_id:
            data["userId"] = self._default_owner_id

        if referenced_files:
            data["referencedFiles"] = referenced_files

        # Pass session ID if we have one cached
        if cached_session_id:
            data["sessionId"] = cached_session_id

        try:
            # Use longer timeout for agent execution (5 minutes)
            url = f"{self._client.base_url}/api/internal/agent/run"
            headers = {"X-Internal-Secret": self._client.api_secret}

            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.post(url, json=data, headers=headers)
                result = resp.json()
        except httpx.TimeoutException:
            logger.error(f"Litewrite agent timed out for project {project_id}")
            return (
                "Error: Litewrite agent execution timed out after 5 minutes. "
                "The task may be too complex. Try breaking it into smaller steps."
            )
        except Exception as e:
            logger.error(f"Litewrite agent error: {e}")
            return f"Error invoking Litewrite agent: {str(e)}"

        # Cache the session ID returned by the server (created or reused)
        returned_session_id = result.get("sessionId")
        if returned_session_id:
            _agent_session_cache[project_id] = returned_session_id
            if not cached_session_id:
                logger.info(
                    f"Cached new session for project {project_id}: {returned_session_id}"
                )

        if not result.get("success"):
            error = result.get("error", "Unknown error")
            logger.warning(f"Litewrite agent failed: {error}")
            return f"Litewrite agent error: {error}"

        response = result.get("response", "")
        logger.info(
            f"Litewrite agent completed: response_len={len(response)}"
        )

        return f"Litewrite agent completed:\n\n{response}"


class LitewriteCompileTool(Tool):
    """Tool to compile a Litewrite project and get the PDF."""

    def __init__(self, client: LitewriteClient, default_owner_id: str = ""):
        self._client = client
        self._default_owner_id = default_owner_id
        self._send_callback: Callable[[OutboundMessage], Awaitable[None]] | None = None
        self._channel: str = ""
        self._chat_id: str = ""

    def set_context(
        self,
        channel: str,
        chat_id: str,
        send_callback: Callable[[OutboundMessage], Awaitable[None]] | None = None,
    ) -> None:
        """Set the current message context for auto-sending PDFs."""
        self._channel = channel
        self._chat_id = chat_id
        if send_callback is not None:
            self._send_callback = send_callback

    @property
    def name(self) -> str:
        return "litewrite_compile"

    @property
    def description(self) -> str:
        return (
            "Compile a Litewrite LaTeX project to PDF. "
            "Supported compilers: pdflatex (default), xelatex, lualatex. "
            "Use xelatex when the document contains Chinese/Japanese/Korean text or uses fontspec/xeCJK packages. "
            "By default, the project is automatically saved as a version after successful compilation. "
            "The compiled PDF is automatically sent to the user — you do NOT need to call the message tool afterwards."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID to compile",
                },
                "compiler": {
                    "type": "string",
                    "enum": ["pdflatex", "xelatex", "lualatex"],
                    "description": (
                        "LaTeX compiler to use. Use 'xelatex' for documents with "
                        "Chinese/Japanese/Korean text or custom fonts. Default: pdflatex"
                    ),
                },
                "auto_save": {
                    "type": "boolean",
                    "description": (
                        "Whether to auto-save the project as a version after successful compilation. "
                        "Default: true"
                    ),
                },
            },
            "required": ["project_id"],
        }

    async def execute(
        self, project_id: str, compiler: str = "pdflatex", auto_save: bool = True, **kwargs: Any
    ) -> str:
        # Validate project ID before compiling
        valid, err = await self._client.validate_project(
            project_id, self._default_owner_id
        )
        if not valid:
            logger.warning(f"litewrite_compile: {err}")
            return f"Error: {err}"

        logger.info(f"Compiling Litewrite project: {project_id} (compiler={compiler}, auto_save={auto_save})")

        data: dict[str, Any] = {"projectId": project_id, "autoSave": auto_save}
        if compiler and compiler != "pdflatex":
            data["compiler"] = compiler
        if self._default_owner_id:
            data["userId"] = self._default_owner_id

        result = await self._client.request(
            "/api/internal/projects/compile",
            data,
        )

        if not result.get("success"):
            error = result.get("error", "Unknown error")
            logs = result.get("logs", "")
            return (
                f"Compilation failed: {error}\n{logs}"
                if logs
                else f"Compilation failed: {error}"
            )

        pdf_base64 = result.get("data", {}).get("pdfBase64", "")
        pdf_filename = result.get("data", {}).get("pdfFileName", "output.pdf")

        if not pdf_base64:
            return "Compilation succeeded but no PDF was produced."

        # Decode and save PDF to local file
        media_dir = Path.home() / ".nanobot" / "media"
        media_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = media_dir / f"{project_id}_{pdf_filename}"

        pdf_bytes = base64.b64decode(pdf_base64)
        pdf_path.write_bytes(pdf_bytes)

        logger.info(f"PDF saved to {pdf_path} ({len(pdf_bytes)} bytes)")

        # Auto-send the PDF to the user
        pdf_sent = False
        if self._send_callback and self._channel and self._chat_id:
            try:
                await self._send_callback(
                    OutboundMessage(
                        channel=self._channel,
                        chat_id=self._chat_id,
                        content="",
                        media=[str(pdf_path)],
                    )
                )
                pdf_sent = True
                logger.info(f"PDF auto-sent to {self._channel}:{self._chat_id}")
            except Exception as e:
                logger.error(f"Failed to auto-send PDF: {e}")

        # Build response with version info
        lines = ["Compilation successful."]
        if pdf_sent:
            lines.append("The compiled PDF has been sent to the user.")
        else:
            lines.append(f"PDF saved to: {pdf_path}")
            lines.append(
                f'Use the message tool with media=["{pdf_path}"] to send it to the user.'
            )

        version_saved = result.get("data", {}).get("versionSaved")
        if version_saved:
            lines.append(f"Version auto-saved: \"{version_saved.get('name', '')}\"")

        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Project Management Tools
# ---------------------------------------------------------------------------


class LitewriteCreateProjectTool(Tool):
    """Tool to create a new Litewrite project."""

    def __init__(self, client: LitewriteClient, default_owner_id: str = ""):
        self._client = client
        self._default_owner_id = default_owner_id

    @property
    def name(self) -> str:
        return "litewrite_create_project"

    @property
    def description(self) -> str:
        return (
            "Create a new LaTeX project in Litewrite. "
            "A default main.tex file will be created automatically. "
            "Use locale='zh' for Chinese documents (uses ctex template with xelatex)."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The project name",
                },
                "description": {
                    "type": "string",
                    "description": "Optional project description",
                },
                "locale": {
                    "type": "string",
                    "enum": ["en", "zh"],
                    "description": (
                        "Template locale: 'en' (default, English template) or "
                        "'zh' (Chinese template with ctex)"
                    ),
                },
            },
            "required": ["name"],
        }

    async def execute(
        self,
        name: str,
        description: str = "",
        locale: str = "en",
        **kwargs: Any,
    ) -> str:
        data: dict[str, Any] = {"name": name, "locale": locale}

        if description:
            data["description"] = description

        if self._default_owner_id:
            data["ownerId"] = self._default_owner_id
        else:
            return "Error: Owner ID is not configured. Cannot create project."

        result = await self._client.request("/api/internal/projects/create", data)

        if not result.get("success"):
            return f"Error creating project: {result.get('error', 'Unknown error')}"

        project = result.get("data", {}).get("project", {})
        return (
            f"Project created successfully:\n"
            f"- ID: {project.get('id')}\n"
            f"- Name: {project.get('name')}\n"
            f"- Created: {project.get('createdAt')}"
        )


class LitewriteDeleteProjectTool(Tool):
    """Tool to delete a Litewrite project."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_delete_project"

    @property
    def description(self) -> str:
        return (
            "Permanently delete a Litewrite project. "
            "This removes the project, all its files, compiled artifacts, and version history. "
            "This action is IRREVERSIBLE. Always confirm with the user before deleting."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID to delete",
                },
            },
            "required": ["project_id"],
        }

    async def execute(self, project_id: str, **kwargs: Any) -> str:
        result = await self._client.request(
            "/api/internal/projects/delete",
            {"projectId": project_id},
        )

        if not result.get("success"):
            return f"Error deleting project: {result.get('error', 'Unknown error')}"

        name = result.get("data", {}).get("name", "")
        return f"Project '{name}' ({project_id}) has been permanently deleted."


class LitewriteRenameProjectTool(Tool):
    """Tool to rename or update a Litewrite project's metadata."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_rename_project"

    @property
    def description(self) -> str:
        return (
            "Rename a Litewrite project or update its description. "
            "Provide at least one of 'name' or 'description'."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
                "name": {
                    "type": "string",
                    "description": "New project name",
                },
                "description": {
                    "type": "string",
                    "description": "New project description",
                },
            },
            "required": ["project_id"],
        }

    async def execute(
        self,
        project_id: str,
        name: str = "",
        description: str | None = None,
        **kwargs: Any,
    ) -> str:
        data: dict[str, Any] = {"projectId": project_id}

        if name:
            data["name"] = name
        if description is not None:
            data["description"] = description

        if len(data) <= 1:
            return "Error: Provide at least 'name' or 'description' to update."

        result = await self._client.request("/api/internal/projects/rename", data)

        if not result.get("success"):
            return f"Error updating project: {result.get('error', 'Unknown error')}"

        project = result.get("data", {}).get("project", {})
        return (
            f"Project updated successfully:\n"
            f"- ID: {project.get('id')}\n"
            f"- Name: {project.get('name')}\n"
            f"- Description: {project.get('description', 'N/A')}"
        )


# ---------------------------------------------------------------------------
# Version Management Tools
# ---------------------------------------------------------------------------


class LitewriteListVersionsTool(Tool):
    """Tool to list all versions/history of a Litewrite project."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_list_versions"

    @property
    def description(self) -> str:
        return (
            "List all saved versions (history) of a Litewrite project. "
            "Returns version IDs, names, creation dates, and file counts. "
            "Use this to find a version ID for restoring."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
            },
            "required": ["project_id"],
        }

    async def execute(self, project_id: str, **kwargs: Any) -> str:
        result = await self._client.request(
            "/api/internal/projects/versions/list",
            {"projectId": project_id},
        )

        if not result.get("success"):
            return f"Error listing versions: {result.get('error', 'Unknown error')}"

        data = result.get("data", {})
        project_name = data.get("projectName", "")
        versions = data.get("versions", [])

        if not versions:
            return f"No saved versions found for project '{project_name}'."

        lines = [f"Versions for project '{project_name}' ({len(versions)} total):"]
        for v in versions:
            user_name = v.get("user", {}).get("name", "Unknown") if v.get("user") else "Unknown"
            lines.append(
                f"- [{v['id']}] \"{v['name']}\" "
                f"(by {user_name}, {v.get('fileCount', '?')} files, "
                f"{v['createdAt']})"
            )
            if v.get("description"):
                lines.append(f"  Description: {v['description']}")
        return "\n".join(lines)


class LitewriteSaveVersionTool(Tool):
    """Tool to manually save the current project state as a version."""

    def __init__(self, client: LitewriteClient, default_owner_id: str = ""):
        self._client = client
        self._default_owner_id = default_owner_id

    @property
    def name(self) -> str:
        return "litewrite_save_version"

    @property
    def description(self) -> str:
        return (
            "Save the current state of a Litewrite project as a named version. "
            "This creates a snapshot that can be restored later. "
            "Note: compilation already auto-saves a version by default, "
            "so use this only when you want to save without compiling."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
                "name": {
                    "type": "string",
                    "description": "Version name (e.g. 'Before major rewrite'). Auto-generated if not provided.",
                },
                "description": {
                    "type": "string",
                    "description": "Optional version description",
                },
            },
            "required": ["project_id"],
        }

    async def execute(
        self,
        project_id: str,
        name: str = "",
        description: str = "",
        **kwargs: Any,
    ) -> str:
        data: dict[str, Any] = {"projectId": project_id}

        if name:
            data["name"] = name
        if description:
            data["description"] = description
        if self._default_owner_id:
            data["userId"] = self._default_owner_id

        result = await self._client.request(
            "/api/internal/projects/versions/create",
            data,
        )

        if not result.get("success"):
            if result.get("skipped"):
                return "No changes detected since the last saved version. Nothing to save."
            return f"Error saving version: {result.get('error', 'Unknown error')}"

        version = result.get("data", {}).get("version", {})
        return (
            f"Version saved successfully:\n"
            f"- ID: {version.get('id')}\n"
            f"- Name: \"{version.get('name')}\"\n"
            f"- Files: {version.get('fileCount', '?')}\n"
            f"- Created: {version.get('createdAt')}"
        )


class LitewriteRestoreVersionTool(Tool):
    """Tool to restore a Litewrite project to a specific version."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_restore_version"

    @property
    def description(self) -> str:
        return (
            "Restore a Litewrite project to a specific saved version. "
            "This replaces ALL current project files with the version's files. "
            "The current state will be lost unless it was saved as a version. "
            "Always confirm with the user and suggest saving a version first."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
                "version_id": {
                    "type": "string",
                    "description": "The version ID to restore to (get from litewrite_list_versions)",
                },
            },
            "required": ["project_id", "version_id"],
        }

    async def execute(
        self, project_id: str, version_id: str, **kwargs: Any
    ) -> str:
        result = await self._client.request(
            "/api/internal/projects/versions/restore",
            {"projectId": project_id, "versionId": version_id},
        )

        if not result.get("success"):
            return f"Error restoring version: {result.get('error', 'Unknown error')}"

        data = result.get("data", {})
        return (
            f"Project restored to version \"{data.get('versionName', '')}\" successfully.\n"
            f"- Restored files: {data.get('restoredFileCount', 0)}\n"
            f"- Yjs cache cleared: {data.get('clearedYjsKeys', 0)} keys"
        )


# ---------------------------------------------------------------------------
# File Management Tools
# ---------------------------------------------------------------------------


class LitewriteCreateFileTool(Tool):
    """Tool to create a new file or folder in a Litewrite project."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_create_file"

    @property
    def description(self) -> str:
        return (
            "Create a new file or folder in a Litewrite project. "
            "For files, you can optionally provide initial content. "
            "For folders, a placeholder is created to make the folder visible."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
                "name": {
                    "type": "string",
                    "description": "File or folder name (e.g. 'chapter1.tex', 'images')",
                },
                "type": {
                    "type": "string",
                    "enum": ["file", "folder"],
                    "description": "Type to create: 'file' (default) or 'folder'",
                },
                "parent_path": {
                    "type": "string",
                    "description": "Parent directory path (e.g. 'sections'). Empty for project root.",
                },
                "content": {
                    "type": "string",
                    "description": "Initial file content (only for type='file')",
                },
            },
            "required": ["project_id", "name"],
        }

    async def execute(
        self,
        project_id: str,
        name: str,
        type: str = "file",
        parent_path: str = "",
        content: str = "",
        **kwargs: Any,
    ) -> str:
        data: dict[str, Any] = {
            "projectId": project_id,
            "name": name,
            "type": type,
        }

        if parent_path:
            data["parentPath"] = parent_path
        if content and type == "file":
            data["content"] = content

        result = await self._client.request("/api/internal/files/create", data)

        if not result.get("success"):
            error = result.get("error", "Unknown error")
            if error == "FILE_EXISTS":
                return f"Error: A file named '{name}' already exists at the specified location."
            if error == "FOLDER_EXISTS":
                return f"Error: A folder named '{name}' already exists at the specified location."
            return f"Error creating {type}: {error}"

        path = result.get("data", {}).get("path", name)
        return f"Successfully created {type} '{path}' in project."


class LitewriteRenameFileTool(Tool):
    """Tool to rename or move a file/folder in a Litewrite project."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_rename_file"

    @property
    def description(self) -> str:
        return (
            "Rename or move a file/folder in a Litewrite project. "
            "To rename: provide source_path and new_name. "
            "To move: provide source_path and target_path (destination folder). "
            "To move and rename: provide all three."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
                "source_path": {
                    "type": "string",
                    "description": "Current file path (e.g. 'main.tex', 'sections/intro.tex')",
                },
                "new_name": {
                    "type": "string",
                    "description": "New file name (e.g. 'introduction.tex')",
                },
                "target_path": {
                    "type": "string",
                    "description": "Destination folder path for moving (e.g. 'sections')",
                },
            },
            "required": ["project_id", "source_path"],
        }

    async def execute(
        self,
        project_id: str,
        source_path: str,
        new_name: str = "",
        target_path: str = "",
        **kwargs: Any,
    ) -> str:
        data: dict[str, Any] = {
            "projectId": project_id,
            "sourcePath": source_path,
        }

        if new_name:
            data["newName"] = new_name
        if target_path:
            data["targetPath"] = target_path

        if not new_name and not target_path:
            return "Error: Provide at least 'new_name' or 'target_path'."

        result = await self._client.request("/api/internal/files/rename", data)

        if not result.get("success"):
            return f"Error renaming file: {result.get('error', 'Unknown error')}"

        res_data = result.get("data", {})
        return (
            f"File renamed/moved successfully:\n"
            f"- From: {res_data.get('oldPath', source_path)}\n"
            f"- To: {res_data.get('newPath', '')}"
        )


class LitewriteDeleteFileTool(Tool):
    """Tool to delete a file or folder in a Litewrite project."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_delete_file"

    @property
    def description(self) -> str:
        return (
            "Delete a file or folder from a Litewrite project. "
            "If the path points to a folder, all files within it are deleted recursively. "
            "This action is IRREVERSIBLE. Always confirm with the user before deleting."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
                "file_path": {
                    "type": "string",
                    "description": "Path of the file or folder to delete (e.g. 'old_chapter.tex', 'drafts')",
                },
            },
            "required": ["project_id", "file_path"],
        }

    async def execute(
        self, project_id: str, file_path: str, **kwargs: Any
    ) -> str:
        result = await self._client.request(
            "/api/internal/files/delete",
            {"projectId": project_id, "filePath": file_path},
        )

        if not result.get("success"):
            return f"Error deleting file: {result.get('error', 'Unknown error')}"

        deleted_count = result.get("data", {}).get("deletedCount", 0)
        return f"Successfully deleted '{file_path}' ({deleted_count} file(s) removed)."


class LitewriteUploadFileTool(Tool):
    """Tool to upload a local file (image, PDF, etc.) to a Litewrite project."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_upload_file"

    @property
    def description(self) -> str:
        return (
            "Upload a local file to a Litewrite project. "
            "Supports images (png, jpg, gif, etc.), PDFs, and any other file type. "
            "The file is read from the local path and uploaded to the specified project path. "
            "Use this to add images, figures, or other assets to a project. "
            "If a file already exists at the target path, it will be overwritten by default."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "The project ID",
                },
                "local_path": {
                    "type": "string",
                    "description": (
                        "Local file path to upload (e.g. from an attached file). "
                        "Use the path provided in the '[Attached files]' section of the user message."
                    ),
                },
                "target_path": {
                    "type": "string",
                    "description": (
                        "Destination path in the project (e.g. 'figures/diagram.png', 'images/photo.jpg'). "
                        "Include the file name."
                    ),
                },
                "overwrite": {
                    "type": "boolean",
                    "description": "Whether to overwrite if the file already exists. Default: true",
                },
            },
            "required": ["project_id", "local_path", "target_path"],
        }

    async def execute(
        self,
        project_id: str,
        local_path: str,
        target_path: str,
        overwrite: bool = True,
        **kwargs: Any,
    ) -> str:
        # Validate local file exists
        p = Path(local_path)
        if not p.is_file():
            return f"Error: Local file not found: {local_path}"

        # Read file and encode as base64
        try:
            file_bytes = p.read_bytes()
        except Exception as e:
            return f"Error reading local file: {e}"

        mime, _ = mimetypes.guess_type(local_path)
        is_text = mime and mime.startswith("text/")

        data: dict[str, Any] = {
            "projectId": project_id,
            "filePath": target_path,
            "overwrite": overwrite,
        }

        if is_text:
            # Text file: send as plain string
            data["content"] = file_bytes.decode("utf-8", errors="replace")
        else:
            # Binary file: send as base64
            data["contentBase64"] = base64.b64encode(file_bytes).decode()

        logger.info(
            f"Uploading {local_path} ({len(file_bytes)} bytes) "
            f"-> project {project_id}/{target_path}"
        )

        result = await self._client.request("/api/internal/files/upload", data)

        if not result.get("success"):
            return f"Error uploading file: {result.get('error', 'Unknown error')}"

        res_data = result.get("data", {})
        return (
            f"File uploaded successfully:\n"
            f"- Project path: {res_data.get('path', target_path)}\n"
            f"- Size: {res_data.get('size', len(file_bytes))} bytes\n"
            f"- Type: {res_data.get('mimeType', mime or 'unknown')}"
        )


# ---------------------------------------------------------------------------
# Import Tools
# ---------------------------------------------------------------------------


class LitewriteImportArxivTool(Tool):
    """Tool to import a project from arXiv."""

    def __init__(self, client: LitewriteClient, default_owner_id: str = ""):
        self._client = client
        self._default_owner_id = default_owner_id

    @property
    def name(self) -> str:
        return "litewrite_import_arxiv"

    @property
    def description(self) -> str:
        return (
            "Import a LaTeX project from arXiv. Provide an arXiv ID or URL. "
            "The paper's source files will be downloaded and created as a new project. "
            "Supported formats: arXiv ID (e.g. '2301.07041'), "
            "arXiv URL (e.g. 'https://arxiv.org/abs/2301.07041'), "
            "or PDF URL (e.g. 'https://arxiv.org/pdf/2301.07041.pdf')."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "arxiv_id": {
                    "type": "string",
                    "description": (
                        "arXiv paper ID or URL. Examples: '2301.07041', "
                        "'https://arxiv.org/abs/2301.07041'"
                    ),
                },
                "name": {
                    "type": "string",
                    "description": "Optional project name. Defaults to the paper title or arXiv ID.",
                },
                "description": {
                    "type": "string",
                    "description": "Optional project description.",
                },
            },
            "required": ["arxiv_id"],
        }

    async def execute(
        self,
        arxiv_id: str,
        name: str = "",
        description: str = "",
        **kwargs: Any,
    ) -> str:
        if not self._default_owner_id:
            return "Error: Owner ID is not configured. Cannot import project."

        data: dict[str, Any] = {
            "arxivId": arxiv_id,
            "ownerId": self._default_owner_id,
        }
        if name:
            data["name"] = name
        if description:
            data["description"] = description

        logger.info(f"Importing arXiv paper: {arxiv_id}")

        try:
            result = await self._client.request(
                "/api/internal/projects/import/arxiv", data
            )
        except Exception as e:
            logger.error(f"arXiv import error: {e}")
            return f"Error importing from arXiv: {e}"

        if not result.get("success"):
            return f"Error importing from arXiv: {result.get('error', 'Unknown error')}"

        project_data = result.get("data", {})
        project = project_data.get("project", {})
        return (
            f"arXiv paper imported successfully:\n"
            f"- Project ID: {project.get('id')}\n"
            f"- Name: {project.get('name')}\n"
            f"- arXiv ID: {project_data.get('arxivId', arxiv_id)}\n"
            f"- Paper title: {project_data.get('paperTitle', 'N/A')}\n"
            f"- Files: {project_data.get('filesCount', '?')}\n"
            f"- Main file: {project.get('mainFile', 'main.tex')}"
        )


class LitewriteImportGithubTool(Tool):
    """Tool to import a project from GitHub/GitLab."""

    def __init__(self, client: LitewriteClient, default_owner_id: str = ""):
        self._client = client
        self._default_owner_id = default_owner_id

    @property
    def name(self) -> str:
        return "litewrite_import_github"

    @property
    def description(self) -> str:
        return (
            "Import a LaTeX project from a GitHub or GitLab repository. "
            "Provide the repository URL. Supports importing entire repos "
            "or specific subdirectories via tree URLs. "
            "Examples: 'https://github.com/user/repo', "
            "'https://github.com/user/repo/tree/main/latex-source'."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "GitHub or GitLab repository URL.",
                },
                "name": {
                    "type": "string",
                    "description": "Optional project name. Defaults to the repo name.",
                },
                "description": {
                    "type": "string",
                    "description": "Optional project description.",
                },
            },
            "required": ["url"],
        }

    async def execute(
        self,
        url: str,
        name: str = "",
        description: str = "",
        **kwargs: Any,
    ) -> str:
        if not self._default_owner_id:
            return "Error: Owner ID is not configured. Cannot import project."

        data: dict[str, Any] = {
            "url": url,
            "ownerId": self._default_owner_id,
        }
        if name:
            data["name"] = name
        if description:
            data["description"] = description

        logger.info(f"Importing from GitHub/GitLab: {url}")

        try:
            result = await self._client.request(
                "/api/internal/projects/import/github", data
            )
        except Exception as e:
            logger.error(f"GitHub import error: {e}")
            return f"Error importing from GitHub/GitLab: {e}"

        if not result.get("success"):
            return f"Error importing from GitHub/GitLab: {result.get('error', 'Unknown error')}"

        project_data = result.get("data", {})
        project = project_data.get("project", {})
        return (
            f"Repository imported successfully:\n"
            f"- Project ID: {project.get('id')}\n"
            f"- Name: {project.get('name')}\n"
            f"- Files: {project_data.get('filesCount', '?')}\n"
            f"- Main file: {project.get('mainFile', 'main.tex')}"
        )


class LitewriteImportUploadTool(Tool):
    """Tool to create a project by uploading a local file (zip/tex/etc.)."""

    def __init__(self, client: LitewriteClient, default_owner_id: str = ""):
        self._client = client
        self._default_owner_id = default_owner_id

    @property
    def name(self) -> str:
        return "litewrite_import_upload"

    @property
    def description(self) -> str:
        return (
            "Create a new Litewrite project by uploading a local file. "
            "Supports ZIP archives, tar.gz archives, and individual LaTeX files "
            "(.tex, .bib, .cls, .sty). The file is read from a local path "
            "(e.g. from an attached file the user sent). "
            "A new project will be created with the uploaded content."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "local_path": {
                    "type": "string",
                    "description": (
                        "Local file path to upload. Use the path from the "
                        "'[Attached files]' section of the user message."
                    ),
                },
                "name": {
                    "type": "string",
                    "description": "Optional project name. Defaults to the file name.",
                },
                "description": {
                    "type": "string",
                    "description": "Optional project description.",
                },
            },
            "required": ["local_path"],
        }

    async def execute(
        self,
        local_path: str,
        name: str = "",
        description: str = "",
        **kwargs: Any,
    ) -> str:
        if not self._default_owner_id:
            return "Error: Owner ID is not configured. Cannot import project."

        p = Path(local_path)
        if not p.is_file():
            return f"Error: Local file not found: {local_path}"

        try:
            file_bytes = p.read_bytes()
        except Exception as e:
            return f"Error reading local file: {e}"

        file_b64 = base64.b64encode(file_bytes).decode()

        data: dict[str, Any] = {
            "fileBase64": file_b64,
            "fileName": p.name,
            "ownerId": self._default_owner_id,
        }
        if name:
            data["name"] = name
        if description:
            data["description"] = description

        logger.info(
            f"Uploading {local_path} ({len(file_bytes)} bytes) to create project"
        )

        try:
            result = await self._client.request(
                "/api/internal/projects/import/upload", data
            )
        except Exception as e:
            logger.error(f"Upload import error: {e}")
            return f"Error uploading file to create project: {e}"

        if not result.get("success"):
            return f"Error creating project from upload: {result.get('error', 'Unknown error')}"

        project_data = result.get("data", {})
        project = project_data.get("project", {})
        return (
            f"Project created from uploaded file:\n"
            f"- Project ID: {project.get('id')}\n"
            f"- Name: {project.get('name')}\n"
            f"- Files: {project_data.get('filesCount', '?')}\n"
            f"- Main file: {project.get('mainFile', 'main.tex')}"
        )
