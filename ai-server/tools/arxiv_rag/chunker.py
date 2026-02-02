"""
Text chunker
============

Split paper content into semantically meaningful chunks.
"""

import re
from typing import List

from tools.arxiv_rag.models import ArxivPaper, TextChunk


class TextChunker:
    """
    Text chunker.

    Features:
    - Split by sections
    - Split by paragraphs
    - Split by sentences (for overly long paragraphs)
    - Configurable chunk size and overlap

    Usage:
        chunker = TextChunker(chunk_size=2000, overlap=500)
        chunks = chunker.chunk_paper(paper)
    """

    def __init__(self, chunk_size: int = 2000, overlap: int = 500):
        """
        Args:
            chunk_size: Max characters per chunk
            overlap: Overlap characters between adjacent chunks
        """
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk_paper(self, paper: ArxivPaper) -> List[TextChunk]:
        """
        Chunk a paper into TextChunk items.

        Args:
            paper: ArxivPaper instance (must have latex_contents)

        Returns:
            List[TextChunk]: chunks
        """
        if not paper.latex_contents:
            return []

        all_chunks = []
        chunk_id = 0

        # Chunk each content blob independently
        for file_idx, text in enumerate(paper.latex_contents):
            if not text:
                continue

            file_chunks = self._chunk_single_text(
                text, paper.arxiv_id, chunk_id, file_idx
            )

            # Update chunk_id offset
            if file_chunks:
                chunk_id = file_chunks[-1].chunk_id + 1
                all_chunks.extend(file_chunks)

        return all_chunks

    def _chunk_single_text(
        self, text: str, paper_id: str, start_chunk_id: int, file_idx: int
    ) -> List[TextChunk]:
        """
        Chunk a single text blob.

        Args:
            text: Input text
            paper_id: Paper ID
            start_chunk_id: Starting chunk ID
            file_idx: File index

        Returns:
            List[TextChunk]: chunks
        """
        chunks = []
        chunk_id = start_chunk_id

        # Split by sections (## markers)
        sections = re.split(r"(##+ [^\n]+)", text)

        current_section = "Content"

        for part in sections:
            if part.startswith("##"):
                current_section = part.strip("# ").strip()
                continue

            # Chunk each section body
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
                                paper_id=paper_id,
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
                                            paper_id=paper_id,
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
                        paper_id=paper_id,
                        chunk_id=chunk_id,
                        text=current_chunk.strip(),
                        section=current_section,
                    )
                )
                chunk_id += 1

        return chunks

    def chunk_text(self, text: str, paper_id: str = "unknown") -> List[TextChunk]:
        """
        Chunk plain text (does not require an ArxivPaper instance).

        Args:
            text: Input text
            paper_id: Paper ID (for attribution)

        Returns:
            List[TextChunk]: chunks
        """
        if not text:
            return []

        return self._chunk_single_text(text, paper_id, 0, 0)


__all__ = ["TextChunker"]
