"""
arXiv API search client
======================

Client for searching the arXiv API.
"""

import re
from typing import List, Optional

import requests

from tools.arxiv_rag.models import ArxivPaper


class ArxivSearchClient:
    """
    arXiv API search client.

    Features:
    - Search arXiv papers
    - Parse Atom XML responses
    - Extract paper metadata

    Usage:
        client = ArxivSearchClient()
        papers = client.search("transformer attention", max_results=10)
    """

    BASE_URL = "http://export.arxiv.org/api/query"

    def __init__(self, timeout: int = 30):
        """
        Args:
            timeout: Request timeout in seconds
        """
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Litewrite-ArxivRAG/2.0"})

    def _extract_tag(self, tag: str, text: str) -> str:
        """Extract a single XML tag value."""
        pattern = f"<{tag}[^>]*>(.*?)</{tag}>"
        match = re.search(pattern, text, re.DOTALL)
        return match.group(1).strip() if match else ""

    def _extract_all_tags(self, tag: str, text: str) -> List[str]:
        """Extract all matching XML tag values."""
        pattern = f"<{tag}[^>]*>(.*?)</{tag}>"
        return [m.group(1).strip() for m in re.finditer(pattern, text, re.DOTALL)]

    def _parse_entry(self, entry: str) -> Optional[ArxivPaper]:
        """Parse a single Atom entry."""
        try:
            # arXiv ID
            id_link = self._extract_tag("id", entry)
            arxiv_id = (
                id_link.split("/abs/")[-1]
                if "/abs/" in id_link
                else id_link.split("/")[-1]
            )

            # Title
            title = self._extract_tag("title", entry).replace("\n", " ").strip()

            # Abstract
            abstract = self._extract_tag("summary", entry).replace("\n", " ").strip()

            # Authors
            author_entries = self._extract_all_tags("author", entry)
            authors = [
                self._extract_tag("name", ae)
                for ae in author_entries
                if self._extract_tag("name", ae)
            ]

            # Published year
            published = self._extract_tag("published", entry)
            year = int(published[:4]) if published else 0

            # Categories
            categories = re.findall(r'term="([^"]+)"', entry)
            categories = [c for c in categories if "." in c]

            return ArxivPaper(
                arxiv_id=arxiv_id,
                title=title,
                abstract=abstract,
                authors=authors if authors else ["Unknown"],
                year=year,
                url=f"https://arxiv.org/abs/{arxiv_id}",
                categories=categories,
            )
        except Exception as e:
            print(f"[ArxivSearch] Parse error: {e}")
            return None

    def search(self, query: str, max_results: int = 20) -> List[ArxivPaper]:
        """
        Search arXiv papers.

        Args:
            query: Search query
            max_results: Maximum number of results

        Returns:
            List[ArxivPaper]
        """
        params = {
            "search_query": f"all:{query}",
            "start": 0,
            "max_results": max_results,
            "sortBy": "relevance",
            "sortOrder": "descending",
        }

        response = self.session.get(self.BASE_URL, params=params, timeout=self.timeout)
        response.raise_for_status()

        # Parse XML response
        entries = re.findall(r"<entry>(.*?)</entry>", response.text, re.DOTALL)

        papers = []
        for entry in entries:
            paper = self._parse_entry(entry)
            if paper:
                papers.append(paper)

        return papers

    def search_by_id(self, arxiv_id: str) -> Optional[ArxivPaper]:
        """
        Fetch a paper by arXiv ID.

        Args:
            arxiv_id: arXiv paper ID

        Returns:
            ArxivPaper or None
        """
        params = {
            "id_list": arxiv_id,
        }

        response = self.session.get(self.BASE_URL, params=params, timeout=self.timeout)
        response.raise_for_status()

        entries = re.findall(r"<entry>(.*?)</entry>", response.text, re.DOTALL)

        if entries:
            return self._parse_entry(entries[0])
        return None


__all__ = ["ArxivSearchClient"]
