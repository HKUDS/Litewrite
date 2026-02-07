---
name: litewrite
description: "Manage LaTeX projects in Litewrite - create/delete/rename projects, manage files and versions, use the built-in AI agent for writing/editing, compile to PDF, and send results to users."
metadata: {"nanobot":{"always":true}}
---

# Litewrite Skill

You have access to **Litewrite**, a LaTeX writing platform with a built-in AI agent. Use the `litewrite_*` tools to manage LaTeX projects.

## Available Tools

### Writing & Editing
- `litewrite_agent` - **Invoke Litewrite's built-in AI agent** for writing, editing, and analysis tasks. The agent understands LaTeX deeply and can make precise, multi-step edits.

### Project Management
- `litewrite_list_projects` - Search and list projects by name
- `litewrite_create_project` - Create a new project (auto-generates main.tex)
- `litewrite_rename_project` - Rename a project or update its description
- `litewrite_delete_project` - **Permanently** delete a project (IRREVERSIBLE - always confirm with user)

### Version History
- `litewrite_list_versions` - List all saved versions of a project
- `litewrite_save_version` - Save the current project state as a named version
- `litewrite_restore_version` - Restore a project to a specific saved version (DESTRUCTIVE - suggest saving current state first)

### File Management
- `litewrite_list_files` - List all files in a project
- `litewrite_read_file` - Read a file's content
- `litewrite_create_file` - Create a new file or folder in a project
- `litewrite_upload_file` - **Upload a local file** (image, PDF, etc.) to a project. Use for binary files like figures, diagrams, photos.
- `litewrite_rename_file` - Rename or move a file/folder
- `litewrite_delete_file` - Delete a file or folder (IRREVERSIBLE - always confirm with user)
- `litewrite_edit_file` - Replace a file's entire content (prefer `litewrite_agent` for edits)

### Compilation
- `litewrite_compile` - Compile the project to PDF (supports pdflatex, xelatex, lualatex). **Auto-saves a version** after successful compilation by default.

## Tool Selection Strategy

### Use `litewrite_agent` (mode="agent") when:
- Writing new content (sections, paragraphs, abstracts, etc.)
- Rewriting or restructuring existing content
- Complex edits that span multiple locations in a file
- Multi-file changes
- Any task that requires understanding the document structure
- Fixing formatting, citations, or structural issues

### Use `litewrite_agent` (mode="ask") when:
- Analyzing document content (e.g., "What topics does this paper cover?")
- Answering questions about the project without making changes
- Reviewing or summarizing the document

### Use project management tools when:
- `litewrite_create_project`: User wants to start a new paper/document
- `litewrite_rename_project`: User wants to change a project's name
- `litewrite_delete_project`: User wants to remove a project (ALWAYS confirm first)

### Use version tools when:
- `litewrite_list_versions`: User asks about project history or wants to see saved versions
- `litewrite_save_version`: User explicitly asks to save current state, or before a destructive operation like restore
- `litewrite_restore_version`: User wants to revert to an older version (save current state first with `litewrite_save_version`)

### Use file management tools when:
- `litewrite_create_file`: Adding new .tex files, .bib files, or folders to organize the project
- `litewrite_upload_file`: Uploading images, figures, or other binary files from attached files to a project
- `litewrite_rename_file`: Renaming files or moving them between folders
- `litewrite_delete_file`: Removing unnecessary files (ALWAYS confirm first)

### Use direct tools when:
- `litewrite_list_projects`: Finding a project by name (always needed first)
- `litewrite_list_files`: Browsing the file structure
- `litewrite_read_file`: Quickly reading a file without needing the agent
- `litewrite_compile`: Compiling to PDF after edits are done
- `litewrite_edit_file`: Only for simple, complete file replacements

## Typical Workflows

### Workflow 1: Write and compile
1. `litewrite_list_projects(search="...")` -> find project ID
2. `litewrite_agent(project_id, message="...", mode="agent")` -> agent edits
3. `litewrite_compile(project_id)` -> compile PDF
4. `message(content="...", media=[pdf_path])` -> send to user

### Workflow 2: Create a new project
1. `litewrite_create_project(name="My Paper", locale="en")` -> get project ID
2. `litewrite_agent(project_id, message="Write a complete introduction about...", mode="agent")` -> agent writes content
3. `litewrite_compile(project_id)` -> compile PDF
4. `message(content="...", media=[pdf_path])` -> send to user

### Workflow 3: Add files to a project
1. `litewrite_list_projects(search="...")` -> find project ID
2. `litewrite_create_file(project_id, name="refs.bib", content="@article{...}")` -> create bibliography
3. `litewrite_create_file(project_id, name="sections", type="folder")` -> create sections folder
4. `litewrite_create_file(project_id, name="intro.tex", parent_path="sections", content="\\section{...}")` -> create file in folder

### Workflow 4: Upload an image to a project
User sends an image and says: "Put this image in the RAGAnything project as figures/architecture.png"

Steps:
1. `litewrite_list_projects(search="RAGAnything")` -> find project ID
2. `litewrite_upload_file(project_id, local_path="/path/from/attached/files", target_path="figures/architecture.png")` -> upload the image
3. Optionally: `litewrite_agent(project_id, message="Add \\includegraphics for figures/architecture.png in the architecture section")` -> update LaTeX
4. `litewrite_compile(project_id)` -> compile PDF
5. `message(content="...", media=[pdf_path])` -> send to user

### Workflow 5: Restore a previous version
1. `litewrite_list_projects(search="...")` -> find project ID
2. `litewrite_list_versions(project_id)` -> see all saved versions
3. `litewrite_save_version(project_id, name="Before restore")` -> save current state first
4. `litewrite_restore_version(project_id, version_id)` -> restore to chosen version
5. `litewrite_compile(project_id)` -> compile to verify

## CRITICAL Rules

### Using litewrite_agent
- **Be specific** in your instructions. Instead of "improve the paper", say "rewrite the introduction to emphasize the novelty of our approach".
- The agent reads files automatically - you don't need to read them first.
- The agent applies edits directly to the project files. Changes take effect immediately.
- For complex tasks, the agent may take 30-60 seconds to complete.

### Compiler Selection
- **pdflatex** (default): Standard LaTeX compiler. Works for most English-only documents.
- **xelatex**: Required when the document contains Chinese, Japanese, or Korean text. Also needed for `fontspec`, `xeCJK`, or custom Unicode fonts.
- **lualatex**: Alternative Unicode-aware compiler.
- **Rule of thumb**: If the document contains Chinese/CJK content, you MUST use `compiler="xelatex"` when compiling.

### Destructive Operations
- **Always confirm with the user** before using `litewrite_delete_project`, `litewrite_delete_file`, or `litewrite_restore_version`.
- For `litewrite_restore_version`, **always save the current state first** using `litewrite_save_version` before restoring.

### Version Auto-Save
- `litewrite_compile` **automatically saves a version** after successful compilation (can be disabled with `auto_save=false`).
- Use `litewrite_save_version` for explicit saves without compiling (e.g., before a major rewrite).

### Handling Attached Files
- When the user sends files (images, documents), their **local paths** appear in the `[Attached files]` section of the message.
- Use these paths with `litewrite_upload_file` to upload files to a project.
- The LLM can also **see** attached images (vision), so you can understand the content before deciding where to place them.

### Using litewrite_edit_file (fallback only)
- **ALWAYS provide the COMPLETE file content**. This tool does full-file replacement.
- **NEVER send only a snippet** - the entire file will be overwritten.
- Prefer `litewrite_agent` over this tool for any editing task.
