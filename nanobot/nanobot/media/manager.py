"""Unified media manager for downloading, storing, and managing media files.

All channels (Feishu, Telegram, WhatsApp, etc.) should use this module to
persist user-sent media.  Files are saved under ``~/.nanobot/media/`` with a
standardised naming scheme::

    {channel}_{timestamp}_{sanitised_original_name}.{ext}

The manager also handles housekeeping (e.g. cleaning up old files).
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from loguru import logger


# Where media files are stored
_DEFAULT_MEDIA_DIR = Path.home() / ".nanobot" / "media"

# Default max age before a file is eligible for cleanup (7 days)
_DEFAULT_MAX_AGE_DAYS = 7

# Regex to sanitise filenames
_UNSAFE_CHARS = re.compile(r"[^\w.\-]")


def _sanitise(name: str, max_len: int = 40) -> str:
    """Return a filesystem-safe version of *name*, truncated to *max_len*."""
    safe = _UNSAFE_CHARS.sub("_", name)
    return safe[:max_len] if len(safe) > max_len else safe


class MediaManager:
    """Centralised media file management.

    Usage::

        mgr = MediaManager()

        # Save bytes that were already downloaded
        path = mgr.save(data=raw_bytes, channel="feishu",
                        original_name="image.png")

        # Clean up files older than 7 days
        mgr.cleanup()
    """

    def __init__(self, media_dir: Path | None = None, max_age_days: int = _DEFAULT_MAX_AGE_DAYS):
        self.media_dir = media_dir or _DEFAULT_MEDIA_DIR
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.max_age_days = max_age_days

    # ------------------------------------------------------------------
    # Core API
    # ------------------------------------------------------------------

    def save(
        self,
        data: bytes,
        channel: str,
        original_name: str = "file",
        extension: str | None = None,
    ) -> str:
        """Persist *data* and return the absolute local file path.

        Parameters
        ----------
        data:
            Raw file bytes.
        channel:
            Source channel name (``feishu``, ``telegram``, …).
        original_name:
            The original file name (used for the saved filename).
        extension:
            Explicit extension (e.g. ``.png``).  If *None* the extension
            is inferred from *original_name*.
        """
        if extension is None:
            suffix = Path(original_name).suffix
            extension = suffix if suffix else ".bin"
        if not extension.startswith("."):
            extension = f".{extension}"

        ts = int(time.time() * 1000)
        safe_name = _sanitise(Path(original_name).stem)
        filename = f"{channel}_{ts}_{safe_name}{extension}"
        filepath = self.media_dir / filename

        filepath.write_bytes(data)
        logger.info(f"MediaManager: saved {len(data)} bytes -> {filepath}")
        return str(filepath)

    def save_file(
        self,
        source_path: str | Path,
        channel: str,
        original_name: str | None = None,
    ) -> str:
        """Copy an existing file into the managed media directory.

        Returns the new absolute path.
        """
        src = Path(source_path)
        if not src.is_file():
            raise FileNotFoundError(f"Source file not found: {source_path}")

        data = src.read_bytes()
        name = original_name or src.name
        return self.save(data=data, channel=channel, original_name=name)

    def get_path(self, filename: str) -> Path:
        """Return the full path for a managed filename."""
        return self.media_dir / filename

    def list_files(self, channel: str | None = None) -> list[dict[str, Any]]:
        """List managed media files, optionally filtered by *channel*.

        Returns a list of dicts with ``path``, ``size``, ``modified``
        and ``channel`` keys.
        """
        results: list[dict[str, Any]] = []
        for f in sorted(self.media_dir.iterdir()):
            if f.is_dir():
                continue
            parts = f.name.split("_", 2)
            file_channel = parts[0] if len(parts) >= 2 else "unknown"
            if channel and file_channel != channel:
                continue
            results.append(
                {
                    "path": str(f),
                    "name": f.name,
                    "size": f.stat().st_size,
                    "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                    "channel": file_channel,
                }
            )
        return results

    def cleanup(self, max_age_days: int | None = None) -> int:
        """Remove media files older than *max_age_days*.

        Returns the number of files removed.
        """
        age = max_age_days if max_age_days is not None else self.max_age_days
        cutoff = datetime.now() - timedelta(days=age)
        removed = 0

        for f in self.media_dir.iterdir():
            if f.is_dir():
                continue
            try:
                mtime = datetime.fromtimestamp(f.stat().st_mtime)
                if mtime < cutoff:
                    f.unlink()
                    removed += 1
            except Exception as e:
                logger.warning(f"MediaManager: failed to remove {f}: {e}")

        if removed:
            logger.info(f"MediaManager: cleaned up {removed} old file(s)")
        return removed
