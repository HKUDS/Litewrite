"""
Web content chunker
===================

Split web page content into semantically meaningful chunks.
"""

import re
from typing import List

from tools.web_search.models import WebPage, TextChunk


class WebChunker:
    """
    Web content chunker.

    Features:
    - Split by headings
    - Split by paragraphs
    - Split by sentences (for overly long paragraphs)
    - Configurable chunk size
    - Filter low-quality chunks

    Usage:
        chunker = WebChunker(chunk_size=2000)
        chunks = chunker.chunk_page(page)
    """

    # Chunk quality thresholds
    MIN_CHUNK_LENGTH = 50  # Minimum chunk length
    MIN_WORD_COUNT = 10  # Minimum word count
    MAX_SPECIAL_CHAR_RATIO = 0.3  # Max special character ratio

    def __init__(self, chunk_size: int = 2000, overlap: int = 200):
        """
        Args:
            chunk_size: Max characters per chunk
            overlap: Overlap characters between adjacent chunks
        """
        self.chunk_size = chunk_size
        self.overlap = overlap

    def _is_valid_chunk(self, text: str) -> bool:
        """Return True if the chunk passes quality checks."""
        # 1) Length
        if len(text) < self.MIN_CHUNK_LENGTH:
            return False

        # 2) Word count
        words = text.split()
        if len(words) < self.MIN_WORD_COUNT:
            return False

        # 3) Special character ratio
        special_chars = len(re.findall(r"[^\w\s]", text))
        if len(text) > 0 and special_chars / len(text) > self.MAX_SPECIAL_CHAR_RATIO:
            return False

        # 4) Mostly links/code
        if text.count("http") > 5 or text.count("www.") > 5:
            return False

        return True

    def chunk_page(self, page: WebPage) -> List[TextChunk]:
        """
        Chunk a web page into TextChunk items.

        Args:
            page: WebPage instance

        Returns:
            List[TextChunk]: chunks
        """
        if not page.content:
            return []

        return self._chunk_text(page.content, page.url)

    def _chunk_text(self, text: str, page_url: str) -> List[TextChunk]:
        """Chunk raw text content."""
        chunks = []
        chunk_id = 0

        # Split by headings (# markers)
        sections = re.split(r"(#+\s+[^\n]+)", text)

        current_section = "Content"

        for part in sections:
            if part.startswith("#"):
                current_section = part.strip("# ").strip()
                continue

            part = part.strip()
            if not part:
                continue

            # Split by paragraph
            paragraphs = part.split("\n\n")
            current_chunk = ""

            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue

                if len(current_chunk) + len(para) < self.chunk_size:
                    current_chunk += para + "\n\n"
                else:
                    if current_chunk:
                        chunks.append(
                            TextChunk(
                                page_url=page_url,
                                chunk_id=chunk_id,
                                text=current_chunk.strip(),
                                section=current_section,
                            )
                        )
                        chunk_id += 1

                    # Handle overly long paragraphs
                    if len(para) > self.chunk_size:
                        # Split by sentence
                        sentences = re.split(r"(?<=[.!?])\s+", para)
                        current_chunk = ""
                        for sent in sentences:
                            if len(current_chunk) + len(sent) < self.chunk_size:
                                current_chunk += sent + " "
                            else:
                                if current_chunk:
                                    chunks.append(
                                        TextChunk(
                                            page_url=page_url,
                                            chunk_id=chunk_id,
                                            text=current_chunk.strip(),
                                            section=current_section,
                                        )
                                    )
                                    chunk_id += 1
                                current_chunk = sent + " "
                    else:
                        current_chunk = para + "\n\n"

            # Flush last chunk
            if current_chunk.strip():
                chunks.append(
                    TextChunk(
                        page_url=page_url,
                        chunk_id=chunk_id,
                        text=current_chunk.strip(),
                        section=current_section,
                    )
                )
                chunk_id += 1

        # Filter low-quality chunks
        valid_chunks = []
        for chunk in chunks:
            if self._is_valid_chunk(chunk.text):
                # Re-number
                chunk.chunk_id = len(valid_chunks)
                valid_chunks.append(chunk)

        return valid_chunks

    def chunk_text(self, text: str, page_url: str = "unknown") -> List[TextChunk]:
        """
        Chunk plain text (convenience method).

        Args:
            text: Input text
            page_url: Page URL (for attribution)

        Returns:
            List[TextChunk]: chunks
        """
        return self._chunk_text(text, page_url)


__all__ = ["WebChunker"]
