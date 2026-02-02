"""
TAP - LaTeX completion
======================

TAP (Type-Ahead Prediction) provides LaTeX code completion.

For algorithm work:
- Input: prefix (before cursor), suffix (after cursor)
- Output: prefix_diff, inserted_text, suffix_diff
- Other steps (boundary fix, etc.) are deterministic post-processing

Usage:
    from services.tap import TAPService

    service = TAPService()
    result = await service.complete(prefix="The experiment shows", suffix=" in Table 1")
"""

from services.tap.service import TAPService, TAPRequest, TAPResponse

__all__ = ["TAPService", "TAPRequest", "TAPResponse"]
