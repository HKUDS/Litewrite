---
name: litewrite
description: "Manage LaTeX projects in Litewrite - list projects, read/edit files, compile to PDF, deep research, and send results to users."
metadata: {"nanobot":{"always":true}}
---

# Litewrite Skill

You have access to **Litewrite**, a LaTeX writing platform. Use the `litewrite_*` tools to manage LaTeX projects.

## Available Tools

- `litewrite_create_project` - Create a new LaTeX project (returns project ID for use with other tools)
- `litewrite_list_projects` - Search and list projects by name
- `litewrite_list_files` - List all files in a project
- `litewrite_read_file` - Read a file's content
- `litewrite_edit_file` - Replace a file's entire content
- `litewrite_compile` - Compile the project to PDF (supports pdflatex, xelatex, lualatex)
- `litewrite_deep_research` - Perform deep research on a topic (arXiv + web search, multi-iteration, generates report with references and BibTeX)

## Typical Workflow

### Creating a New Project & Compiling

1. **Create a project**: Use `litewrite_create_project(name="...", main_file_content="<full LaTeX>")` to create a new project with initial content
2. **Compile**: Use `litewrite_compile(project_id)` to build the PDF
3. **Send the PDF**: Use the `message` tool with the `media` parameter containing the PDF path

### Editing an Existing Project

1. **Find the project**: Use `litewrite_list_projects` with a search keyword
2. **Read the file**: Use `litewrite_read_file` to get the current content (usually `main.tex`)
3. **Edit the file**: Use `litewrite_edit_file` with the **complete** new file content
4. **Compile**: Use `litewrite_compile` to build the PDF
5. **Send the PDF**: Use the `message` tool with the `media` parameter containing the PDF path

### Deep Research (MANDATORY workflow)

When the user asks to research/survey/investigate a topic, you MUST follow ALL these steps:

1. **Research**: Use `litewrite_deep_research(query="...")` — this returns a Markdown report with citations and BibTeX
2. **Create project**: Use `litewrite_create_project(name="<topic> Survey", main_file_content="<LaTeX version of the report>")` — convert the Markdown report to a proper LaTeX document with `\documentclass`, `\begin{document}`, sections, `\bibliography`, etc.
3. **Compile**: Use `litewrite_compile(project_id, compiler="xelatex")` to build the PDF
4. **Send PDF**: Use `message(content="...", media=[pdf_path])` to send the compiled PDF to the user

**NEVER skip steps 2-4.** The user expects a compiled PDF, not raw Markdown text.
**NEVER just send the Markdown report as a text message.** Always compile it into a PDF first.

## CRITICAL Rules

### LaTeX Compilation
- **ALWAYS use `litewrite_compile`** to compile LaTeX documents. NEVER use `exec` to run `pdflatex`, `xelatex`, or `lualatex` directly - the compiler is NOT installed locally.
- **ALWAYS create a Litewrite project first** (with `litewrite_create_project`) before compiling. Do NOT write `.tex` files locally with `write_file`.

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
