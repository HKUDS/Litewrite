"""
Web search client
=================

Search client backed by Serper API.
"""

from typing import List
from urllib.parse import urlparse

import httpx

from core import config
from tools.web_search.models import SearchResult


class WebSearchClient:
    """
    Serper-backed search client.

    Features:
    - Google search results
    - Domain filtering
    - Async requests

    Usage:
        client = WebSearchClient()
        results = await client.search("AI research trends")
    """

    SERPER_BASE_URL = "https://google.serper.dev"

    def __init__(
        self, api_key: str = None, excluded_domains: List[str] = None, timeout: int = 30
    ):
        """
        Args:
            api_key: Serper API Key
            excluded_domains: Domains to exclude
            timeout: Request timeout
        """
        self.api_key = api_key or config.serper_api_key
        self.excluded_domains = excluded_domains or [
            "arxiv.org"
        ]  # default exclude arxiv
        self.timeout = timeout

    def _is_excluded(self, url: str) -> bool:
        """Return True if url is excluded."""
        try:
            domain = urlparse(url).netloc.lower()
            for excluded in self.excluded_domains:
                if excluded.lower() in domain:
                    return True
            return False
        except Exception:
            return False

    def _get_favicon_url(self, url: str, provided_favicon: str = None) -> str:
        """Get favicon URL."""
        if provided_favicon:
            return provided_favicon
        try:
            domain = urlparse(url).netloc
            return f"https://www.google.com/s2/favicons?domain={domain}&sz=32"
        except Exception:
            return ""

    async def search(
        self,
        query: str,
        num_results: int = 10,
    ) -> List[SearchResult]:
        """
        Execute a search.

        Args:
            query: Search query
            num_results: Number of results

        Returns:
            List[SearchResult]
        """
        if not self.api_key:
            print("[WebSearch] Warning: SERPER_API_KEY not set")
            return []

        endpoint = f"{self.SERPER_BASE_URL}/search"

        payload = {
            "q": query,
            "num": num_results
            + len(self.excluded_domains) * 3,  # over-fetch to compensate filtering
        }

        headers = {
            "X-API-KEY": self.api_key,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(endpoint, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()

            results = []
            organic = data.get("organic", [])

            for item in organic:
                link = item.get("link", "")

                # Filter excluded domains
                if self._is_excluded(link):
                    continue

                result = SearchResult(
                    title=item.get("title", ""),
                    url=link,
                    snippet=item.get("snippet", ""),
                    favicon=self._get_favicon_url(link, item.get("favicon")),
                    position=len(results) + 1,
                )
                results.append(result)

                if len(results) >= num_results:
                    break

            return results

        except Exception as e:
            print(f"[WebSearch] Error: {e}")
            return []


__all__ = ["WebSearchClient"]
