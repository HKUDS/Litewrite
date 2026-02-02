"""
arXiv paper content downloader and processor
============================================

Supports two ways to fetch arXiv paper content:
1. HTML version (recommended: faster and more stable)
2. LaTeX source (fallback)
"""

import re
import gzip
import tarfile
from io import BytesIO
from pathlib import Path
from typing import Optional, List, Dict

import requests

from core.cache import CacheManager

# Default cache directory
DEFAULT_CACHE_DIR = Path(__file__).parent.parent.parent / "cache" / "arxiv"


class ArxivContentProcessor:
    """
    arXiv paper content downloader and processor.

    Features:
    - Prefer HTML (fast, typically less rate-limited)
    - Fallback to LaTeX source download
    - Local cache

    Usage:
        processor = ArxivContentProcessor()
        contents = processor.download(arxiv_id)  # returns List[str]
    """

    def __init__(
        self,
        cache_dir: Path = DEFAULT_CACHE_DIR,
        timeout: int = 20,
        verbose: bool = False,
        cache: Optional[CacheManager] = None,
    ):
        """
        Args:
            cache_dir: Cache directory
            timeout: Request timeout in seconds
            verbose: Enable verbose logging
            cache: Optional CacheManager (defaults to CacheManager("arxiv") with MD5 filenames)
        """
        # NOTE:
        # - CacheManager uses md5(key).txt as the filename to avoid special characters and keep consistency.
        # - The legacy implementation used the arXiv ID as the filename (e.g. 1706_09953v1.txt), which does not
        #   match CacheManager's hashed naming and can lead to accidentally committing runtime cache files.
        self._legacy_cache_dir = Path(cache_dir)

        if cache is None:
            # CacheManager expects base_dir to be the cache root and appends /{namespace} automatically.
            # - If you pass .../cache/arxiv: base_dir should be .../cache
            # - If you pass .../cache: base_dir can be .../cache directly
            base_dir = (
                str(cache_dir.parent) if cache_dir.name == "arxiv" else str(cache_dir)
            )
            self.cache = CacheManager("arxiv", base_dir=base_dir)
        else:
            self.cache = cache

        # Backward compatible: keep exposing cache_dir, but use CacheManager's base_dir.
        self.cache_dir = self.cache.base_dir
        self.timeout = timeout
        self.verbose = verbose

        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
        )

    def _log(self, message: str):
        if self.verbose:
            print(f"    [arXiv] {message}")

    # ========================================================================
    # Cache management
    # ========================================================================

    def _get_legacy_cache_path(self, arxiv_id: str) -> Path:
        """Legacy cache path (filename is derived from arXiv ID; kept for migration compatibility)."""
        safe_id = arxiv_id.replace("/", "_").replace(".", "_")
        return self._legacy_cache_dir / f"{safe_id}.txt"

    def _load_from_cache(self, arxiv_id: str) -> Optional[str]:
        """Load from cache."""
        cached = self.cache.get(arxiv_id)
        if cached:
            return cached

        # Compatibility: migrate legacy "{arxiv_id}.txt" into hashed cache format.
        legacy_path = self._get_legacy_cache_path(arxiv_id)
        if legacy_path.exists():
            legacy = legacy_path.read_text(encoding="utf-8", errors="ignore")
            if legacy:
                self.cache.put(arxiv_id, legacy, metadata={"migrated_from": "legacy"})
                try:
                    legacy_path.unlink()
                except Exception:
                    pass
                return legacy

        return None

    def _save_to_cache(self, arxiv_id: str, content: str):
        """Save to cache."""
        self.cache.put(arxiv_id, content)

        # Best-effort cleanup of legacy file to avoid accidental commits.
        legacy_path = self._get_legacy_cache_path(arxiv_id)
        if legacy_path.exists():
            try:
                legacy_path.unlink()
            except Exception:
                pass

    def clear_cache(self):
        """Clear all cached entries."""
        self.cache.clear()

    # ========================================================================
    # HTML download and cleanup
    # ========================================================================

    def _clean_html(self, html: str) -> str:
        """Clean arXiv HTML and extract readable text."""
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

        # Remove header/footer/nav
        html = re.sub(
            r"<header[^>]*>.*?</header>", "", html, flags=re.DOTALL | re.IGNORECASE
        )
        html = re.sub(
            r"<footer[^>]*>.*?</footer>", "", html, flags=re.DOTALL | re.IGNORECASE
        )
        html = re.sub(r"<nav[^>]*>.*?</nav>", "", html, flags=re.DOTALL | re.IGNORECASE)

        # Remove HTML comments
        html = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)

        # Preserve paragraph structure
        html = re.sub(
            r"<(p|div|br|h[1-6]|li|tr|section)[^>]*>", "\n\n", html, flags=re.IGNORECASE
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
        html = re.sub(r"&#\d+;", "", html)
        html = re.sub(r"&\w+;", "", html)

        # Normalize whitespace
        html = re.sub(r"[ \t]+", " ", html)
        html = re.sub(r"\n\s*\n+", "\n\n", html)

        return html.strip()

    def download_html(self, arxiv_id: str) -> Optional[str]:
        """
        Download arXiv HTML version (recommended).

        Args:
            arxiv_id: arXiv paper ID

        Returns:
            Cleaned text content, or None on failure
        """
        # Normalize ID and keep version suffix
        clean_id = arxiv_id.replace("arxiv:", "").strip()
        if "v" not in clean_id:
            clean_id = clean_id + "v1"  # default v1

        url = f"https://arxiv.org/html/{clean_id}"

        try:
            response = self.session.get(url, timeout=self.timeout)
            if response.status_code == 200:
                content = self._clean_html(response.text)
                if (
                    len(content) > 500
                ):  # treat as success only if content is non-trivial
                    return content
            return None
        except Exception:
            return None

    # ========================================================================
    # LaTeX download and cleanup
    # ========================================================================

    def _extract_tex_files(self, content: bytes) -> Dict[str, str]:
        """Extract all .tex files from downloaded content."""
        tex_files = {}

        # Try extracting as tar.gz
        try:
            with tarfile.open(fileobj=BytesIO(content), mode="r:gz") as tar:
                for member in tar.getmembers():
                    if member.name.endswith(".tex"):
                        f = tar.extractfile(member)
                        if f:
                            tex_content = f.read().decode("utf-8", errors="ignore")
                            if tex_content.strip():
                                tex_files[member.name] = tex_content

            if tex_files:
                return tex_files

        except tarfile.ReadError:
            pass

        # Try extracting as gzip (single file)
        try:
            decompressed = gzip.decompress(content)
            text = decompressed.decode("utf-8", errors="ignore")
            if text.strip():
                return {"main.tex": text}
        except gzip.BadGzipFile:
            pass

        # Try treating it as plain text
        try:
            text = content.decode("utf-8", errors="ignore")
            if text.strip():
                return {"main.tex": text}
        except Exception:
            pass

        return {}

    def _clean_latex(self, text: str) -> str:
        """
        Clean LaTeX and extract readable text.

        Processing steps:
        - Remove comments
        - Remove preamble
        - Extract section titles
        - Simplify math
        - Keep figure/table captions
        - Remove formatting commands
        - Handle citations
        - Handle lists
        """
        # 1) Remove comments
        text = re.sub(r"(?<!\\)%.*?\n", "\n", text)

        # 2) Remove preamble (between \\documentclass and \\begin{document})
        text = re.sub(
            r"\\documentclass.*?\\begin\{document\}", "", text, flags=re.DOTALL
        )

        # 3) Extract and mark section titles
        def replace_section(match):
            level = match.group(1)
            title = match.group(2)
            markers = {"section": "##", "subsection": "###", "subsubsection": "####"}
            marker = markers.get(level, "##")
            return f"\n\n{marker} {title}\n\n"

        text = re.sub(
            r"\\(section|subsection|subsubsection)\*?\{([^}]*)\}", replace_section, text
        )

        # 4) Handle common environments
        # Keep abstract
        text = re.sub(
            r"\\begin\{abstract\}(.*?)\\end\{abstract\}",
            r"\n\nABSTRACT:\n\1\n\n",
            text,
            flags=re.DOTALL,
        )

        # Simplify math environments (keep content but mark)
        text = re.sub(
            r"\\begin\{equation\*?\}(.*?)\\end\{equation\*?\}",
            r" [EQUATION: \1] ",
            text,
            flags=re.DOTALL,
        )
        text = re.sub(
            r"\\begin\{align\*?\}(.*?)\\end\{align\*?\}",
            r" [EQUATIONS: \1] ",
            text,
            flags=re.DOTALL,
        )
        text = re.sub(r"\$\$([^$]+)\$\$", r" [MATH: \1] ", text)
        text = re.sub(r"\$([^$]+)\$", r" \1 ", text)  # keep inline math content

        # Remove figure/table environments but keep captions
        def extract_caption(match):
            env_content = match.group(1)
            caption_match = re.search(r"\\caption\{([^}]*)\}", env_content)
            if caption_match:
                return f"\n[FIGURE/TABLE: {caption_match.group(1)}]\n"
            return ""

        text = re.sub(
            r"\\begin\{figure\*?\}(.*?)\\end\{figure\*?\}",
            extract_caption,
            text,
            flags=re.DOTALL,
        )
        text = re.sub(
            r"\\begin\{table\*?\}(.*?)\\end\{table\*?\}",
            extract_caption,
            text,
            flags=re.DOTALL,
        )

        # 5) Handle common formatting commands
        text = re.sub(r"\\textbf\{([^}]*)\}", r"\1", text)
        text = re.sub(r"\\textit\{([^}]*)\}", r"\1", text)
        text = re.sub(r"\\emph\{([^}]*)\}", r"\1", text)
        text = re.sub(r"\\underline\{([^}]*)\}", r"\1", text)
        text = re.sub(r"\\text\{([^}]*)\}", r"\1", text)
        text = re.sub(r"\\textrm\{([^}]*)\}", r"\1", text)
        text = re.sub(r"\\textsc\{([^}]*)\}", r"\1", text)

        # 6) Handle citations
        text = re.sub(r"\\cite\{([^}]*)\}", r"[cite: \1]", text)
        text = re.sub(r"\\citep?\{([^}]*)\}", r"[cite: \1]", text)
        text = re.sub(r"\\ref\{([^}]*)\}", r"[ref]", text)
        text = re.sub(r"\\label\{[^}]*\}", "", text)

        # 7) Handle lists
        text = re.sub(r"\\begin\{itemize\}", "", text)
        text = re.sub(r"\\end\{itemize\}", "", text)
        text = re.sub(r"\\begin\{enumerate\}", "", text)
        text = re.sub(r"\\end\{enumerate\}", "", text)
        text = re.sub(r"\\item\s*", "\n• ", text)

        # 8) Remove other environment declarations
        text = re.sub(r"\\begin\{[^}]*\}", "", text)
        text = re.sub(r"\\end\{[^}]*\}", "", text)

        # 9) Remove other commands
        text = re.sub(r"\\[a-zA-Z]+\*?\s*(?:\[[^\]]*\])?\s*(?:\{[^}]*\})?", "", text)

        # 10) Cleanup
        text = re.sub(r"\{|\}", "", text)  # remove remaining braces
        text = re.sub(r"\\\\", "\n", text)  # newlines
        text = re.sub(r"\n\s*\n+", "\n\n", text)  # collapse blank lines
        text = re.sub(r"[ \t]+", " ", text)  # collapse spaces

        return text.strip()

    def _download_latex_source(self, arxiv_id: str) -> Optional[str]:
        """Download LaTeX source (fallback)."""
        clean_id = arxiv_id.split("v")[0]
        url = f"https://arxiv.org/e-print/{clean_id}"

        try:
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()

            tex_dict = self._extract_tex_files(response.content)
            if tex_dict:
                # Merge all tex files
                all_content = []
                for filename, tex_content in tex_dict.items():
                    cleaned = self._clean_latex(tex_content)
                    if cleaned.strip():
                        all_content.append(cleaned)

                if all_content:
                    return "\n\n".join(all_content)

            return None
        except Exception:
            return None

    # ========================================================================
    # Public API
    # ========================================================================

    def download(self, arxiv_id: str, use_cache: bool = True) -> List[str]:
        """
        Download paper content (prefer HTML, fallback to LaTeX).

        Args:
            arxiv_id: arXiv paper ID
            use_cache: Whether to use cache

        Returns:
            A list of contents (usually a single item)
        """
        # Check cache
        if use_cache:
            cached = self._load_from_cache(arxiv_id)
            if cached:
                self._log(f"{arxiv_id}: loaded from cache")
                return [cached]

        self._log(f"{arxiv_id}: downloading HTML...")

        # 1) Prefer HTML
        content = self.download_html(arxiv_id)
        if content:
            self._save_to_cache(arxiv_id, content)
            self._log(f"{arxiv_id}: ✓ HTML ({len(content)} chars)")
            return [content]

        # 2) Fallback: LaTeX source
        self._log(f"{arxiv_id}: HTML not available, trying LaTeX...")

        content = self._download_latex_source(arxiv_id)
        if content:
            self._save_to_cache(arxiv_id, content)
            self._log(f"{arxiv_id}: ✓ LaTeX ({len(content)} chars)")
            return [content]

        self._log(f"{arxiv_id}: ✗ not available")
        return []

    # Backward compatible: legacy name


LaTeXProcessor = ArxivContentProcessor

__all__ = ["ArxivContentProcessor", "LaTeXProcessor"]
