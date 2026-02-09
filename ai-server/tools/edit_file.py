"""
Edit File Tool
==============

Intelligent tool for editing project files using LLM.

This tool takes a natural language edit instruction, automatically reads the
latest file content, generates precise edit parameters, executes the edits
via Next.js, and returns a summary with the updated content.

Flow:
1. Agent provides: file_path, edit_instruction, reference (optional)
2. Tool reads the latest file content from Next.js (ensures content is always fresh)
3. LLM analyzes and generates edit blocks (start_line, end_line, updated)
4. All edit blocks are sent to Next.js for batch execution
5. LLM summarizes all changes
6. Tool returns summary and updated_content (with line numbers) for further edits

Usage by Agent:
    {
        "tool": "edit_file",
        "params": {
            "file_path": "main.tex",
            "edit_instruction": "Simplify the introduction (lines 10-15) and fix the typo in line 30",
            "reference": "Optional reference material"
        }
    }

Note: No need to pass file_content - the tool reads it automatically to ensure
the latest version is always used. This prevents line number mismatch issues.
"""

from typing import Dict, Any, List, Optional
import uuid
import json
import logging
import re
import httpx
from json_repair import loads as json_repair_loads

from tools.base import Tool, ToolResult, ToolContext, ToolMode, ExecutorType
from tools.read_file import add_line_numbers
from core.llm import get_llm_client
from core.config import config
# Note: OSS variant has no payments/credits system; we may optionally record usage.

logger = logging.getLogger(__name__)

# HTTP timeout for Next.js API calls
HTTP_TIMEOUT = 30.0  # seconds per edit block

# System prompt for generating edit blocks
EDIT_GENERATION_PROMPT = """You are an edit assistant for Litewrite, a collaborative document editor for LaTeX, Markdown, and similar formats.

Your task is to analyze the file content and edit instruction, then generate precise edit blocks.

RULES:
1. Line numbers in the file content are shown as [Line X] prefixes - use these exact numbers
2. Lines marked as [Line X, Locked by UserName] are being edited by others - DO NOT modify these
3. Each edit block specifies a range of lines to replace with new content
4. You can output MULTIPLE edit blocks if the instruction requires changes in different places
5. For each block, provide start_line, end_line, and the updated content
6. The updated content should NOT include [Line X] prefixes - just the actual content
7. Be precise with line numbers - double check them against the file content

OUTPUT FORMAT:
Return a JSON object with an "edits" array:
{
  "edits": [
    {
      "start_line": <int>,
      "end_line": <int>,
      "updated": "<new content for this range>",
      "description": "<brief description of this specific change>"
    }
  ],
  "reasoning": "<overall explanation of the changes>"
}

IMPORTANT:
- Sort edits by start_line in DESCENDING order (edit from bottom to top to preserve line numbers)
- Make sure line ranges don't overlap
- If a line is locked, skip editing it and mention in reasoning"""

# System prompt for summarizing edits
EDIT_SUMMARY_PROMPT = """Summarize the file edits in 1-2 concise sentences. Focus on what was changed and why.

Be brief and informative. Example: "Simplified the introduction section and fixed a typo in the methodology."
"""


def build_edit_prompt(
    file_content: str,
    edit_instruction: str,
    reference: Optional[str] = None,
) -> str:
    """Build the user prompt for edit generation."""
    parts = [
        "## File Content",
        file_content,
        "",
        "## Edit Instruction",
        edit_instruction,
    ]

    if reference:
        parts.extend(
            [
                "",
                "## Reference Material",
                reference,
            ]
        )

    parts.extend(
        [
            "",
            "## Task",
            "Generate the edit blocks as specified in the OUTPUT FORMAT.",
        ]
    )

    return "\n".join(parts)


def build_summary_prompt(
    file_path: str,
    edits: List[Dict[str, Any]],
    edit_instruction: str,
) -> str:
    """Build the prompt for edit summary."""
    edit_descriptions = []
    for i, edit in enumerate(edits, 1):
        desc = edit.get("description", "No description")
        lines = f"lines {edit['start_line']}-{edit['end_line']}"
        edit_descriptions.append(f"{i}. {lines}: {desc}")

    return f"""File: {file_path}
Original instruction: {edit_instruction}

Edits made:
{chr(10).join(edit_descriptions)}

Summarize these changes:"""


def parse_edit_response(response_text: str) -> Dict[str, Any]:
    """Parse the LLM response to extract edit blocks using json_repair for robustness."""
    # Try to find JSON content
    json_content = response_text

    # Try to extract JSON from markdown code fence
    json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", response_text, re.DOTALL)
    if json_match:
        json_content = json_match.group(1)
    else:
        # Try to find JSON object directly
        json_match = re.search(r'\{[\s\S]*"edits"[\s\S]*\}', response_text)
        if json_match:
            json_content = json_match.group(0)

    # Use json_repair to parse (handles malformed JSON)
    try:
        result = json_repair_loads(json_content)
        if isinstance(result, dict) and "edits" in result:
            return result
    except Exception as e:
        logger.warning(f"[EditFile] json_repair failed: {e}")

    # Fallback: try standard json.loads on original
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        pass

    raise ValueError(f"Could not parse edit response: {response_text[:200]}...")


class EditFileTool(Tool):
    """
    Intelligent tool for editing project files using LLM.

    Features:
    - Takes natural language edit instructions
    - LLM generates precise edit blocks (supports multiple)
    - Delegates execution to Next.js
    - LLM summarizes the changes
    - Handles locked lines (collaborative editing)
    - Credits deduction for LLM calls
    """

    name = "edit_file"
    description = """Edit a file based on natural language instructions.

Use this to make changes to files. The tool will:
1. Automatically read the latest file content (no need to pass file_content)
2. Analyze your instruction and generate precise edit blocks
3. Apply the edits in batch
4. Return a summary and updated_content for further edits

Parameters:
- file_path: Path to the file to edit
- edit_instruction: What changes to make (natural language)
- reference: Optional reference material to guide the edit

Example:
edit_file({
    "file_path": "main.tex",
    "edit_instruction": "Simplify the introduction and fix the typo on line 30"
})

Notes:
- Lines marked [Line X, Locked by UserName] cannot be edited
- Multiple changes can be made in one call
- For incremental edits, call this tool multiple times (each call reads fresh content)
- The updated_content in response can be used for reference"""

    parameters = {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the file to edit, relative to project root (e.g., 'main.tex', 'figs/case.tex'). Use list_files to see available files.",
            },
            "edit_instruction": {
                "type": "string",
                "description": "Natural language description of what changes to make",
            },
            "reference": {
                "type": "string",
                "description": "Optional. Reference material to guide the edit (e.g., example text, style guide)",
            },
        },
        "required": ["file_path", "edit_instruction"],
    }

    mode = ToolMode.AGENT  # Agent-only (write operation)
    executor = ExecutorType.LOCAL  # Direct HTTP call to Next.js internal API

    async def execute(
        self,
        params: Dict[str, Any],
        context: ToolContext,
        timeout: float = HTTP_TIMEOUT,
    ) -> ToolResult:
        """
        Execute the edit_file tool.

        1. Read latest file content from Next.js
        2. Call LLM to generate edit blocks
        3. Execute all edits via Next.js in batch
        4. Call LLM to summarize changes
        5. Return results with updated_content
        """
        file_path = params.get("file_path")
        edit_instruction = params.get("edit_instruction")
        reference = params.get("reference")

        # Log tool invocation
        logger.info(
            f"[EditFile] Tool invoked: file={file_path}, "
            f"instruction_len={len(edit_instruction) if edit_instruction else 0}, "
            f"has_reference={bool(reference)}"
        )
        logger.debug(f"[EditFile] Edit instruction: {edit_instruction}")
        if reference:
            logger.debug(
                f"[EditFile] Reference (first 200 chars): {reference[:200]}..."
            )

        # Validate required params
        if not file_path:
            return ToolResult(
                success=False,
                text="No file path provided",
                error="file_path is required",
            )

        if not edit_instruction:
            return ToolResult(
                success=False,
                text="No edit instruction provided. What changes should be made?",
                error="edit_instruction is required",
            )

        # Step 0: Read latest file content from Next.js
        logger.info("[EditFile] === Step 0: Reading file from Next.js ===")
        context.emit_status(f"Reading {file_path}...", status="working")

        try:
            read_result = await self._read_file_content(
                file_path=file_path,
                context=context,
                timeout=timeout,
            )
        except Exception as e:
            logger.error(f"[EditFile] Step 0 FAILED: {e}")
            return ToolResult(
                success=False,
                text=f"Failed to read file {file_path}: {str(e)}",
                error=str(e),
            )

        if not read_result.get("success"):
            error_msg = read_result.get("error", "Unknown error")
            logger.error(f"[EditFile] Step 0 FAILED: {error_msg}")
            return ToolResult(
                success=False,
                text=f"Cannot read file {file_path}: {error_msg}",
                error=error_msg,
            )

        # Check if file is vibe-locked by another user
        vibe_lock = read_result.get("data", {}).get("vibeLock", {})
        logger.debug(f"[EditFile] Step 0 - Vibe lock status: {vibe_lock}")
        if vibe_lock.get("isLocked"):
            locked_by = vibe_lock.get("lockedBy", {})
            if locked_by.get("userId") != context.user_id:
                user_name = locked_by.get("userName", "another user")
                logger.warning(
                    f"[EditFile] Step 0 - File locked by another user: {user_name}"
                )
                return ToolResult(
                    success=False,
                    text=f"Cannot edit {file_path}: file is being processed by {user_name}'s AI. Please wait.",
                    error="FILE_LOCKED",
                )

        # Extract content with line numbers
        data = read_result.get("data", {})
        raw_content = data.get("content", "")
        locked_ranges = data.get("lockedRanges", [])
        file_content = add_line_numbers(raw_content, 1, locked_ranges)

        logger.info(
            f"[EditFile] Step 0 SUCCESS: {len(raw_content)} chars, {len(raw_content.splitlines())} lines"
        )
        logger.debug(f"[EditFile] Step 0 - Locked ranges: {locked_ranges}")
        logger.debug(f"[EditFile] Step 0 - File content:\n{file_content}...")

        # Step 1: Generate edit blocks using LLM
        logger.info("[EditFile] === Step 1: Generating edit blocks via LLM ===")
        context.emit_status("Analyzing edit instruction...", status="thinking")

        try:
            edit_blocks, reasoning = await self._generate_edit_blocks(
                file_content=file_content,
                edit_instruction=edit_instruction,
                reference=reference,
                context=context,
            )
        except Exception as e:
            logger.error(f"[EditFile] Step 1 FAILED: {e}")
            return ToolResult(
                success=False,
                text=f"Failed to analyze edit instruction: {str(e)}",
                error=str(e),
            )

        if not edit_blocks:
            logger.warning("[EditFile] Step 1 - No edit blocks generated")
            return ToolResult(
                success=False,
                text="Could not determine what edits to make. Please provide clearer instructions.",
                error="No edit blocks generated",
            )

        logger.info(
            f"[EditFile] Step 1 SUCCESS: Generated {len(edit_blocks)} edit block(s)"
        )
        for i, eb in enumerate(edit_blocks):
            logger.debug(
                f"[EditFile] Step 1 - Block {i + 1}: lines {eb.get('start_line')}-{eb.get('end_line')}, "
                f"updated_len={len(eb.get('updated', ''))}, desc={eb.get('description', '')[:80]}"
            )
        logger.debug(
            f"[EditFile] Step 1 - Reasoning: {reasoning[:300]}..."
            if reasoning
            else "[EditFile] Step 1 - No reasoning provided"
        )

        # Step 2: Execute all edits
        logger.info(
            f"[EditFile] === Step 2: Executing {len(edit_blocks)} edit(s) "
            f"(direct_apply={context.direct_apply}) ==="
        )
        context.emit_status(f"Applying {len(edit_blocks)} edit(s)...", status="working")

        if context.direct_apply:
            # Direct apply mode: apply edits in memory and write full content
            # via /api/internal/files/edit (bypasses shadow documents)
            logger.info("[EditFile] Step 2 - Using direct apply mode")

            try:
                result = await self._execute_direct_apply(
                    file_path=file_path,
                    raw_content=raw_content,
                    edit_blocks=edit_blocks,
                    context=context,
                    timeout=timeout,
                )
            except Exception as e:
                logger.error(f"[EditFile] Step 2 FAILED (direct apply): {e}")
                return ToolResult(
                    success=False,
                    text=f"Failed to apply edits: {str(e)}",
                    error=str(e),
                )
        else:
            # Standard mode: use shadow documents via /api/internal/files/write
            # Emit file_locked event
            context.emit("file_locked", {"filePath": file_path})
            logger.debug(
                f"[EditFile] Step 2 - Emitted file_locked event for {file_path}"
            )

            try:
                result = await self._execute_all_edits(
                    file_path=file_path,
                    edit_blocks=edit_blocks,
                    context=context,
                    timeout=timeout,
                )
            except Exception as e:
                logger.error(f"[EditFile] Step 2 FAILED: {e}")
                return ToolResult(
                    success=False,
                    text=f"Failed to apply edits: {str(e)}",
                    error=str(e),
                )

        # Handle FILE_LOCKED error - return early with clear message
        if result.get("errorCode") == "FILE_LOCKED":
            locked_by = result.get("lockedBy", {})
            user_name = locked_by.get("userName", "another user")
            logger.warning(f"[EditFile] Step 2 - FILE_LOCKED by {user_name}")
            error_message = (
                f"Cannot edit {file_path}: file is being processed by {user_name}'s AI. "
                f"Please wait for them to finish or ask the user to coordinate."
            )
            return ToolResult(
                success=False,
                text=error_message,
                error="FILE_LOCKED",
                data={
                    "file_path": file_path,
                    "error_code": "FILE_LOCKED",
                    "locked_by": locked_by,
                },
            )

        all_success = result.get("success", False)
        edit_results = [{"edit": eb, "success": all_success} for eb in edit_blocks]
        logger.info(
            f"[EditFile] Step 2 {'SUCCESS' if all_success else 'FAILED'}: Applied {len(edit_blocks)} edit(s)"
        )

        # Extract updated content from result (for further edits)
        result_data = result.get("data", {})
        # In direct apply mode, updated content is in "content"; in shadow mode, "shadowContent"
        new_content = result_data.get("content", "") or result_data.get(
            "shadowContent", ""
        )
        updated_content = ""
        if new_content:
            # Format with line numbers for agent's reference
            updated_content = add_line_numbers(new_content, 1, None)
            logger.info(
                f"[EditFile] Step 2 - Updated content: {len(new_content)} chars, {len(new_content.splitlines())} lines"
            )
            logger.debug(f"[EditFile] Step 2 - Updated content:\n{updated_content}...")
        else:
            logger.warning("[EditFile] Step 2 - No updated content in response")

        # Step 3: Generate summary using LLM
        logger.info("[EditFile] === Step 3: Generating summary via LLM ===")
        context.emit_status("Summarizing changes...", status="thinking")

        try:
            summary = await self._generate_summary(
                file_path=file_path,
                edits=edit_blocks,
                edit_instruction=edit_instruction,
                context=context,
            )
            logger.info("[EditFile] Step 3 SUCCESS: Summary generated")
            logger.debug(f"[EditFile] Step 3 - Summary: {summary}")
        except Exception as e:
            logger.warning(f"[EditFile] Step 3 FAILED: {e}, using fallback summary")
            # Fallback summary
            successful_count = sum(1 for r in edit_results if r["success"])
            summary = (
                f"Applied {successful_count}/{len(edit_blocks)} edits to {file_path}."
            )

        # Build final result
        if all_success:
            text = summary
        else:
            failed_count = sum(1 for r in edit_results if not r["success"])
            text = f"{summary}\n\nNote: {failed_count} edit(s) failed."

        # Emit plan event for frontend
        context.emit(
            "edit_complete",
            {
                "file_path": file_path,
                "edits": edit_blocks,
                "results": edit_results,
                "summary": summary,
                "all_success": all_success,
            },
        )
        logger.debug("[EditFile] Emitted edit_complete event")

        # Final result logging
        logger.info(
            f"[EditFile] === COMPLETED: success={all_success}, "
            f"edits={len(edit_blocks)}, updated_content_len={len(updated_content)} ==="
        )

        return ToolResult(
            success=all_success,
            text=text,
            data={
                "file_path": file_path,
                "edits": edit_blocks,
                "results": edit_results,
                "reasoning": reasoning,
                "summary": summary,
                "all_success": all_success,
                # Updated content with line numbers for further edits
                "updated_content": updated_content,
            },
        )

    async def _read_file_content(
        self,
        file_path: str,
        context: ToolContext,
        timeout: float,
    ) -> Dict[str, Any]:
        """
        Read file content from Next.js internal API.

        Returns:
            Result dict with success, data (content, lockedRanges, vibeLock), or error
        """
        url = f"{config.nextjs_api_url}/api/internal/files/read"
        payload = {
            "projectId": context.project_id,
            "userId": context.user_id,
            "filePath": file_path,
        }

        logger.info(f"[EditFile] _read_file_content: POST {url}")
        logger.debug(f"[EditFile] _read_file_content: payload={payload}")

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Internal-Secret": config.internal_api_secret,
                },
            )

            logger.info(f"[EditFile] _read_file_content: status={response.status_code}")

            if response.status_code != 200:
                logger.error(
                    f"[EditFile] _read_file_content: HTTP error {response.status_code}: {response.text[:500]}"
                )
                return {"success": False, "error": f"HTTP {response.status_code}"}

            try:
                result = response.json()
            except Exception as json_err:
                logger.error(
                    f"[EditFile] _read_file_content: JSON parse error: {json_err}"
                )
                return {"success": False, "error": f"JSON parse error: {json_err}"}

            # Log response details
            data = result.get("data", {})
            logger.info(
                f"[EditFile] _read_file_content: success={result.get('success')}, "
                f"content_len={len(data.get('content', ''))}, "
                f"totalLines={data.get('totalLines')}, "
                f"vibeLock={data.get('vibeLock', {}).get('isLocked', False)}"
            )
            logger.debug(
                f"[EditFile] _read_file_content: lockedRanges={data.get('lockedRanges', [])}"
            )

            return result

    async def _generate_edit_blocks(
        self,
        file_content: str,
        edit_instruction: str,
        reference: Optional[str],
        context: ToolContext,
    ) -> tuple[List[Dict[str, Any]], str]:
        """
        Call LLM to generate edit blocks.

        Returns:
            (edit_blocks, reasoning) tuple
        """
        user_prompt = build_edit_prompt(
            file_content=file_content,
            edit_instruction=edit_instruction,
            reference=reference,
        )

        # Log LLM input
        logger.info("[EditFile] Generating edit blocks via LLM")
        logger.debug(f"[EditFile] LLM Input - System:\n{EDIT_GENERATION_PROMPT}")
        logger.debug(f"[EditFile] LLM Input - User:\n{user_prompt}")

        client = get_llm_client()
        response = await client.chat.completions.create(
            model=config.llm_model,
            messages=[
                {"role": "system", "content": EDIT_GENERATION_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,  # Low temperature for precise edits
            max_tokens=4000,  # Allow longer responses for multiple edits
        )

        # Optionally record token usage (OSS: no payments/credits)
        await context.record_usage_from_response(
            response, action="edit_generation", tool_name="Edit"
        )

        # Parse response
        response_text = response.choices[0].message.content.strip()

        # Log LLM output
        logger.info(f"[EditFile] LLM Output received, length={len(response_text)}")
        logger.debug(f"[EditFile] LLM Output:\n{response_text}")

        parsed = parse_edit_response(response_text)

        edits = parsed.get("edits", [])
        reasoning = parsed.get("reasoning", "")

        # Validate and sort edits (descending by start_line for safe application)
        valid_edits = []
        for edit in edits:
            if all(k in edit for k in ["start_line", "end_line", "updated"]):
                if edit["start_line"] >= 1 and edit["end_line"] >= edit["start_line"]:
                    valid_edits.append(edit)
                else:
                    logger.warning(f"Invalid line range: {edit}")
            else:
                logger.warning(f"Missing required fields in edit: {edit}")

        # Sort by start_line descending (edit from bottom to top)
        valid_edits.sort(key=lambda x: x["start_line"], reverse=True)

        # Check for overlapping ranges (after sorting, check adjacent pairs)
        non_overlapping_edits = []
        for i, edit in enumerate(valid_edits):
            if i == 0:
                non_overlapping_edits.append(edit)
                continue

            # Previous edit (higher line numbers, already added)
            prev_edit = non_overlapping_edits[-1]
            # Current edit should end before previous edit starts
            if edit["end_line"] < prev_edit["start_line"]:
                non_overlapping_edits.append(edit)
            else:
                # Overlap detected - skip this edit
                logger.warning(
                    f"[EditFile] Skipping overlapping edit: lines {edit['start_line']}-{edit['end_line']} "
                    f"overlaps with lines {prev_edit['start_line']}-{prev_edit['end_line']}"
                )

        valid_edits = non_overlapping_edits

        # Log parsed result
        logger.info(
            f"[EditFile] Parsed {len(valid_edits)} valid edit blocks (after overlap check)"
        )
        for i, edit in enumerate(valid_edits):
            logger.debug(
                f"[EditFile] Edit block {i + 1}: lines {edit['start_line']}-{edit['end_line']}, "
                f"updated_len={len(edit.get('updated', ''))}, desc={edit.get('description', 'N/A')[:50]}"
            )
        if reasoning:
            logger.debug(f"[EditFile] Reasoning: {reasoning[:200]}...")

        return valid_edits, reasoning

    async def _execute_all_edits(
        self,
        file_path: str,
        edit_blocks: List[Dict[str, Any]],
        context: ToolContext,
        timeout: float,
    ) -> Dict[str, Any]:
        """
        Execute all edit blocks in one batch via HTTP call to Next.js internal API.

        This ensures all edits use the same base content and line numbers are correct.

        Returns:
            Result dict with success/error
        """
        edit_id = f"edit_{uuid.uuid4().hex[:8]}"

        # Build request payload with all blocks
        payload = {
            "projectId": context.project_id,
            "userId": context.user_id,
            "filePath": file_path,
            "editId": edit_id,
            "blocks": [
                {
                    "startLine": eb["start_line"],
                    "endLine": eb["end_line"],
                    "updated": eb["updated"],
                    "description": eb.get("description", "Edit"),
                }
                for eb in edit_blocks
            ],
        }

        # Make HTTP call to Next.js internal API
        url = f"{config.nextjs_api_url}/api/internal/files/write"
        logger.info(f"[EditFile] _execute_all_edits: POST {url}")
        logger.debug(
            f"[EditFile] _execute_all_edits: editId={edit_id}, blocks={len(payload['blocks'])}"
        )
        for i, block in enumerate(payload["blocks"]):
            logger.debug(
                f"[EditFile] _execute_all_edits: block[{i}] lines {block['startLine']}-{block['endLine']}, "
                f"updated_len={len(block['updated'])}"
            )

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

                logger.info(
                    f"[EditFile] _execute_all_edits: status={response.status_code}"
                )

                # Check if response is valid before parsing
                if response.status_code != 200:
                    logger.error(
                        f"[EditFile] _execute_all_edits: HTTP error {response.status_code}: {response.text[:500]}"
                    )
                    return {"success": False, "error": f"HTTP {response.status_code}"}

                # Try to parse JSON
                try:
                    result = response.json()
                except Exception as json_err:
                    logger.error(
                        f"[EditFile] _execute_all_edits: JSON parse error: {json_err}, response text: {response.text[:500]}"
                    )
                    return {"success": False, "error": f"JSON parse error: {json_err}"}

                # Log response details
                result_data = result.get("data", {})
                logger.info(
                    f"[EditFile] _execute_all_edits: success={result.get('success')}, "
                    f"blocks={len(result_data.get('blocks', []))}, "
                    f"allBlocks={len(result_data.get('allBlocks', []))}, "
                    f"shadowContent_len={len(result_data.get('shadowContent', ''))}"
                )

                # Check for FILE_LOCKED error
                if result.get("errorCode") == "FILE_LOCKED":
                    locked_by = result.get("lockedBy", {})
                    logger.warning(
                        f"[EditFile] _execute_all_edits: FILE_LOCKED by {locked_by.get('userName', 'another user')}"
                    )
                    return {
                        "success": False,
                        "error": "FILE_LOCKED",
                        "errorCode": "FILE_LOCKED",
                        "message": result.get(
                            "message", "File is locked by another user's AI"
                        ),
                        "lockedBy": locked_by,
                    }

                # Emit file_edit event for frontend if successful
                if result.get("success"):
                    data = result.get("data", {})
                    logger.debug(
                        "[EditFile] _execute_all_edits: Emitting file_edit event"
                    )
                    context.emit(
                        "file_edit",
                        {
                            "editId": edit_id,
                            "filePath": file_path,
                            "blocks": data.get("blocks", []),
                            "allBlocks": data.get("allBlocks", []),
                            "description": f"Applied {len(edit_blocks)} edit(s)",
                        },
                    )

                return result

        except httpx.TimeoutException:
            logger.error(f"[EditFile] Timeout editing {file_path}")
            return {"success": False, "error": f"HTTP timeout after {timeout}s"}
        except httpx.ConnectError as e:
            logger.error(f"[EditFile] Connection error to {url}: {e}")
            return {"success": False, "error": f"Connection error: {e}"}
        except Exception as e:
            logger.error(f"[EditFile] Error editing {file_path}: {e}")
            return {"success": False, "error": str(e)}

    async def _execute_direct_apply(
        self,
        file_path: str,
        raw_content: str,
        edit_blocks: List[Dict[str, Any]],
        context: ToolContext,
        timeout: float,
    ) -> Dict[str, Any]:
        """
        Apply edit blocks directly to storage via /api/internal/files/edit.

        This bypasses the shadow document system and writes the full updated
        content directly to storage. Used when context.direct_apply is True
        (e.g., when invoked by nanobot).

        Steps:
        1. Apply edit blocks to raw_content in memory (bottom-to-top)
        2. Write the full updated content via /api/internal/files/edit

        Returns:
            Result dict with success/error and updated content
        """
        # Apply edit blocks in memory (already sorted descending by start_line)
        lines = raw_content.split("\n")
        for block in edit_blocks:
            start = block["start_line"] - 1  # Convert to 0-indexed
            end = block["end_line"]  # Exclusive end for slice
            updated_lines = block["updated"].split("\n")
            lines[start:end] = updated_lines

        new_content = "\n".join(lines)

        logger.info(
            f"[EditFile] _execute_direct_apply: Applied {len(edit_blocks)} blocks in memory, "
            f"content {len(raw_content)} -> {len(new_content)} chars"
        )

        # Write full content via /api/internal/files/edit
        url = f"{config.nextjs_api_url}/api/internal/files/edit"
        payload = {
            "projectId": context.project_id,
            "filePath": file_path,
            "content": new_content,
        }

        logger.info(f"[EditFile] _execute_direct_apply: POST {url}")

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

                logger.info(
                    f"[EditFile] _execute_direct_apply: status={response.status_code}"
                )

                if response.status_code != 200:
                    logger.error(
                        f"[EditFile] _execute_direct_apply: HTTP error {response.status_code}: {response.text[:500]}"
                    )
                    return {"success": False, "error": f"HTTP {response.status_code}"}

                try:
                    result = response.json()
                except Exception as json_err:
                    logger.error(
                        f"[EditFile] _execute_direct_apply: JSON parse error: {json_err}"
                    )
                    return {"success": False, "error": f"JSON parse error: {json_err}"}

                if result.get("success"):
                    # Include the updated content in the result for the agent
                    result.setdefault("data", {})
                    result["data"]["content"] = new_content

                return result

        except httpx.TimeoutException:
            logger.error(f"[EditFile] Timeout in direct apply for {file_path}")
            return {"success": False, "error": f"HTTP timeout after {timeout}s"}
        except httpx.ConnectError as e:
            logger.error(f"[EditFile] Connection error to {url}: {e}")
            return {"success": False, "error": f"Connection error: {e}"}
        except Exception as e:
            logger.error(f"[EditFile] Error in direct apply for {file_path}: {e}")
            return {"success": False, "error": str(e)}

    async def _execute_single_edit(
        self,
        file_path: str,
        edit_block: Dict[str, Any],
        context: ToolContext,
        timeout: float,
    ) -> Dict[str, Any]:
        """
        Execute a single edit block via HTTP call to Next.js internal API.

        NOTE: Deprecated - use _execute_all_edits for batch execution.
        Kept for backward compatibility.

        Returns:
            Result dict with success/error
        """
        edit_id = f"edit_{uuid.uuid4().hex[:8]}"

        # Build request payload
        payload = {
            "projectId": context.project_id,
            "userId": context.user_id,
            "filePath": file_path,
            "editId": edit_id,
            "blocks": [
                {
                    "startLine": edit_block["start_line"],
                    "endLine": edit_block["end_line"],
                    "updated": edit_block["updated"],
                    "description": edit_block.get("description", "Edit"),
                }
            ],
        }

        # Make HTTP call to Next.js internal API
        url = f"{config.nextjs_api_url}/api/internal/files/write"
        logger.info(f"[EditFile] Calling {url} for {file_path}")
        logger.debug(
            f"[EditFile] Payload: editId={edit_id}, blocks={len(payload['blocks'])}"
        )

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

                logger.info(f"[EditFile] Response status: {response.status_code}")

                # Check if response is valid before parsing
                if response.status_code != 200:
                    logger.error(
                        f"[EditFile] HTTP error {response.status_code}: {response.text[:500]}"
                    )
                    return {"success": False, "error": f"HTTP {response.status_code}"}

                # Try to parse JSON
                try:
                    result = response.json()
                except Exception as json_err:
                    logger.error(
                        f"[EditFile] JSON parse error: {json_err}, response text: {response.text[:500]}"
                    )
                    return {"success": False, "error": f"JSON parse error: {json_err}"}

                logger.debug(
                    f"[EditFile] Response: success={result.get('success')}, file={file_path}"
                )

                # Check for FILE_LOCKED error
                if result.get("errorCode") == "FILE_LOCKED":
                    locked_by = result.get("lockedBy", {})
                    logger.warning(
                        f"[EditFile] File {file_path} is locked by {locked_by.get('userName', 'another user')}"
                    )
                    return {
                        "success": False,
                        "error": "FILE_LOCKED",
                        "errorCode": "FILE_LOCKED",
                        "message": result.get(
                            "message", "File is locked by another user's AI"
                        ),
                        "lockedBy": locked_by,
                    }

                # Emit file_edit event for frontend if successful
                if result.get("success"):
                    data = result.get("data", {})
                    context.emit(
                        "file_edit",
                        {
                            "editId": edit_id,
                            "filePath": file_path,
                            "blocks": data.get("blocks", []),
                            "allBlocks": data.get("allBlocks", []),
                            "description": edit_block.get("description", "Edit"),
                        },
                    )

                return result

        except httpx.TimeoutException:
            logger.error(f"[EditFile] Timeout editing {file_path}")
            return {"success": False, "error": f"HTTP timeout after {timeout}s"}
        except httpx.ConnectError as e:
            logger.error(f"[EditFile] Connection error to {url}: {e}")
            return {"success": False, "error": f"Connection error: {e}"}
        except Exception as e:
            logger.error(f"[EditFile] Error editing {file_path}: {e}")
            return {"success": False, "error": str(e)}

    async def _generate_summary(
        self,
        file_path: str,
        edits: List[Dict[str, Any]],
        edit_instruction: str,
        context: ToolContext,
    ) -> str:
        """
        Call LLM to generate a summary of the edits.

        Returns:
            Summary string
        """
        user_prompt = build_summary_prompt(
            file_path=file_path,
            edits=edits,
            edit_instruction=edit_instruction,
        )

        # Log LLM input
        logger.info("[EditFile] Generating summary via LLM")
        logger.debug(f"[EditFile] Summary LLM Input - System:\n{EDIT_SUMMARY_PROMPT}")
        logger.debug(f"[EditFile] Summary LLM Input - User:\n{user_prompt}")

        client = get_llm_client()
        response = await client.chat.completions.create(
            model=config.llm_model,
            messages=[
                {"role": "system", "content": EDIT_SUMMARY_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=200,
        )

        # Optionally record token usage (OSS: no payments/credits)
        await context.record_usage_from_response(
            response, action="edit_summary", tool_name="Edit"
        )

        summary = response.choices[0].message.content.strip()

        # Log LLM output
        logger.info(f"[EditFile] Summary LLM Output: {summary}")

        return summary


__all__ = ["EditFileTool"]
