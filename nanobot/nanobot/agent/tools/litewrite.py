"""Litewrite integration tools for managing LaTeX projects."""

import base64
from pathlib import Path
from typing import Any

import httpx
from loguru import logger

from nanobot.agent.tools.base import Tool


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


class LitewriteCompileTool(Tool):
    """Tool to compile a Litewrite project and get the PDF."""

    def __init__(self, client: LitewriteClient):
        self._client = client

    @property
    def name(self) -> str:
        return "litewrite_compile"

    @property
    def description(self) -> str:
        return (
            "Compile a Litewrite LaTeX project to PDF. "
            "Supported compilers: pdflatex (default), xelatex, lualatex. "
            "Use xelatex when the document contains Chinese/Japanese/Korean text or uses fontspec/xeCJK packages. "
            "Returns the local file path of the compiled PDF. "
            "Use the message tool with the media parameter to send the PDF to the user."
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
            },
            "required": ["project_id"],
        }

    async def execute(
        self, project_id: str, compiler: str = "pdflatex", **kwargs: Any
    ) -> str:
        logger.info(f"Compiling Litewrite project: {project_id} (compiler={compiler})")

        data: dict[str, Any] = {"projectId": project_id}
        if compiler and compiler != "pdflatex":
            data["compiler"] = compiler

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

        return (
            f"Compilation successful. PDF saved to: {pdf_path}\n"
            f'Use the message tool with media=["{pdf_path}"] to send it to the user.'
        )
