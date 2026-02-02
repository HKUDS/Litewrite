"""
Reference manager
=================

Manages references in research reports:
- Deduplication
- BibTeX generation
- Reference list rendering
"""

from typing import List, Dict, Optional, Union

from services.deep_research.models import Reference, ReferenceType


class ReferenceManager:
    """
    Reference manager.

    Features:
    - Auto-assign reference IDs
    - Deduplicate by URL
    - Generate BibTeX
    - Render reference lists

    Usage:
        manager = ReferenceManager()
        ref_id = manager.add_arxiv_reference(paper)
        ref_id = manager.add_web_reference(page)
        bibtex = manager.get_bibtex()
    """

    def __init__(self):
        self.references: List[Reference] = []
        self._url_to_ref: Dict[str, Reference] = {}  # URL -> Reference (dedupe map)
        self._next_id = 1

    def _get_next_id(self) -> str:
        """Get next reference ID."""
        ref_id = str(self._next_id)
        self._next_id += 1
        return ref_id

    def add_arxiv_reference(
        self,
        arxiv_id: str,
        title: str,
        authors: List[str],
        year: int,
        url: str,
        abstract: str = "",
        cited_content: str = "",
        relevance_score: float = 0.0,
    ) -> str:
        """
        Add an arXiv paper reference.

        Returns:
            Reference ID (e.g. "1")
        """
        # Dedupe
        if url in self._url_to_ref:
            return self._url_to_ref[url].ref_id

        ref_id = self._get_next_id()

        ref = Reference(
            ref_id=ref_id,
            ref_type=ReferenceType.ARXIV,
            title=title,
            url=url,
            arxiv_id=arxiv_id,
            authors=authors,
            year=year,
            abstract=abstract,
            cited_content=cited_content,
            relevance_score=relevance_score,
        )

        self.references.append(ref)
        self._url_to_ref[url] = ref

        return ref_id

    def add_web_reference(
        self,
        title: str,
        url: str,
        snippet: str = "",
        favicon: str = "",
        cited_content: str = "",
        relevance_score: float = 0.0,
    ) -> str:
        """
        Add a web reference.

        Returns:
            Reference ID (e.g. "1")
        """
        # Dedupe
        if url in self._url_to_ref:
            return self._url_to_ref[url].ref_id

        ref_id = self._get_next_id()

        ref = Reference(
            ref_id=ref_id,
            ref_type=ReferenceType.WEB,
            title=title,
            url=url,
            snippet=snippet,
            favicon=favicon,
            cited_content=cited_content,
            relevance_score=relevance_score,
        )

        self.references.append(ref)
        self._url_to_ref[url] = ref

        return ref_id

    def get_reference(self, ref_id: Union[int, str]) -> Optional[Reference]:
        """Get a reference by ID."""
        ref_id_str = str(ref_id)
        for ref in self.references:
            if ref.ref_id == ref_id_str:
                return ref
        return None

    def get_reference_by_url(self, url: str) -> Optional[Reference]:
        """Get a reference by URL."""
        return self._url_to_ref.get(url)

    def get_all_references(self) -> List[Reference]:
        """Get all references."""
        return self.references

    def get_arxiv_references(self) -> List[Reference]:
        """Get all arXiv references."""
        return [r for r in self.references if r.ref_type == ReferenceType.ARXIV]

    def get_web_references(self) -> List[Reference]:
        """Get all web references."""
        return [r for r in self.references if r.ref_type == ReferenceType.WEB]

    def get_bibtex(self) -> str:
        """Get BibTeX for all arXiv references."""
        bibtex_entries = []
        for ref in self.get_arxiv_references():
            bib = ref.to_bibtex()
            if bib:
                bibtex_entries.append(bib)
        return "\n\n".join(bibtex_entries)

    def get_references_markdown(self) -> str:
        """Get the Markdown reference list."""
        if not self.references:
            return ""

        lines = ["## References\n"]
        for ref in self.references:
            lines.append(ref.to_markdown())
        return "\n\n".join(lines)

    def get_citation_map(self) -> Dict[str, str]:
        """
        Build citation map (URL -> ref_id).

        Used to replace citations during report generation.
        """
        return {url: ref.ref_id for url, ref in self._url_to_ref.items()}

    @property
    def arxiv_count(self) -> int:
        return len(self.get_arxiv_references())

    @property
    def web_count(self) -> int:
        return len(self.get_web_references())

    @property
    def total_count(self) -> int:
        return len(self.references)


__all__ = ["ReferenceManager"]
