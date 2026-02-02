"""
TAP Service - LaTeX completion
=============================

If you're working on the algorithm, the core contract is:
1. Input:  prefix, suffix
2. Output: action, confidence, inserted_text, corrections

All post-processing (boundary fix, diff computation) is deterministic and
should not affect the model logic.

Model output schema:
{
  "action": "insert" | "complete_word" | "fix" | "skip",
  "confidence": 0.0-1.0,
  "inserted_text": "text to insert",
  "corrections": [
    {"search": "wrong text", "replace": "correct text", "location": "prefix|suffix"}
  ]
}
"""

import json
import difflib
import logging
from typing import Dict, Any, List, Tuple, Optional
from dataclasses import dataclass

from core import TAP_MODEL, TAP_API_KEY
from core.llm import get_llm_client, create_llm_client_with_key

# Logger
logger = logging.getLogger("tap")


# ============================================================================
# Data models
# ============================================================================


@dataclass
class TAPRequest:
    """TAP request."""

    prefix: str
    suffix: str
    preamble: str = ""


@dataclass
class DiffItem:
    """Diff item."""

    op: str  # "equal", "replace", "insert", "delete"
    text: str = ""
    original: str = ""
    revised: str = ""

    def to_dict(self) -> dict:
        result = {"op": self.op}
        if self.op == "equal":
            result["text"] = self.text
        elif self.op == "replace":
            result["original"] = self.original
            result["revised"] = self.revised
        elif self.op == "insert":
            result["revised"] = self.revised
        elif self.op == "delete":
            result["original"] = self.original
        return result


@dataclass
class ProposedChanges:
    """Proposed changes."""

    prefix_diff: List[Dict[str, Any]]
    inserted_text: str
    suffix_diff: List[Dict[str, Any]]


@dataclass
class TAPUsage:
    """TAP usage info."""

    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    api_cost: float = 0.0


@dataclass
class TAPResponse:
    """TAP response."""

    should_complete: bool
    confidence: float
    latency_ms: float
    proposed_changes: Optional[ProposedChanges] = None
    reason: Optional[str] = None
    usage: Optional[TAPUsage] = None

    def to_dict(self) -> dict:
        result = {
            "should_complete": self.should_complete,
            "confidence": self.confidence,
            "latency_ms": self.latency_ms,
        }
        if self.proposed_changes:
            result["proposed_changes"] = {
                "prefix_diff": self.proposed_changes.prefix_diff,
                "inserted_text": self.proposed_changes.inserted_text,
                "suffix_diff": self.proposed_changes.suffix_diff,
            }
        if self.usage:
            result["usage"] = {
                "model": self.usage.model,
                "input_tokens": self.usage.input_tokens,
                "output_tokens": self.usage.output_tokens,
                "total_tokens": self.usage.total_tokens,
                "api_cost": self.usage.api_cost,
            }
        if self.reason:
            result["reason"] = self.reason
        return result


# ============================================================================
# Config
# ============================================================================

# Context length limits
PREFIX_MAX_CHARS = 500
PREFIX_MIN_CHARS = 100
SUFFIX_MAX_CHARS = 300
SUFFIX_MIN_CHARS = 50
MODEL_PREFIX_CHARS = 300
MODEL_SUFFIX_CHARS = 150


# ============================================================================
# TAP Service
# ============================================================================


class TAPService:
    """
    TAP completion service.

    Features:
    - Smart boundary extraction
    - Scenario detection (word completion, sentence continuation)
    - LLM completion
    - Boundary fixes
    - Diff computation

    Usage:
        service = TAPService()
        response = service.complete(TAPRequest(prefix="...", suffix="..."))
    """

    def __init__(
        self,
        model: str = None,
        verbose: bool = False,
        user_id: str = None,
        project_id: str = None,
    ):
        """
        Args:
            model: LLM model name (defaults to TAP_MODEL)
            verbose: Enable verbose logging
            user_id: Optional user identifier (attribution only)
            project_id: Optional project identifier (attribution only)
        """
        self.model = model or TAP_MODEL
        # If TAP_API_KEY is configured, use it; otherwise fall back to the default client.
        if TAP_API_KEY:
            self.client = create_llm_client_with_key(TAP_API_KEY)
        else:
            self.client = get_llm_client()
        self.verbose = verbose
        self.user_id = user_id
        self.project_id = project_id

        # Configure log level
        if verbose:
            logger.setLevel(logging.DEBUG)
        else:
            logger.setLevel(logging.INFO)

    # ==================== Smart boundary extraction ====================

    def _smart_extract_prefix(self, raw_prefix: str) -> Tuple[str, int]:
        """Extract a reasonable prefix window."""
        if len(raw_prefix) <= PREFIX_MAX_CHARS:
            return raw_prefix, 0

        search_start = len(raw_prefix) - PREFIX_MAX_CHARS
        search_region = raw_prefix[
            search_start : search_start + PREFIX_MAX_CHARS - PREFIX_MIN_CHARS
        ]

        best_cut = search_start

        # Strategy 1: paragraph boundary
        para_pos = search_region.rfind("\n\n")
        if para_pos != -1:
            best_cut = search_start + para_pos + 2
        else:
            # Strategy 2: sentence boundary
            for pattern in [". ", ".\n", "? ", "?\n", "! ", "!\n"]:
                sent_pos = search_region.rfind(pattern)
                if sent_pos != -1:
                    best_cut = search_start + sent_pos + len(pattern)
                    break

        # Strategy 3: LaTeX section boundary
        if best_cut == search_start:
            for cmd in ["\\section{", "\\subsection{", "\\subsubsection{"]:
                sec_pos = search_region.rfind(cmd)
                if sec_pos != -1:
                    best_cut = search_start + sec_pos
                    break

        # Strategy 4: whitespace boundary
        if best_cut == search_start:
            space_pos = search_region.rfind(" ")
            if space_pos != -1:
                best_cut = search_start + space_pos + 1

        return raw_prefix[best_cut:], best_cut

    def _smart_extract_suffix(self, raw_suffix: str) -> Tuple[str, int]:
        """Extract a reasonable suffix window."""
        if len(raw_suffix) <= SUFFIX_MAX_CHARS:
            return raw_suffix, len(raw_suffix)

        search_region = raw_suffix[SUFFIX_MIN_CHARS:SUFFIX_MAX_CHARS]
        best_end = SUFFIX_MAX_CHARS

        # Strategy 1: paragraph boundary
        para_pos = search_region.find("\n\n")
        if para_pos != -1:
            best_end = SUFFIX_MIN_CHARS + para_pos
        else:
            # Strategy 2: sentence boundary
            for pattern in [". ", ".\n", "? ", "?\n"]:
                sent_pos = search_region.find(pattern)
                if sent_pos != -1:
                    best_end = SUFFIX_MIN_CHARS + sent_pos + 1
                    break

        return raw_suffix[:best_end], best_end

    # ==================== Scenario detection ====================

    def _extract_word_context(
        self, text: str, from_start: bool = True
    ) -> Tuple[str, str]:
        """
        Extract word context, including hyphenated compound words.

        Args:
            text: Text to inspect
            from_start: True to extract from start, False from end

        Returns:
            (simple_word, extended_word)
            - simple_word: Alphanumeric-only word part
            - extended_word: Extended context including '-' (e.g. real-world)
        """
        if not text:
            return "", ""

        if from_start:
            # Extract from start (suffix side)
            simple_word = ""
            for c in text:
                if c.isalnum():
                    simple_word += c
                else:
                    break

            extended_word = ""
            for c in text:
                if c.isalnum() or c == "-":
                    extended_word += c
                else:
                    break
        else:
            # Extract from end (prefix side)
            simple_word = ""
            for c in reversed(text):
                if c.isalnum():
                    simple_word = c + simple_word
                else:
                    break

            extended_word = ""
            for c in reversed(text):
                if c.isalnum() or c == "-":
                    extended_word = c + extended_word
                else:
                    break

        return simple_word, extended_word

    def _detect_context(self, prefix: str, suffix: str) -> Dict[str, Any]:
        """Detect completion scenario."""
        context = {
            "scenario": "normal",
            "partial_word_before": None,
            "partial_word_after": None,
            "extended_word_before": None,  # Extended context including '-'
            "extended_word_after": None,
            "hint": None,
        }

        # Detect whether the cursor is inside a word
        if prefix and suffix:
            if prefix[-1].isalpha() and suffix[0].isalpha():
                partial_before, extended_before = self._extract_word_context(
                    prefix, from_start=False
                )
                partial_after, extended_after = self._extract_word_context(
                    suffix, from_start=True
                )

                context["scenario"] = "word_correction"
                context["partial_word_before"] = partial_before
                context["partial_word_after"] = partial_after
                context["extended_word_before"] = extended_before
                context["extended_word_after"] = extended_after

                # If this is a compound word (contains '-'), provide richer context
                if extended_before != partial_before or extended_after != partial_after:
                    full_word = f"{extended_before}|{extended_after}"
                    context["hint"] = (
                        f"Cursor in compound word: '{full_word}' (simple: '{partial_before}|{partial_after}')"
                    )
                else:
                    context["hint"] = (
                        f"Cursor is in middle of word: '{partial_before}|{partial_after}'"
                    )

                return context

        # Detect incomplete word (word completion)
        if prefix:
            partial_word = ""
            for c in reversed(prefix):
                if c.isalnum() or c == "_":
                    partial_word = c + partial_word
                else:
                    break

            if partial_word and len(partial_word) <= 5:
                common_words = {
                    "a",
                    "an",
                    "the",
                    "is",
                    "it",
                    "in",
                    "on",
                    "to",
                    "of",
                    "as",
                    "at",
                    "by",
                    "or",
                    "be",
                    "we",
                }
                if partial_word.lower() not in common_words:
                    context["scenario"] = "word_completion"
                    context["partial_word_before"] = partial_word
                    context["hint"] = f"Completing word: '{partial_word}'"

        # Detect sentence continuation
        if context["scenario"] == "normal":
            if not suffix or suffix.strip() == "" or suffix.startswith("\n"):
                if prefix and prefix.rstrip() and prefix.rstrip()[-1] not in ".!?":
                    context["scenario"] = "sentence_continuation"
                    context["hint"] = "Sentence continuation"

        return context

    def _should_attempt_completion(self, prefix: str, suffix: str) -> Tuple[bool, str]:
        """Fast local pre-check before calling the LLM."""
        if len(prefix.strip()) < 2:
            return False, "prefix_too_short"

        # User is typing a LaTeX command
        last_backslash = prefix.rfind("\\")
        if last_backslash != -1:
            after_backslash = prefix[last_backslash + 1 :]
            if after_backslash.isalpha() and len(after_backslash) <= 2:
                return False, "latex_command_typing"

        return True, "ok"

    def _check_suspicious_insertion(
        self, inserted_text: str, failed_corrections: List[Dict]
    ) -> Optional[str]:
        """
        Check whether the insertion looks suspicious.

        When corrections fail, inserted_text may be a leftover fragment from
        a mistaken correction attempt.

        Common failure patterns:
        1. LLM tries to change "medium" -> "mediums", returns inserted_text="s."
        2. LLM tries to fix a word, but the correction location is wrong, leaving a fragment

        Returns:
            A reason string if suspicious, otherwise None.
        """
        if not inserted_text:
            return None

        clean_text = inserted_text.strip()

        # Check for fragment insertions (likely leftovers after failed corrections)
        # e.g. 's.' 's' 'ed' 'ing', etc.
        fragment_patterns = ["s.", "s", "ed", "ing", "ly", "er", "est", "tion", "ness"]
        if clean_text.lower() in fragment_patterns:
            # Check whether a correction attempted to add a suffix
            for corr in failed_corrections:
                search = corr.get("search", "")
                replace = corr.get("replace", "")
                # If replace == search + suffix, and the suffix matches inserted_text
                if search and replace and replace.startswith(search):
                    suffix_added = replace[len(search) :]
                    if (
                        clean_text.rstrip(".") in suffix_added
                        or suffix_added in clean_text
                    ):
                        return f"fragment '{clean_text}' appears to be leftover from failed correction '{search}' -> '{replace}'"

        # Check if the insertion is too short / unlikely to be meaningful
        if len(clean_text) <= 3 and not clean_text.isalpha():
            # Short non-alphabetic fragments are often mistakes (e.g. 's.' 'a.')
            if "." in clean_text or "," in clean_text:
                return (
                    f"short fragment '{clean_text}' with punctuation, likely a mistake"
                )

        return None

    def _check_duplicate_insertion(
        self, inserted_text: str, suffix: str, context: Dict[str, Any]
    ) -> Tuple[bool, str]:
        """
        Check whether an insertion duplicates or breaks an existing word.

        When the cursor is inside a word, the LLM may return an insertion that
        matches the beginning of suffix, causing duplication (e.g.
        'lear' + 'ning' + 'ning that...' -> 'learning ning that...').

        Returns:
            (is_duplicate, reason)
        """
        if not inserted_text or not suffix:
            return False, ""

        inserted_clean = inserted_text.strip()

        # Scenario: cursor is inside a word
        if context.get("scenario") == "word_correction":
            partial_before = context.get("partial_word_before", "")
            partial_after = context.get("partial_word_after", "")
            extended_before = context.get("extended_word_before", partial_before)
            extended_after = context.get("extended_word_after", partial_after)

            # Check whether inserted_text duplicates the beginning of suffix
            # Case 1: inserted_text equals partial_after (most common failure)
            if inserted_clean == partial_after:
                return (
                    True,
                    f"duplicate_with_suffix: '{inserted_clean}' == '{partial_after}'",
                )

            # Case 2: inserted_text starts with partial_after
            if inserted_clean.startswith(partial_after):
                return (
                    True,
                    f"duplicate_prefix: '{inserted_clean}' starts with '{partial_after}'",
                )

            # Case 3: suffix starts with inserted_text
            if suffix.startswith(inserted_clean):
                return (
                    True,
                    f"suffix_starts_with_insertion: suffix starts with '{inserted_clean}'",
                )

            # Case 4: compound word detection
            # e.g. inserting 'o' into 'real-w|rld' yields 'real-wo rld' (wrong)
            # Condition: extended_before contains '-' (indicates a compound word)
            if "-" in extended_before:
                # This is a compound word scenario
                # Check whether inserted_text + partial_after forms a common word.
                # If so, the LLM likely misinterpreted the second half of a compound word.
                combined_word = inserted_clean + partial_after

                # Common words the LLM may try to form (false positives)
                common_words = {
                    "world",
                    "time",
                    "life",
                    "work",
                    "level",
                    "based",
                    "scale",
                    "wide",
                    "long",
                    "term",
                    "class",
                    "size",
                    "type",
                    "free",
                }

                if combined_word.lower() in common_words:
                    # The LLM tries to turn 'w' + 'rld' into 'world', but the text is 'real-world'
                    return (
                        True,
                        f"compound_word_protected: '{extended_before}{extended_after}' should not be split into '{combined_word}'",
                    )

        return False, ""

    # ==================== Prompt ====================

    def _build_prompt(self, prefix: str, suffix: str, context: Dict[str, Any]) -> list:
        """Build the LLM prompt."""
        ctx_prefix = (
            prefix[-MODEL_PREFIX_CHARS:] if len(prefix) > MODEL_PREFIX_CHARS else prefix
        )
        ctx_suffix = (
            suffix[:MODEL_SUFFIX_CHARS] if len(suffix) > MODEL_SUFFIX_CHARS else suffix
        )

        system_prompt = """You are a smart LaTeX/academic writing assistant. The cursor is marked with <|CURSOR|>.

## OUTPUT FORMAT (JSON)
```json
{
  "action": "insert" | "complete_word" | "fix" | "skip",
  "confidence": 0.0-1.0,
  "inserted_text": "text to insert at cursor position",
  "corrections": [
    {"search": "wrong text", "replace": "correct text", "location": "prefix|suffix"}
  ]
}
```

## ACTION TYPES

### "insert" - Add new content at cursor
For normal completion when preceding text is grammatically complete.

### "complete_word" - Complete an incomplete word
When prefix ends with a partial word (e.g., "De" → "DeepCode", "algo" → "algorithm").
Insert only the remaining characters.

### "fix" - Fix errors WITHOUT inserting new content
Use when you spot grammar/spelling errors but don't need to add new text.
Only populate the "corrections" array.

### "skip" - No action needed
When text is complete or no good completion exists.

## THE "corrections" FIELD (IMPORTANT!)

This is for **incremental fixes** - you only specify what to search and replace.
DO NOT output the entire prefix/suffix! Just the small parts that need fixing.

Each correction is: {"search": "...", "replace": "...", "location": "prefix|suffix"}

Examples of corrections:
- {"search": "teh", "replace": "the", "location": "prefix"}
- {"search": "achive", "replace": "achieve", "location": "prefix"}
- {"search": "reuslt", "replace": "result", "location": "suffix"}

Rules for corrections:
1. Keep "search" short (usually 1 word or a few characters)
2. "search" must EXACTLY match text in prefix/suffix
3. Only fix clear errors, don't rewrite style
4. Maximum 3 corrections per request

## SPACING RULES
- Always include proper spacing in inserted_text: " word" not "word"
- Exception: when completing a word, no leading space needed (e.g., "De" + "epCode")

## EXAMPLES

**Example 1: Normal insertion**
Input: "The results show<|CURSOR|> in Table 1"
Output: {"action": "insert", "confidence": 0.85, "inserted_text": " significant improvements", "corrections": []}

**Example 2: Word completion**
Input: "...we propose De<|CURSOR|>"
[Context: incomplete word "De"]
Output: {"action": "complete_word", "confidence": 0.9, "inserted_text": "epCode", "corrections": []}

**Example 3: Insert + fix typo**
Input: "Teh experiment shows<|CURSOR|>"
Output: {"action": "insert", "confidence": 0.85, "inserted_text": " promising results.", "corrections": [{"search": "Teh", "replace": "The", "location": "prefix"}]}

**Example 4: Just fix, no insert**
Input: "The reuslt is shown in<|CURSOR|> Figure 1."
Output: {"action": "fix", "confidence": 0.9, "inserted_text": "", "corrections": [{"search": "reuslt", "replace": "result", "location": "prefix"}]}

**Example 5: Fix in suffix**
Input: "We analyze<|CURSOR|> teh data carefully."
Output: {"action": "insert", "confidence": 0.8, "inserted_text": " and process", "corrections": [{"search": "teh", "replace": "the", "location": "suffix"}]}

**Example 6: Skip - sentence complete**
Input: "The experiment was successful.<|CURSOR|>"
Output: {"action": "skip", "confidence": 0.2, "inserted_text": "", "corrections": []}"""

        user_content = f"{ctx_prefix}<|CURSOR|>{ctx_suffix}"
        if context.get("hint"):
            user_content += f"\n\n[Context: {context['hint']}]"

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

    # ==================== Post-processing ====================

    def _fix_boundaries(
        self, prefix: str, insert: str, suffix: str, action: str
    ) -> Tuple[str, str, str]:
        """Fix insertion boundaries."""
        if not insert:
            return prefix, insert, suffix

        is_word_completion = action == "complete_word"

        # Fix prefix/insert boundary
        if prefix and insert:
            prefix_ends_space = prefix[-1] in " \t\n"
            insert_starts_space = insert[0] in " \t\n"
            prefix_ends_alnum = prefix[-1].isalnum()
            insert_starts_alnum = insert[0].isalnum()

            if prefix_ends_alnum and insert_starts_alnum:
                if not prefix_ends_space and not insert_starts_space:
                    if not is_word_completion:
                        insert = " " + insert

            if prefix_ends_space and insert_starts_space:
                insert = insert.lstrip(" ")

            if is_word_completion and insert and insert[0] == " ":
                insert = insert.lstrip(" ")

        # Fix insert/suffix boundary
        if insert and suffix:
            insert_ends_space = insert[-1] in " \t\n"
            suffix_starts_space = suffix[0] in " \t\n"
            insert_ends_alnum = insert[-1].isalnum()
            suffix_starts_alnum = suffix[0].isalnum()

            if insert_ends_alnum and suffix_starts_alnum:
                if not insert_ends_space and not suffix_starts_space:
                    insert = insert + " "

            if insert_ends_space and suffix_starts_space:
                insert = insert.rstrip(" ")

        return prefix, insert, suffix

    def _calculate_diff(self, original: str, revised: str) -> List[Dict[str, Any]]:
        """Compute diff."""
        if original == revised:
            return [{"op": "equal", "text": original}]

        differ = difflib.SequenceMatcher(None, original, revised)
        diff_list = []

        for opcode, a_start, a_end, b_start, b_end in differ.get_opcodes():
            segment = {"op": opcode}

            if opcode == "equal":
                segment["text"] = original[a_start:a_end]
            elif opcode == "replace":
                segment["original"] = original[a_start:a_end]
                segment["revised"] = revised[b_start:b_end]
            elif opcode == "insert":
                segment["revised"] = revised[b_start:b_end]
            elif opcode == "delete":
                segment["original"] = original[a_start:a_end]

            diff_list.append(segment)

        return diff_list

    # ==================== Main entry ====================

    async def complete(self, request: TAPRequest) -> TAPResponse:
        """
        Execute a completion request.

        Args:
            request: TAPRequest instance

        Returns:
            TAPResponse instance
        """
        import time

        start_time = time.time()

        logger.info("=" * 80)
        logger.info("TAP Completion Request")
        logger.info("=" * 80)
        logger.info(
            f"Input Length - Prefix: {len(request.prefix)}, Suffix: {len(request.suffix)}"
        )
        logger.info(
            f"Prefix (last 100 chars): ...{request.prefix[-100:] if len(request.prefix) > 100 else request.prefix}"
        )
        logger.info(
            f"Suffix (first 100 chars): {request.suffix[:100] if len(request.suffix) > 100 else request.suffix}..."
        )

        # 1) Smart boundary extraction
        extracted_prefix, prefix_cut = self._smart_extract_prefix(request.prefix)
        extracted_suffix, suffix_cut = self._smart_extract_suffix(request.suffix)

        logger.info("-" * 80)
        logger.info("Step 1: Smart Boundary Extraction")
        logger.info(
            f"Prefix: {len(request.prefix)} -> {len(extracted_prefix)} chars (cut from pos {prefix_cut})"
        )
        logger.info(
            f"Suffix: {len(request.suffix)} -> {len(extracted_suffix)} chars (kept first {suffix_cut} chars)"
        )
        logger.debug(
            f"Extracted prefix (last 50): ...{extracted_prefix[-50:] if len(extracted_prefix) > 50 else extracted_prefix}"
        )
        logger.debug(
            f"Extracted suffix (first 50): {extracted_suffix[:50] if len(extracted_suffix) > 50 else extracted_suffix}..."
        )

        # 2) Local pre-check
        should_complete, reason = self._should_attempt_completion(
            extracted_prefix, extracted_suffix
        )
        logger.info("-" * 80)
        logger.info("Step 2: Pre-check")
        logger.info(f"Should attempt completion: {should_complete} (reason: {reason})")

        if not should_complete:
            logger.warning(f"Skipping completion due to: {reason}")
            logger.info("=" * 80)
            return TAPResponse(
                should_complete=False,
                confidence=0.0,
                latency_ms=(time.time() - start_time) * 1000,
                reason=reason,
            )

        # 3) Scenario detection
        context = self._detect_context(extracted_prefix, extracted_suffix)
        logger.info("-" * 80)
        logger.info("Step 3: Context Detection")
        logger.info(f"Scenario: {context['scenario']}")
        if context.get("hint"):
            logger.info(f"Hint: {context['hint']}")
        if context.get("partial_word_before"):
            logger.info(f"Partial word before: '{context['partial_word_before']}'")
        if context.get("partial_word_after"):
            logger.info(f"Partial word after: '{context['partial_word_after']}'")

        # 4) Call LLM
        messages = self._build_prompt(extracted_prefix, extracted_suffix, context)

        logger.info("-" * 80)
        logger.info("Step 4: LLM Call")
        logger.info(f"Model: {self.model}")
        logger.debug(
            f"System prompt (first 200 chars): {messages[0]['content'][:200]}..."
        )
        logger.debug(
            f"User content (first 300 chars): {messages[1]['content'][:300]}..."
        )

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=300,
                temperature=0.2,
                response_format={"type": "json_object"},
            )

            # Extract usage information from OpenRouter response
            usage_info = TAPUsage(
                model=response.model if hasattr(response, "model") else self.model
            )
            if hasattr(response, "usage") and response.usage:
                usage_info.input_tokens = (
                    getattr(response.usage, "prompt_tokens", 0) or 0
                )
                usage_info.output_tokens = (
                    getattr(response.usage, "completion_tokens", 0) or 0
                )
                usage_info.total_tokens = (
                    getattr(response.usage, "total_tokens", 0) or 0
                )
                # Use actual cost from OpenRouter (not estimated)
                usage_info.api_cost = getattr(response.usage, "cost", 0) or 0

            raw_output = response.choices[0].message.content
            logger.debug(f"Raw LLM output: {raw_output}")
            logger.info(
                f"Usage: {usage_info.input_tokens} input + {usage_info.output_tokens} output tokens, cost=${usage_info.api_cost:.6f}"
            )

            output = json.loads(raw_output)

            action = output.get("action", "insert")
            confidence = output.get("confidence", 0.5)
            inserted_text = output.get("inserted_text", "")
            corrections = output.get("corrections", [])

            logger.info("LLM Response:")
            logger.info(f"  - Action: {action}")
            logger.info(f"  - Confidence: {confidence:.2f}")
            logger.info(f"  - Inserted text: '{inserted_text}'")
            logger.info(f"  - Corrections: {len(corrections)} item(s)")
            if corrections:
                for i, corr in enumerate(corrections):
                    logger.info(
                        f"    [{i+1}] {corr.get('location', 'unknown')}: '{corr.get('search', '')}' -> '{corr.get('replace', '')}'"
                    )

            # 5) Decide whether to complete
            logger.info("-" * 80)
            logger.info("Step 5: Decision Making")

            if action == "skip" or confidence < 0.3:
                reason = "model_skipped" if action == "skip" else "low_confidence"
                logger.warning(f"Skipping completion: {reason}")
                logger.info("=" * 80)
                return TAPResponse(
                    should_complete=False,
                    confidence=confidence,
                    latency_ms=(time.time() - start_time) * 1000,
                    reason=reason,
                    usage=usage_info,
                )

            if action == "fix" and not corrections:
                logger.warning(
                    "Skipping completion: fix action but no corrections provided"
                )
                logger.info("=" * 80)
                return TAPResponse(
                    should_complete=False,
                    confidence=confidence,
                    latency_ms=(time.time() - start_time) * 1000,
                    reason="no_corrections",
                    usage=usage_info,
                )

            # Check whether completion would introduce duplication
            is_duplicate, dup_reason = self._check_duplicate_insertion(
                inserted_text, extracted_suffix, context
            )
            if is_duplicate:
                logger.warning(
                    f"Skipping completion: duplicate insertion detected - {dup_reason}"
                )
                logger.info("=" * 80)
                return TAPResponse(
                    should_complete=False,
                    confidence=confidence,
                    latency_ms=(time.time() - start_time) * 1000,
                    reason=f"duplicate_insertion: {dup_reason}",
                    usage=usage_info,
                )

            if action != "fix" and not inserted_text and not corrections:
                logger.warning(
                    "Skipping completion: no inserted text and no corrections"
                )
                logger.info("=" * 80)
                return TAPResponse(
                    should_complete=False,
                    confidence=confidence,
                    latency_ms=(time.time() - start_time) * 1000,
                    reason="empty_changes",
                    usage=usage_info,
                )

            logger.info("Decision: Proceeding with completion")

            # 6) Apply corrections
            logger.info("-" * 80)
            logger.info("Step 6: Applying Corrections")

            final_prefix = extracted_prefix
            final_suffix = extracted_suffix
            corrections_applied = 0

            for i, corr in enumerate(corrections):
                search = corr.get("search", "")
                replace = corr.get("replace", "")
                location = corr.get("location", "prefix")

                if not search:
                    logger.debug(f"  Correction [{i+1}]: skipped (empty search)")
                    continue

                if location == "prefix" and search in final_prefix:
                    final_prefix = final_prefix.replace(search, replace, 1)
                    logger.info(f"  ✓ Applied to prefix: '{search}' -> '{replace}'")
                    corrections_applied += 1
                elif location == "suffix" and search in final_suffix:
                    final_suffix = final_suffix.replace(search, replace, 1)
                    logger.info(f"  ✓ Applied to suffix: '{search}' -> '{replace}'")
                    corrections_applied += 1
                else:
                    logger.warning(f"  ✗ Not found in {location}: '{search}'")

            logger.info(
                f"Total corrections applied: {corrections_applied}/{len(corrections)}"
            )

            # 6.5) Validation: if corrections fail and insertion looks suspicious, skip
            if corrections and corrections_applied == 0:
                # All corrections failed; verify the insertion is still reasonable
                suspicious_insertions = self._check_suspicious_insertion(
                    inserted_text, corrections
                )
                if suspicious_insertions:
                    logger.warning(
                        f"Skipping completion: corrections failed and insertion looks suspicious - {suspicious_insertions}"
                    )
                    logger.info("=" * 80)
                    return TAPResponse(
                        should_complete=False,
                        confidence=confidence,
                        latency_ms=(time.time() - start_time) * 1000,
                        reason=f"suspicious_insertion: {suspicious_insertions}",
                        usage=usage_info,
                    )

            # 7) Boundary fix
            logger.info("-" * 80)
            logger.info("Step 7: Boundary Fixing")
            logger.debug("Before boundary fix:")
            logger.debug(f"  Inserted text: '{inserted_text}'")

            final_prefix, inserted_text, final_suffix = self._fix_boundaries(
                final_prefix, inserted_text, final_suffix, action
            )

            logger.info("After boundary fix:")
            logger.info(f"  Inserted text: '{inserted_text}'")

            # 8) Compute diff
            logger.info("-" * 80)
            logger.info("Step 8: Calculating Diff")

            prefix_diff = self._calculate_diff(extracted_prefix, final_prefix)
            suffix_diff = self._calculate_diff(extracted_suffix, final_suffix)

            logger.debug(f"Prefix diff: {len(prefix_diff)} operations")
            for d in prefix_diff:
                if d.get("op") != "equal":
                    logger.debug(f"  {d}")

            logger.debug(f"Suffix diff: {len(suffix_diff)} operations")
            for d in suffix_diff:
                if d.get("op") != "equal":
                    logger.debug(f"  {d}")

            # 9) Ensure there are actual changes
            logger.info("-" * 80)
            logger.info("Step 9: Validation")

            has_prefix_changes = any(d.get("op") != "equal" for d in prefix_diff)
            has_suffix_changes = any(d.get("op") != "equal" for d in suffix_diff)
            has_insertion = bool(inserted_text)

            logger.info("Changes detected:")
            logger.info(f"  - Prefix changes: {has_prefix_changes}")
            logger.info(f"  - Suffix changes: {has_suffix_changes}")
            logger.info(f"  - Has insertion: {has_insertion}")

            if not has_prefix_changes and not has_suffix_changes and not has_insertion:
                logger.warning("No actual changes detected after processing")
                logger.info("=" * 80)
                return TAPResponse(
                    should_complete=False,
                    confidence=confidence,
                    latency_ms=(time.time() - start_time) * 1000,
                    reason="no_actual_changes",
                    usage=usage_info,
                )

            latency_ms = (time.time() - start_time) * 1000
            logger.info("-" * 80)
            logger.info("✅ SUCCESS")
            logger.info(f"Latency: {latency_ms:.2f}ms")
            logger.info(f"Confidence: {confidence:.2f}")
            logger.info(f"Final inserted text: '{inserted_text}'")
            logger.info("=" * 80)

            return TAPResponse(
                should_complete=True,
                confidence=confidence,
                latency_ms=latency_ms,
                proposed_changes=ProposedChanges(
                    prefix_diff=prefix_diff,
                    inserted_text=inserted_text,
                    suffix_diff=suffix_diff,
                ),
                usage=usage_info,
            )

        except json.JSONDecodeError as e:
            logger.error("-" * 80)
            logger.error("❌ JSON Parse Error")
            logger.error(f"Failed to parse LLM output: {str(e)}")
            logger.error(
                f"Raw output: {raw_output if 'raw_output' in locals() else 'N/A'}"
            )
            logger.error("=" * 80)
            return TAPResponse(
                should_complete=False,
                confidence=0.0,
                latency_ms=(time.time() - start_time) * 1000,
                reason="json_parse_error",
                usage=usage_info if "usage_info" in locals() else None,
            )
        except Exception as e:
            logger.error("-" * 80)
            logger.error("❌ Unexpected Error")
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"Error message: {str(e)}")
            logger.error("=" * 80)
            import traceback

            logger.debug(traceback.format_exc())
            return TAPResponse(
                should_complete=False,
                confidence=0.0,
                latency_ms=(time.time() - start_time) * 1000,
                reason=f"error: {str(e)}",
                usage=usage_info if "usage_info" in locals() else None,
            )


__all__ = ["TAPService", "TAPRequest", "TAPResponse"]
