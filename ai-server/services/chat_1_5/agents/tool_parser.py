"""
Tool Parser
===========

Utilities for Prompt-based Tool Calling.

This module provides:
- Tool call extraction from <tool_call>...</tool_call> tags (primary format)
- Legacy JSON code block extraction (backward compatibility)
- Tool description generation for System Prompt

Primary Format (new):
```
Text message to user...

<tool_call>
[{"tool": "tool_name", "params": {"param1": "value1"}}]
</tool_call>
```

Legacy Format (still supported):
```json
[{"tool": "tool_name", "params": {"param1": "value1"}}]
```

Tools are executed sequentially (in order).
"""

import re
import json
import uuid
import logging
from typing import List, Dict, Any, Tuple, Optional

import json_repair

from tools.base import Tool

logger = logging.getLogger(__name__)


# Regex patterns for legacy JSON code block extraction
# Used by both extract_json_blocks_legacy() and strip_legacy_json_blocks()

# Pattern 1: Standard ```json ... ``` format
LEGACY_JSON_BLOCK_PATTERN = r"```json\s*(.*?)\s*```"

# Pattern 2: ``` [...] ``` (JSON arrays without language tag)
LEGACY_ARRAY_BLOCK_PATTERN = r"```\s*(\[[\s\S]*?\])\s*```"

# Pattern 3: Missing opening backticks - "json\n[...]\n```"
LEGACY_MISSING_BACKTICKS_PATTERN = r"(?:^|\n)json\s*\n(\[[\s\S]*?\])\s*```"

# Strip variants (without capture groups, for removal)
LEGACY_JSON_BLOCK_STRIP_PATTERN = r"```json\s*.*?\s*```"
LEGACY_ARRAY_BLOCK_STRIP_PATTERN = r"```\s*\[[\s\S]*?\]\s*```"
LEGACY_MISSING_BACKTICKS_STRIP_PATTERN = r"(?:^|\n)json\s*\n\[[\s\S]*?\]\s*```"


def extract_tool_call_xml(text: str) -> Tuple[str, List[str], str]:
    """
    Extract tool calls from <tool_call>...</tool_call> tags.

    Args:
        text: Input text containing tool_call tags

    Returns:
        Tuple of (text_before, json_blocks, text_after)
        - text_before: Text before the first <tool_call> tag
        - json_blocks: List of JSON strings from inside tool_call tags
        - text_after: Text after the last </tool_call> tag
    """
    # Pattern to match <tool_call>...</tool_call>
    pattern = r"<tool_call>(.*?)</tool_call>"
    matches = list(re.finditer(pattern, text, re.DOTALL))

    if not matches:
        return text, [], ""

    # Get text before first match
    first_match = matches[0]
    text_before = text[: first_match.start()].strip()

    # Get text after last match
    last_match = matches[-1]
    text_after = text[last_match.end() :].strip()

    # Extract JSON content from all matches
    json_blocks = [m.group(1).strip() for m in matches]

    return text_before, json_blocks, text_after


def extract_json_blocks_legacy(text: str) -> List[str]:
    """
    Extract all JSON code blocks from text (legacy format).

    Supports multiple formats:
    - Standard: ```json ... ```
    - Missing opening backticks: json ... ``` (some models do this)
    - With or without "json" language tag

    Args:
        text: Input text containing JSON code blocks

    Returns:
        List of JSON strings (without the code block markers)
    """
    blocks = []

    # Pattern 1: Standard ```json ... ``` format
    blocks.extend(re.findall(LEGACY_JSON_BLOCK_PATTERN, text, re.DOTALL))

    # Pattern 2: ``` ... ``` without language tag
    for match in re.findall(LEGACY_ARRAY_BLOCK_PATTERN, text, re.DOTALL):
        if match not in blocks:
            blocks.append(match)

    # Pattern 3: Missing opening backticks - "json" followed by JSON array, ending with ```
    # This handles cases like: "json\n[...]\n```"
    for match in re.findall(LEGACY_MISSING_BACKTICKS_PATTERN, text, re.DOTALL):
        if match not in blocks:
            blocks.append(match)

    return blocks


def _parse_json_to_tool_calls(json_blocks: List[str]) -> List[Dict[str, Any]]:
    """
    Parse JSON blocks into tool call format.

    Args:
        json_blocks: List of JSON strings

    Returns:
        List of tool call dicts in the format:
        {
            "id": "call_xxx",
            "function": {
                "name": "tool_name",
                "arguments": '{"param1": "value1"}'
            }
        }
    """
    tool_calls = []

    for block in json_blocks:
        if not block.strip():
            continue

        try:
            # Use json_repair to handle common LLM JSON issues
            # (trailing commas, single quotes, unquoted keys, etc.)
            data = json_repair.loads(block)

            # Handle single object format (fallback for LLM not following list format)
            # e.g., {"tool": "done", "params": {}} instead of [{"tool": "done", "params": {}}]
            if isinstance(data, dict) and "tool" in data:
                tool_calls.append(
                    {
                        "id": f"call_{uuid.uuid4().hex[:8]}",
                        "function": {
                            "name": data["tool"],
                            "arguments": json.dumps(data.get("params", {})),
                        },
                    }
                )
            # Handle list format (expected)
            elif isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "tool" in item:
                        tool_calls.append(
                            {
                                "id": f"call_{uuid.uuid4().hex[:8]}",
                                "function": {
                                    "name": item["tool"],
                                    "arguments": json.dumps(item.get("params", {})),
                                },
                            }
                        )
        except Exception as e:
            # Log warning for blocks that can't be parsed
            logger.warning(
                f"Failed to parse tool call JSON: {e}, block: {block[:100]}..."
            )

    return tool_calls


def parse_tool_calls(content: str) -> Tuple[str, Optional[List[Dict[str, Any]]], str]:
    """
    Parse LLM output to extract text and tool calls.

    Supports two formats:
    1. Primary (new): <tool_call>[...]</tool_call>
    2. Legacy: ```json [...] ```

    The function returns a three-tuple:
    - text_before: User-visible text (before tool calls)
    - tool_calls: List of tool call dicts, or None if no tool calls
    - text_after: Text after tool calls (should be empty, logged as warning if not)

    Args:
        content: Raw LLM output

    Returns:
        Tuple of (text_before, tool_calls, text_after)

    Tool call format (compatible with existing _execute_tool_calls):
    {
        "id": "call_xxx",
        "function": {
            "name": "tool_name",
            "arguments": '{"param1": "value1"}'  # JSON string
        }
    }
    """
    # Try new format first: <tool_call>...</tool_call>
    text_before, json_blocks, text_after = extract_tool_call_xml(content)

    if json_blocks:
        # New format found
        tool_calls = _parse_json_to_tool_calls(json_blocks)

        # Log warning if there's text after </tool_call>
        if text_after:
            logger.warning(
                f"Text found after </tool_call> (will be ignored): {text_after[:100]}..."
            )

        return text_before, tool_calls if tool_calls else None, text_after

    # Fallback to legacy format: ```json ... ```
    json_blocks_legacy = extract_json_blocks_legacy(content)

    if json_blocks_legacy:
        tool_calls = _parse_json_to_tool_calls(json_blocks_legacy)

        # Remove JSON code blocks from content to get text
        text = strip_legacy_json_blocks(content)

        return text, tool_calls if tool_calls else None, ""

    # No tool calls found - entire content is user text
    return content.strip(), None, ""


def generate_tools_prompt(tools: List[Tool], mode: str = None) -> str:
    """
    Generate a prompt section describing available tools.

    Args:
        tools: List of Tool instances
        mode: Current mode ("ask" or "agent") for mode-aware tools like TaskTool

    Returns:
        Formatted string describing all tools for the System Prompt
    """
    if not tools:
        return ""

    lines = [
        "# Available Tools",
        "",
        "You have access to the following tools:",
        "",
    ]

    for tool in tools:
        # For TaskTool, update schema based on current mode
        if hasattr(tool, "_update_schema_for_mode") and mode:
            tool._update_schema_for_mode(mode)

        lines.append(f"## {tool.name}")
        lines.append(f"{tool.description}")
        lines.append("")

        # Add parameter descriptions
        if tool.parameters and "properties" in tool.parameters:
            lines.append("Parameters:")
            props = tool.parameters["properties"]
            required = tool.parameters.get("required", [])

            for param_name, param_info in props.items():
                param_type = param_info.get("type", "any")
                param_desc = param_info.get("description", "")
                is_required = param_name in required
                req_marker = "(required)" if is_required else "(optional)"

                lines.append(
                    f"- `{param_name}` ({param_type}, {req_marker}): {param_desc}"
                )

            lines.append("")

    return "\n".join(lines)


def generate_tool_calling_instructions() -> str:
    """
    Generate instructions for how to call tools.

    Returns:
        Formatted instruction string
    """
    return """# Tool Calling Format

Tool calls MUST be wrapped in `<tool_call>...</tool_call>` tags with a JSON list inside.

**Format:**
```
[Your message to user]

<tool_call>
[{"tool": "tool_name", "params": {"param1": "value1"}}]
</tool_call>
```

**Rules:**
1. Tool calls MUST be wrapped in `<tool_call>` tags
2. Tool calls MUST be a JSON list `[...]`, even for a single tool
3. Tools are executed **in order** (sequentially)
4. After calling tools, you will receive results as SYSTEM messages
5. Text before `<tool_call>` is shown to the user
6. Do NOT write anything after `</tool_call>` - your turn ends there
7. When the task is complete, call `done` tool to finish

**Example - Reading a file:**
```
Let me read the file to help you.

<tool_call>
[{"tool": "read_file", "params": {"file_path": "main.tex"}}]
</tool_call>
```

**Example - Multiple tools:**
```
I'll check the files and then read the main document.

<tool_call>
[
  {"tool": "list_files", "params": {}},
  {"tool": "read_file", "params": {"file_path": "main.tex"}}
]
</tool_call>
```

**Example - Task complete:**
```
I've completed the translation. The document now has all sections translated to Chinese.

<tool_call>
[{"tool": "done", "params": {}}]
</tool_call>
```
"""


def strip_legacy_json_blocks(text: str) -> str:
    """
    Strip legacy JSON code blocks from text.

    Removes:
    - Pattern 1: ```json ... ```
    - Pattern 2: ``` [...] ``` (JSON arrays)
    - Pattern 3: Missing opening backticks - "json\n[...]\n```"
    - Extra whitespace (3+ newlines -> 2)

    Args:
        text: Input text potentially containing JSON code blocks

    Returns:
        Cleaned text with JSON blocks removed
    """
    # Pattern 1: Standard ```json ... ```
    text = re.sub(LEGACY_JSON_BLOCK_STRIP_PATTERN, "", text, flags=re.DOTALL)
    # Pattern 2: ``` ... ``` (JSON arrays)
    text = re.sub(LEGACY_ARRAY_BLOCK_STRIP_PATTERN, "", text, flags=re.DOTALL)
    # Pattern 3: Missing opening backticks - "json\n[...]\n```"
    text = re.sub(LEGACY_MISSING_BACKTICKS_STRIP_PATTERN, "", text, flags=re.DOTALL)
    # Clean up extra whitespace
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def format_tool_result(tool_name: str, result_text: str, success: bool = True) -> str:
    """
    Format a tool result for inclusion in the conversation.

    Args:
        tool_name: Name of the tool that was executed
        result_text: The result text from the tool
        success: Whether the tool execution was successful

    Returns:
        Formatted result string
    """
    status = "Success" if success else "Error"
    return f"[Tool Result: {tool_name} - {status}]\n{result_text}"


__all__ = [
    "parse_tool_calls",
    "generate_tools_prompt",
    "generate_tool_calling_instructions",
    "format_tool_result",
    "strip_legacy_json_blocks",
]
