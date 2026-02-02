"""
Web page content fetching and processing
=======================================

Downloads web pages and extracts readable text. Uses CacheManager for caching (S3 supported).
"""

import re
from pathlib import Path
from typing import Optional, List

import httpx

from tools.web_search.models import WebPage, SearchResult
from core.cache import CacheManager


class WebContentProcessor:
    """
    Web page downloader and content processor.

    Features:
    - Async page download
    - HTML cleaning and text extraction
    - Content quality filtering
    - Caching

    Usage:
        processor = WebContentProcessor()
        page = await processor.download(search_result)
    """

    # Content quality thresholds
    MIN_CONTENT_LENGTH = 200  # Minimum content length
    MIN_AVG_LINE_LENGTH = 30  # Min average line length (filters nav/menu pages)
    MAX_DUPLICATE_RATIO = 0.5  # Max duplicate word ratio
    MIN_TEXT_DENSITY = 0.3  # Min text density (non-space chars / total)

    # Low-quality content patterns
    LOW_QUALITY_PATTERNS = [
        r"please enable javascript",
        r"cookies? (are |must be )?enabled",
        r"browser.*not supported",
        r"access denied",
        r"403 forbidden",
        r"404 not found",
        r"page not found",
        r"login required",
        r"sign in to continue",
        r"subscribe to (read|view|access)",
        r"captcha",
    ]

    def __init__(
        self,
        cache_dir: Path = None,  # Deprecated (CacheManager is used)
        timeout: int = 15,
        verbose: bool = False,
        max_content_length: int = 50000,  # Max content length
        cache: Optional[CacheManager] = None,
    ):
        """
        Args:
            cache_dir: Deprecated; kept for compatibility
            timeout: Request timeout in seconds
            verbose: Enable verbose logging
            max_content_length: Max content length (characters)
            cache: Optional CacheManager (defaults to CacheManager(\"web\"))
        """
        # CacheManager supports S3-backed cache.
        if cache is None:
            self.cache = CacheManager("web")
        else:
            self.cache = cache

        self.timeout = timeout
        self.verbose = verbose
        self.max_content_length = max_content_length

    def _log(self, message: str):
        if self.verbose:
            print(f"    [Web] {message}")

    # ========================================================================
    # Cache management (CacheManager; S3 supported)
    # ========================================================================

    def _load_from_cache(self, url: str) -> Optional[str]:
        """Load from cache."""
        return self.cache.get(url)

    def _save_to_cache(self, url: str, content: str):
        """Save to cache."""
        self.cache.put(url, content)

    def clear_cache(self):
        """Clear cache."""
        self.cache.clear()

    # ========================================================================
    # HTML cleaning
    # ========================================================================

    def _clean_html(self, html: str) -> str:
        """Clean HTML and extract readable text."""
        # Remove script/style
        html = re.sub(
            r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE
        )
        html = re.sub(
            r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE
        )
        html = re.sub(
            r"<noscript[^>]*>.*?</noscript>", "", html, flags=re.DOTALL | re.IGNORECASE
        )

        # Remove header/footer/nav/aside
        html = re.sub(
            r"<header[^>]*>.*?</header>", "", html, flags=re.DOTALL | re.IGNORECASE
        )
        html = re.sub(
            r"<footer[^>]*>.*?</footer>", "", html, flags=re.DOTALL | re.IGNORECASE
        )
        html = re.sub(r"<nav[^>]*>.*?</nav>", "", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(
            r"<aside[^>]*>.*?</aside>", "", html, flags=re.DOTALL | re.IGNORECASE
        )

        # Remove common ad/social/share containers
        html = re.sub(
            r'<div[^>]*class="[^"]*(?:ad|ads|advertisement|social|share|comment)[^"]*"[^>]*>.*?</div>',
            "",
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )

        # Remove HTML comments
        html = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)

        # Extract headings (h1-h6) and mark them
        def replace_heading(match):
            level = match.group(1)
            content = match.group(2)
            # Strip nested tags
            content = re.sub(r"<[^>]+>", "", content)
            markers = {
                "1": "# ",
                "2": "## ",
                "3": "### ",
                "4": "#### ",
                "5": "##### ",
                "6": "###### ",
            }
            return f"\n\n{markers.get(level, '## ')}{content.strip()}\n\n"

        html = re.sub(
            r"<h([1-6])[^>]*>(.*?)</h\1>",
            replace_heading,
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )

        # Preserve paragraph structure
        html = re.sub(
            r"<(p|div|br|li|tr|section|article)[^>]*>",
            "\n\n",
            html,
            flags=re.IGNORECASE,
        )

        # Strip remaining tags
        html = re.sub(r"<[^>]+>", " ", html)

        # Decode common HTML entities
        html = html.replace("&nbsp;", " ")
        html = html.replace("&amp;", "&")
        html = html.replace("&lt;", "<")
        html = html.replace("&gt;", ">")
        html = html.replace("&quot;", '"')
        html = html.replace("&#39;", "'")
        html = html.replace("&mdash;", "—")
        html = html.replace("&ndash;", "–")
        html = html.replace("&hellip;", "...")
        html = re.sub(r"&#\d+;", "", html)
        html = re.sub(r"&\w+;", "", html)

        # Normalize whitespace
        html = re.sub(r"[ \t]+", " ", html)
        html = re.sub(r"\n\s*\n+", "\n\n", html)

        return html.strip()

    def _extract_title(self, html: str) -> str:
        """Extract title from HTML."""
        title_match = re.search(
            r"<title[^>]*>(.*?)</title>", html, re.DOTALL | re.IGNORECASE
        )
        if title_match:
            title = title_match.group(1)
            title = re.sub(r"<[^>]+>", "", title)  # strip tags
            return title.strip()
        return ""

    # ========================================================================
    # Content quality checks
    # ========================================================================

    def _check_content_quality(self, content: str) -> tuple[bool, str]:
        """
        Check content quality.

        Returns:
            (is_valid, reason)
        """
        # 1) Length
        if len(content) < self.MIN_CONTENT_LENGTH:
            return (
                False,
                f"content too short ({len(content)} < {self.MIN_CONTENT_LENGTH})",
            )

        # 2) Low-quality patterns
        content_lower = content.lower()
        for pattern in self.LOW_QUALITY_PATTERNS:
            if re.search(pattern, content_lower):
                return False, f"low quality pattern detected: {pattern}"

        # 3) Average line length (filters navigation/menu pages)
        lines = [line.strip() for line in content.split("\n") if line.strip()]
        if lines:
            avg_line_length = sum(len(line) for line in lines) / len(lines)
            if avg_line_length < self.MIN_AVG_LINE_LENGTH:
                return (
                    False,
                    f"avg line too short ({avg_line_length:.1f} < {self.MIN_AVG_LINE_LENGTH})",
                )

        # 4) Duplicate word ratio
        words = content.split()
        if len(words) > 50:
            unique_words = set(words)
            duplicate_ratio = 1 - (len(unique_words) / len(words))
            if duplicate_ratio > self.MAX_DUPLICATE_RATIO:
                return False, f"too much duplicate content ({duplicate_ratio:.1%})"

        # 5) Text density (filters mostly-empty pages)
        non_space_chars = len(re.sub(r"\s", "", content))
        total_chars = len(content)
        if total_chars > 0:
            text_density = non_space_chars / total_chars
            if text_density < self.MIN_TEXT_DENSITY:
                return False, f"text density too low ({text_density:.1%})"

        return True, "ok"

    def _is_paywall_or_login(self, html: str) -> bool:
        """Detect paywall/login pages."""
        paywall_patterns = [
            r'class="[^"]*paywall[^"]*"',
            r'class="[^"]*subscription[^"]*"',
            r'id="[^"]*paywall[^"]*"',
            r"data-paywall",
            r'<meta[^>]*name="[^"]*paywall[^"]*"',
        ]

        html_lower = html.lower()
        for pattern in paywall_patterns:
            if re.search(pattern, html_lower):
                return True

        return False

    # ========================================================================
    # Public API
    # ========================================================================

    async def download(self, result: SearchResult, use_cache: bool = True) -> WebPage:
        """
        Download and process a web page.

        Args:
            result: Search result
            use_cache: Whether to use cache

        Returns:
            WebPage
        """
        url = result.url

        # Cache lookup
        if use_cache:
            cached = self._load_from_cache(url)
            if cached:
                self._log(f"{url[:50]}...: loaded from cache")
                return WebPage(
                    url=url,
                    title=result.title,
                    content=cached,
                    snippet=result.snippet,
                    favicon=result.favicon,
                    relevance_score=result.relevance_score,
                    content_downloaded=True,
                )

        self._log(f"{url[:50]}...: downloading...")

        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            }

            async with httpx.AsyncClient(
                timeout=self.timeout, follow_redirects=True
            ) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()

                # Content-type check
                content_type = response.headers.get("content-type", "")
                if "text/html" not in content_type.lower():
                    self._log(f"{url[:50]}...: not HTML ({content_type})")
                    return WebPage(
                        url=url,
                        title=result.title,
                        content="",
                        snippet=result.snippet,
                        favicon=result.favicon,
                        relevance_score=result.relevance_score,
                        content_downloaded=False,
                    )

                html = response.text

            # Paywall/login check
            if self._is_paywall_or_login(html):
                self._log(f"{url[:50]}...: paywall/login detected")
                return WebPage(
                    url=url,
                    title=result.title,
                    content="",
                    snippet=result.snippet,
                    favicon=result.favicon,
                    relevance_score=result.relevance_score,
                    content_downloaded=False,
                )

            # Title
            title = self._extract_title(html) or result.title

            # Extract text
            content = self._clean_html(html)

            # Length cap
            if len(content) > self.max_content_length:
                content = content[: self.max_content_length] + "..."

            # Content quality
            is_valid, reason = self._check_content_quality(content)
            if not is_valid:
                self._log(f"{url[:50]}...: {reason}")
                return WebPage(
                    url=url,
                    title=title,
                    content="",
                    snippet=result.snippet,
                    favicon=result.favicon,
                    relevance_score=result.relevance_score,
                    content_downloaded=False,
                )

            # Cache save
            self._save_to_cache(url, content)

            self._log(f"{url[:50]}...: ✓ ({len(content)} chars)")

            return WebPage(
                url=url,
                title=title,
                content=content,
                snippet=result.snippet,
                favicon=result.favicon,
                relevance_score=result.relevance_score,
                content_downloaded=True,
            )

        except Exception as e:
            self._log(f"{url[:50]}...: ✗ ({e})")
            return WebPage(
                url=url,
                title=result.title,
                content="",
                snippet=result.snippet,
                favicon=result.favicon,
                relevance_score=result.relevance_score,
                content_downloaded=False,
            )

    async def download_batch(
        self, results: List[SearchResult], use_cache: bool = True
    ) -> List[WebPage]:
        """
        Download a batch of web pages.

        Args:
            results: List of search results
            use_cache: Whether to use cache

        Returns:
            List of WebPage
        """
        import asyncio

        tasks = [self.download(r, use_cache) for r in results]
        return await asyncio.gather(*tasks)


__all__ = ["WebContentProcessor"]
