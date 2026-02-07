---
name: litewrite
description: "Manage LaTeX projects in Litewrite - list projects, read/edit files, compile to PDF, and send results to users."
metadata: {"nanobot":{"always":true}}
---

# Litewrite Skill

You have access to **Litewrite**, a LaTeX writing platform. Use the `litewrite_*` tools to manage LaTeX projects.

## Available Tools

- `litewrite_list_projects` - Search and list projects by name
- `litewrite_list_files` - List all files in a project
- `litewrite_read_file` - Read a file's content
- `litewrite_edit_file` - Replace a file's entire content
- `litewrite_compile` - Compile the project to PDF (supports pdflatex, xelatex, lualatex)

## Typical Workflow

1. **Find the project**: Use `litewrite_list_projects` with a search keyword
2. **Read the file**: Use `litewrite_read_file` to get the current content (usually `main.tex`)
3. **Edit the file**: Use `litewrite_edit_file` with the **complete** new file content
4. **Compile**: Use `litewrite_compile` to build the PDF
5. **Send the PDF**: Use the `message` tool with the `media` parameter containing the PDF path

## CRITICAL Rules

### Editing Files
- **ALWAYS provide the COMPLETE file content** when using `litewrite_edit_file`. This tool does full-file replacement.
- **NEVER send only a snippet or partial content** - the entire file will be overwritten with what you provide.
- First read the file with `litewrite_read_file`, then modify the parts you need, then write back the entire file.

### Compiler Selection
- **pdflatex** (default): Standard LaTeX compiler. Works for most English-only documents.
- **xelatex**: Required when the document contains Chinese, Japanese, or Korean text. Also needed for `fontspec`, `xeCJK`, or custom Unicode fonts.
- **lualatex**: Alternative Unicode-aware compiler.
- **Rule of thumb**: If you are adding Chinese/CJK content to a document, you MUST use `compiler="xelatex"` when compiling.

### Adding Chinese Support to LaTeX
When modifying a document to include Chinese text:
1. Add `\usepackage{xeCJK}` in the preamble (before `\begin{document}`)
2. Add `\setCJKmainfont{Noto Sans CJK SC}` after the xeCJK package
3. Remove `\usepackage[T1]{fontenc}` and `\usepackage[utf8]{inputenc}` (incompatible with xelatex)
4. Compile with `compiler="xelatex"`

## Example

User says: "Change the RAGAnything paper title to Chinese, compile and send it to me"

Steps:
1. `litewrite_list_projects(search="RAGAnything")` -> find the project ID
2. `litewrite_read_file(project_id, "main.tex")` -> read the FULL current content
3. Modify the `\title{...}` to Chinese, add xeCJK support packages
4. `litewrite_edit_file(project_id, "main.tex", <FULL modified content>)` -> write back the ENTIRE file
5. `litewrite_compile(project_id, compiler="xelatex")` -> compile with xelatex for CJK support
6. `message(content="Compilation complete, PDF sent", media=[pdf_path])` -> send to user
