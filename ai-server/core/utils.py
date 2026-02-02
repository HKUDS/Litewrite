"""
Utilities
=========

Generic helper functions.

Usage:
    from core.utils import chunk_text, api_retry
"""

import re
from typing import List

import httpx
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

from core.config import config


# ============================================================================
# Retry decorators
# ============================================================================


def create_retry_decorator(
    max_attempts: int = None, min_wait: int = 2, max_wait: int = 10
):
    """
    Create a custom retry decorator.

    Args:
        max_attempts: Max attempts (defaults to config)
        min_wait: Min wait (seconds)
        max_wait: Max wait (seconds)

    Usage:
        @create_retry_decorator(max_attempts=5)
        async def my_api_call():
            ...
    """
    return retry(
        stop=stop_after_attempt(max_attempts or config.max_retries),
        wait=wait_exponential(multiplier=1, min=min_wait, max=max_wait),
        retry=retry_if_exception_type(
            (httpx.HTTPError, httpx.TimeoutException, Exception)
        ),
        reraise=True,
    )


# Default API retry decorator
api_retry = create_retry_decorator()


# ============================================================================
# Text processing
# ============================================================================


def chunk_text(
    text: str, chunk_size: int = 1000, overlap: int = 200, separators: List[str] = None
) -> List[str]:
    """
    Split text into chunks.

    Args:
        text: Input text
        chunk_size: Max characters per chunk
        overlap: Overlap characters between adjacent chunks
        separators: Separator list (tried in order)

    Returns:
        List[str]: list of chunks
    """
    if separators is None:
        separators = ["\n\n", "\n", ". ", " "]

    if len(text) <= chunk_size:
        return [text]

    chunks = []
    current_pos = 0

    while current_pos < len(text):
        # Compute end position for current chunk
        end_pos = min(current_pos + chunk_size, len(text))

        # If not last chunk, try splitting on a separator
        if end_pos < len(text):
            best_break = end_pos

            for sep in separators:
                # Find the last separator within the chunk window
                search_start = current_pos + chunk_size // 2  # keep at least half
                search_text = text[search_start:end_pos]
                last_sep = search_text.rfind(sep)

                if last_sep != -1:
                    best_break = search_start + last_sep + len(sep)
                    break

            end_pos = best_break

        chunk = text[current_pos:end_pos].strip()
        if chunk:
            chunks.append(chunk)

        # Next chunk start (consider overlap)
        current_pos = max(current_pos + 1, end_pos - overlap)

    return chunks


def truncate_text(text: str, max_length: int, suffix: str = "...") -> str:
    """
    Truncate text and append a suffix.

    Args:
        text: Input text
        max_length: Max length (including suffix)
        suffix: Suffix to append
    """
    if len(text) <= max_length:
        return text
    return text[: max_length - len(suffix)] + suffix


def clean_text(text: str) -> str:
    """
    Clean text (collapse whitespace, normalize newlines, etc.).
    """
    # Collapse spaces
    text = re.sub(r"[ \t]+", " ", text)
    # Collapse blank lines
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def extract_json_from_text(text: str) -> str:
    """
    Extract JSON string from text.

    Supports ```json ... ``` fenced blocks.
    """
    # Try JSON fenced block first
    json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if json_match:
        return json_match.group(1).strip()

    # Fall back to the first {...} block
    brace_match = re.search(r"\{[\s\S]*\}", text)
    if brace_match:
        return brace_match.group(0)

    return text


def parse_llm_json(text: str, default: dict = None) -> dict:
    """
    Parse JSON returned by an LLM using json_repair to fix common issues.

    Args:
        text: LLM output text (may include markdown code fences)
        default: Default value when parsing fails

    Returns:
        Parsed dict, or the default value
    """
    import json_repair

    if default is None:
        default = {
            "_parse_error": "Failed to parse JSON",
            "raw": text[:500] if text else "",
        }

    if not text:
        return default

    # Extract JSON string (possibly from markdown code fences)
    json_str = extract_json_from_text(text)

    try:
        return json_repair.loads(json_str)
    except Exception:
        return default


def normalize_whitespace(text: str) -> str:
    """Normalize whitespace."""
    return " ".join(text.split())


__all__ = [
    # Retry
    "create_retry_decorator",
    "api_retry",
    # Text processing
    "chunk_text",
    "truncate_text",
    "clean_text",
    "extract_json_from_text",
    "parse_llm_json",
    "normalize_whitespace",
]
