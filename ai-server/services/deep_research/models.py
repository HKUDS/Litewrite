"""
Deep Research data models
=========================

Core models for reference types, references, report outlines, and research reports.
"""

from dataclasses import dataclass, field
from typing import List, Optional
from enum import Enum


# ============================================================================
# Reference types
# ============================================================================


class ReferenceType(Enum):
    """Reference type."""

    ARXIV = "arxiv"
    WEB = "web"


# ============================================================================
# Reference model
# ============================================================================


@dataclass
class Reference:
    """Reference information."""

    ref_id: str  # Reference ID, e.g. "1", "2"
    ref_type: ReferenceType
    title: str
    url: str

    # arXiv-specific
    arxiv_id: str = ""
    authors: List[str] = field(default_factory=list)
    year: int = 0
    abstract: str = ""

    # Web-specific
    favicon: str = ""
    snippet: str = ""

    # Common
    cited_content: str = ""  # Cited content excerpt
    relevance_score: float = 0.0

    def to_markdown(self) -> str:
        """Render as Markdown."""
        if self.ref_type == ReferenceType.ARXIV:
            authors_str = ", ".join(self.authors[:3])
            if len(self.authors) > 3:
                authors_str += " et al."
            return f'**[{self.ref_id}]** {authors_str}. "{self.title}". *arXiv:{self.arxiv_id}*, {self.year}. [Link]({self.url})'
        else:
            return f'**[{self.ref_id}]** "{self.title}". [Link]({self.url})'

    def to_bibtex(self) -> Optional[str]:
        """Render as BibTeX (arXiv only)."""
        if self.ref_type != ReferenceType.ARXIV:
            return None

        # Cite key: first author last name + year + last digits of arxiv_id
        if self.authors:
            first_author = self.authors[0].split()[-1].lower()
        else:
            first_author = "unknown"

        arxiv_short = self.arxiv_id.replace(".", "").replace("/", "")[-6:]
        cite_key = f"{first_author}{self.year}{arxiv_short}"

        authors_bibtex = " and ".join(self.authors)

        # Escape BibTeX specials
        title_escaped = self.title.replace("&", "\\&").replace("%", "\\%")

        return f"""@article{{{cite_key},
  title={{{title_escaped}}},
  author={{{authors_bibtex}}},
  journal={{arXiv preprint arXiv:{self.arxiv_id}}},
  year={{{self.year}}},
  url={{{self.url}}}
}}"""

    def to_dict(self) -> dict:
        return {
            "ref_id": self.ref_id,
            "ref_type": self.ref_type.value,
            "title": self.title,
            "url": self.url,
            "arxiv_id": self.arxiv_id,
            "authors": self.authors,
            "year": self.year,
            "favicon": self.favicon,
            "snippet": self.snippet,
            "relevance_score": self.relevance_score,
        }


# ============================================================================
# Report outline models
# ============================================================================


@dataclass
class ReportSection:
    """Report section."""

    id: str  # section_1, section_2, ...
    title: str  # Section title
    level: int = 2  # Heading level (2 = ##, 3 = ###)
    description: str = ""  # Description / bullet points
    subsections: List["ReportSection"] = None  # Subsections
    relevant_refs: List[int] = None  # Related reference IDs
    content: str = ""  # Generated content

    def __post_init__(self):
        if self.subsections is None:
            self.subsections = []
        if self.relevant_refs is None:
            self.relevant_refs = []


@dataclass
class ReportOutline:
    """Report outline."""

    title: str  # Report title
    abstract_points: List[str]  # Abstract bullet points
    sections: List[ReportSection]  # Main sections
    conclusion_points: List[str]  # Conclusion bullet points

    def to_dict(self) -> dict:
        def section_to_dict(s: ReportSection) -> dict:
            return {
                "id": s.id,
                "title": s.title,
                "level": s.level,
                "description": s.description,
                "subsections": [section_to_dict(sub) for sub in s.subsections],
                "relevant_refs": s.relevant_refs,
            }

        return {
            "title": self.title,
            "abstract_points": self.abstract_points,
            "sections": [section_to_dict(s) for s in self.sections],
            "conclusion_points": self.conclusion_points,
        }


# ============================================================================
# Research report model
# ============================================================================


@dataclass
class ResearchReport:
    """Research report."""

    query: str
    report_markdown: str
    references: List[Reference] = field(default_factory=list)

    # Counts
    arxiv_count: int = 0
    web_count: int = 0

    def get_bibtex(self) -> str:
        """Get BibTeX for all arXiv references."""
        bibtex_entries = []
        for ref in self.references:
            if ref.ref_type == ReferenceType.ARXIV:
                bib = ref.to_bibtex()
                if bib:
                    bibtex_entries.append(bib)
        return "\n\n".join(bibtex_entries)

    def get_references_markdown(self) -> str:
        """Get Markdown references list (grouped by source)."""
        arxiv_refs = [r for r in self.references if r.ref_type == ReferenceType.ARXIV]
        web_refs = [r for r in self.references if r.ref_type == ReferenceType.WEB]

        lines = ["## References\n"]

        # Academic papers
        if arxiv_refs:
            lines.append("### Academic Papers\n")
            for ref in arxiv_refs:
                lines.append(ref.to_markdown())
            lines.append("")

        # Web sources
        if web_refs:
            lines.append("### Web Sources\n")
            for ref in web_refs:
                lines.append(ref.to_markdown())

        return "\n\n".join(lines)

    def get_full_report(self) -> str:
        """Get full report (body + references)."""
        return f"{self.report_markdown}\n\n---\n\n{self.get_references_markdown()}"

    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "report_markdown": self.report_markdown,
            "full_report": self.get_full_report(),
            "references": [r.to_dict() for r in self.references],
            "references_markdown": self.get_references_markdown(),
            "bibtex": self.get_bibtex(),
            "arxiv_count": self.arxiv_count,
            "web_count": self.web_count,
        }


__all__ = [
    "ReferenceType",
    "Reference",
    "ReportSection",
    "ReportOutline",
    "ResearchReport",
]
