"""
Context Manager
===============

Manages context window limits and compression for the Agent.

Two types of context:
1. Session History (compressedHistory): Previous conversation, configurable limit
2. Execution Context: Current turn's tool calls and results, configurable limit

When either exceeds threshold, LLM summarization is triggered.

Configuration (via environment variables):
- CONTEXT_TOTAL_WINDOW: Total context window (default: 128000)
- CONTEXT_HISTORY_LIMIT: Session history limit (default: 64000)
- CONTEXT_EXECUTION_LIMIT: Execution context limit (default: 64000)
- CONTEXT_COMPRESSION_THRESHOLD: Compression threshold ratio (default: 0.95)
- CONTEXT_COMPRESSION_TARGET: Compression target ratio (default: 0.3)
"""

import logging
from typing import Tuple, List, Optional
import tiktoken

from core.llm import get_llm_client
from core.config import config

logger = logging.getLogger(__name__)


# ============================================================================
# Constants (read from config)
# ============================================================================

TOTAL_WINDOW = config.context_total_window  # Total context window
HISTORY_LIMIT = config.context_history_limit  # Session history limit
EXECUTION_LIMIT = config.context_execution_limit  # Execution context limit
COMPRESSION_THRESHOLD = config.context_compression_threshold  # Compression threshold

# Target compression ratio
COMPRESSION_TARGET_RATIO = config.context_compression_target

# Tiktoken encoding for token counting
# Using cl100k_base which is used by GPT-4, Claude, etc.
_encoding: Optional[tiktoken.Encoding] = None


def _get_encoding() -> tiktoken.Encoding:
    """Get or create tiktoken encoding (cached)."""
    global _encoding
    if _encoding is None:
        _encoding = tiktoken.get_encoding("cl100k_base")
    return _encoding


# ============================================================================
# Token Counting
# ============================================================================


def count_tokens(text: str) -> int:
    """
    Count tokens in text using tiktoken.

    Args:
        text: Text to count tokens for

    Returns:
        Number of tokens
    """
    if not text:
        return 0

    encoding = _get_encoding()
    return len(encoding.encode(text))


def should_compress_history(tokens: int) -> bool:
    """
    Check if history should be compressed.

    Args:
        tokens: Current token count

    Returns:
        True if compression is needed
    """
    threshold = int(HISTORY_LIMIT * COMPRESSION_THRESHOLD)
    return tokens > threshold


def should_compress_execution(tokens: int) -> bool:
    """
    Check if execution context should be compressed.

    Args:
        tokens: Current token count

    Returns:
        True if compression is needed
    """
    threshold = int(EXECUTION_LIMIT * COMPRESSION_THRESHOLD)
    return tokens > threshold


# ============================================================================
# Compression
# ============================================================================

HISTORY_COMPRESSION_PROMPT = """You are a conversation summarizer. Compress the following conversation history while preserving:
1. Key decisions and conclusions made
2. Important file references and paths mentioned
3. User's main requirements and goals
4. Actions already taken and their results
5. Any errors or issues encountered

**IMPORTANT**: Write the summary in the SAME LANGUAGE as the original conversation.
If the conversation is in Chinese, write the summary in Chinese. If in English, write in English.

Original conversation ({before_tokens} tokens):

{history}

Provide a concise summary that captures the essential context. Target length: {target_tokens} tokens max.
Format as a narrative summary, not as User:/Assistant: format."""

EXECUTION_COMPRESSION_PROMPT = """You are summarizing an agent's execution log. Compress the following execution history while preserving:
1. What tools were called and their key results
2. Files that were read or modified
3. Errors encountered
4. Progress made toward the goal

**IMPORTANT**: Write the summary in the SAME LANGUAGE as the original execution log.
If the log is in Chinese, write the summary in Chinese. If in English, write in English.

Execution log ({before_tokens} tokens):

{execution_log}

Provide a concise summary. Target length: {target_tokens} tokens max.
Format as a bullet-point summary of key actions and results."""


async def compress_history(
    history: str, user_id: Optional[str] = None, project_id: Optional[str] = None
) -> Tuple[str, int]:
    """
    Compress session history using LLM summarization.

    Args:
        history: Current history string (compressedHistory from session)
        user_id: Optional user identifier (attribution only)
        project_id: Optional project identifier (attribution only)

    Returns:
        Tuple of (compressed_history, new_token_count)
    """
    before_tokens = count_tokens(history)
    target_tokens = int(HISTORY_LIMIT * COMPRESSION_TARGET_RATIO)

    logger.info(
        f"[ContextManager] Compressing history: "
        f"{before_tokens} tokens -> target {target_tokens} tokens"
    )

    prompt = HISTORY_COMPRESSION_PROMPT.format(
        before_tokens=before_tokens,
        history=history,
        target_tokens=target_tokens,
    )

    try:
        client = get_llm_client()
        response = await client.chat.completions.create(
            model=config.llm_model,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that summarizes conversations.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,  # Lower temperature for more consistent summaries
            max_tokens=target_tokens + 500,  # Some buffer
        )

        compressed = response.choices[0].message.content or ""
        after_tokens = count_tokens(compressed)

        logger.info(
            f"[ContextManager] History compressed: "
            f"{before_tokens} -> {after_tokens} tokens "
            f"({100 * after_tokens / before_tokens:.1f}%)"
        )

        return compressed, after_tokens

    except Exception as e:
        logger.error(f"[ContextManager] History compression failed: {e}")
        # On failure, return original (will try again next time)
        return history, before_tokens


async def compress_execution_log(
    execution_logs: List[str],
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Tuple[str, int]:
    """
    Compress execution context using LLM summarization.

    Args:
        execution_logs: List of execution log strings
        user_id: Optional user identifier (attribution only)
        project_id: Optional project identifier (attribution only)

    Returns:
        Tuple of (compressed_log, new_token_count)
    """
    combined = "\n\n".join(execution_logs)
    before_tokens = count_tokens(combined)
    target_tokens = int(EXECUTION_LIMIT * COMPRESSION_TARGET_RATIO)

    logger.info(
        f"[ContextManager] Compressing execution log: "
        f"{before_tokens} tokens -> target {target_tokens} tokens"
    )

    prompt = EXECUTION_COMPRESSION_PROMPT.format(
        before_tokens=before_tokens,
        execution_log=combined,
        target_tokens=target_tokens,
    )

    try:
        client = get_llm_client()
        response = await client.chat.completions.create(
            model=config.llm_model,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that summarizes execution logs.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=target_tokens + 500,
        )

        compressed = response.choices[0].message.content or ""
        after_tokens = count_tokens(compressed)

        logger.info(
            f"[ContextManager] Execution log compressed: "
            f"{before_tokens} -> {after_tokens} tokens "
            f"({100 * after_tokens / before_tokens:.1f}%)"
        )

        return compressed, after_tokens

    except Exception as e:
        logger.error(f"[ContextManager] Execution log compression failed: {e}")
        # On failure, return original
        return combined, before_tokens


# ============================================================================
# Utility Functions
# ============================================================================


def get_history_usage(tokens: int) -> dict:
    """
    Get history usage statistics.

    Args:
        tokens: Current token count

    Returns:
        Dict with usage info
    """
    return {
        "historyTokens": tokens,
        "historyLimit": HISTORY_LIMIT,
        "historyUsagePercent": round(100 * tokens / HISTORY_LIMIT, 1),
    }


def get_execution_usage(tokens: int) -> dict:
    """
    Get execution context usage statistics.

    Args:
        tokens: Current token count

    Returns:
        Dict with usage info
    """
    return {
        "executionTokens": tokens,
        "executionLimit": EXECUTION_LIMIT,
        "executionUsagePercent": round(100 * tokens / EXECUTION_LIMIT, 1),
    }


__all__ = [
    "TOTAL_WINDOW",
    "HISTORY_LIMIT",
    "EXECUTION_LIMIT",
    "COMPRESSION_THRESHOLD",
    "count_tokens",
    "should_compress_history",
    "should_compress_execution",
    "compress_history",
    "compress_execution_log",
    "get_history_usage",
    "get_execution_usage",
]
