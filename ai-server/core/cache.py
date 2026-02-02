"""
Cache management
================

Unified cache management with local filesystem cache and S3/MinIO cache backends.

S3 key format: ai-server-cache/{namespace}/{hash}.txt
(sibling of litewrite/, projects/, etc.)

Usage:
    from core.cache import CacheManager

    cache = CacheManager("arxiv")

    # Write
    cache.put("paper_123", content)

    # Read
    content = cache.get("paper_123")

    # Exists
    if cache.exists("paper_123"):
        ...
"""

import json
import hashlib
from pathlib import Path
from typing import Optional, Any, Dict
from datetime import datetime
from abc import ABC, abstractmethod

from core.config import config


# ==================== Backend abstraction ====================


class CacheBackend(ABC):
    """Abstract base class for cache backends."""

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Return True if the cache entry exists."""
        pass

    @abstractmethod
    def get(self, key: str) -> Optional[str]:
        """Get cached content."""
        pass

    @abstractmethod
    def put(self, key: str, content: str) -> None:
        """Write cached content."""
        pass

    @abstractmethod
    def delete(self, key: str) -> bool:
        """Delete a cache entry."""
        pass

    @abstractmethod
    def list_keys(self) -> list:
        """List all cache keys."""
        pass

    @abstractmethod
    def clear(self) -> None:
        """Clear all cache entries."""
        pass


class LocalCacheBackend(CacheBackend):
    """Local filesystem cache backend."""

    def __init__(self, namespace: str, base_dir: str = None):
        self.namespace = namespace
        self.base_dir = Path(base_dir or config.cache_base_dir) / namespace
        self.base_dir.mkdir(parents=True, exist_ok=True)

        # Metadata file
        self._meta_file = self.base_dir / "_meta.json"
        self._meta: Dict[str, Any] = self._load_meta()

    def _load_meta(self) -> Dict[str, Any]:
        """Load metadata."""
        if self._meta_file.exists():
            try:
                with open(self._meta_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"entries": {}, "created_at": datetime.now().isoformat()}

    def _save_meta(self):
        """Persist metadata."""
        with open(self._meta_file, "w", encoding="utf-8") as f:
            json.dump(self._meta, f, ensure_ascii=False, indent=2)

    def _get_cache_path(self, key: str) -> Path:
        """Resolve the cache file path for a given key."""
        hash_key = hashlib.md5(key.encode()).hexdigest()
        return self.base_dir / f"{hash_key}.txt"

    def exists(self, key: str) -> bool:
        return self._get_cache_path(key).exists()

    def get(self, key: str) -> Optional[str]:
        cache_path = self._get_cache_path(key)
        if not cache_path.exists():
            return None
        with open(cache_path, "r", encoding="utf-8") as f:
            return f.read()

    def put(self, key: str, content: str) -> None:
        cache_path = self._get_cache_path(key)
        with open(cache_path, "w", encoding="utf-8") as f:
            f.write(content)

        # Update metadata
        self._meta["entries"][key] = {
            "hash": hashlib.md5(key.encode()).hexdigest(),
            "size": len(content),
            "created_at": datetime.now().isoformat(),
        }
        self._save_meta()

    def delete(self, key: str) -> bool:
        cache_path = self._get_cache_path(key)
        if cache_path.exists():
            cache_path.unlink()
            if key in self._meta["entries"]:
                del self._meta["entries"][key]
                self._save_meta()
            return True
        return False

    def list_keys(self) -> list:
        return list(self._meta.get("entries", {}).keys())

    def clear(self) -> None:
        for file in self.base_dir.glob("*.txt"):
            file.unlink()
        self._meta = {"entries": {}, "created_at": datetime.now().isoformat()}
        self._save_meta()

    @property
    def size(self) -> int:
        return len(list(self.base_dir.glob("*.txt")))


class S3CacheBackend(CacheBackend):
    """S3 object storage cache backend."""

    def __init__(self, namespace: str):
        self.namespace = namespace
        self.prefix = f"{config.s3_cache_prefix}/{namespace}/"
        self._client = None
        self._meta: Dict[str, Any] = {"entries": {}}
        self._meta_loaded = False

    @property
    def client(self):
        """Lazy-load S3 client."""
        if self._client is None:
            import boto3
            from botocore.config import Config as BotoConfig

            client_config = BotoConfig(
                signature_version="s3v4", retries={"max_attempts": 3}
            )

            self._client = boto3.client(
                "s3",
                endpoint_url=config.s3_endpoint or None,
                region_name=config.s3_region,
                aws_access_key_id=config.s3_access_key,
                aws_secret_access_key=config.s3_secret_key,
                config=client_config,
            )
        return self._client

    def _get_key(self, key: str) -> str:
        """Build the S3 object key for a cache entry."""
        hash_key = hashlib.md5(key.encode()).hexdigest()
        return f"{self.prefix}{hash_key}.txt"

    def _get_meta_key(self) -> str:
        """Build the S3 object key for metadata."""
        return f"{self.prefix}_meta.json"

    def _load_meta(self) -> Dict[str, Any]:
        """Load metadata from S3."""
        if self._meta_loaded:
            return self._meta

        try:
            response = self.client.get_object(
                Bucket=config.s3_bucket, Key=self._get_meta_key()
            )
            content = response["Body"].read().decode("utf-8")
            self._meta = json.loads(content)
        except self.client.exceptions.NoSuchKey:
            self._meta = {"entries": {}, "created_at": datetime.now().isoformat()}
        except Exception as e:
            print(f"[S3Cache] Failed to load meta: {e}")
            self._meta = {"entries": {}, "created_at": datetime.now().isoformat()}

        self._meta_loaded = True
        return self._meta

    def _save_meta(self):
        """Save metadata to S3."""
        try:
            content = json.dumps(self._meta, ensure_ascii=False, indent=2)
            self.client.put_object(
                Bucket=config.s3_bucket,
                Key=self._get_meta_key(),
                Body=content.encode("utf-8"),
                ContentType="application/json",
            )
        except Exception as e:
            print(f"[S3Cache] Failed to save meta: {e}")

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=config.s3_bucket, Key=self._get_key(key))
            return True
        except ClientError as e:
            # head_object raises ClientError with 404 when object doesn't exist
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "404" or error_code == "NoSuchKey":
                return False
            # Re-raise for other errors (network, permission, auth, etc.)
            print(f"[S3Cache] Failed to check existence of {key}: {e}")
            raise

    def get(self, key: str) -> Optional[str]:
        try:
            response = self.client.get_object(
                Bucket=config.s3_bucket, Key=self._get_key(key)
            )
            return response["Body"].read().decode("utf-8")
        except self.client.exceptions.NoSuchKey:
            return None
        except Exception as e:
            print(f"[S3Cache] Failed to get {key}: {e}")
            return None

    def put(self, key: str, content: str) -> None:
        try:
            self.client.put_object(
                Bucket=config.s3_bucket,
                Key=self._get_key(key),
                Body=content.encode("utf-8"),
                ContentType="text/plain; charset=utf-8",
            )

            # Update metadata
            self._load_meta()
            self._meta["entries"][key] = {
                "hash": hashlib.md5(key.encode()).hexdigest(),
                "size": len(content),
                "created_at": datetime.now().isoformat(),
            }
            self._save_meta()
        except Exception as e:
            print(f"[S3Cache] Failed to put {key}: {e}")
            raise

    def delete(self, key: str) -> bool:
        try:
            self.client.delete_object(Bucket=config.s3_bucket, Key=self._get_key(key))

            # Update metadata
            self._load_meta()
            if key in self._meta["entries"]:
                del self._meta["entries"][key]
                self._save_meta()
            return True
        except Exception as e:
            print(f"[S3Cache] Failed to delete {key}: {e}")
            return False

    def list_keys(self) -> list:
        self._load_meta()
        return list(self._meta.get("entries", {}).keys())

    def clear(self) -> None:
        """Clear all cache objects within this namespace."""
        try:
            # List all objects
            paginator = self.client.get_paginator("list_objects_v2")
            pages = paginator.paginate(Bucket=config.s3_bucket, Prefix=self.prefix)

            # Bulk delete
            for page in pages:
                if "Contents" in page:
                    objects = [{"Key": obj["Key"]} for obj in page["Contents"]]
                    if objects:
                        self.client.delete_objects(
                            Bucket=config.s3_bucket, Delete={"Objects": objects}
                        )

            self._meta = {"entries": {}, "created_at": datetime.now().isoformat()}
            self._meta_loaded = True
        except Exception as e:
            print(f"[S3Cache] Failed to clear: {e}")

    @property
    def size(self) -> int:
        self._load_meta()
        return len(self._meta.get("entries", {}))


# ==================== Cache manager ====================


class CacheManager:
    """
    Unified cache manager.

    Automatically selects local or S3 backend based on configuration.
    """

    def __init__(self, namespace: str, base_dir: str = None):
        """
        Args:
            namespace: Cache namespace (e.g. "arxiv", "web")
            base_dir: Local cache root directory (only used for local backend)
        """
        self.namespace = namespace
        self._base_dir = base_dir

        # Select backend
        if config.use_s3_cache:
            print(f"[CacheManager] Using S3 backend for '{namespace}'")
            self._backend = S3CacheBackend(namespace)
        else:
            print(f"[CacheManager] Using local backend for '{namespace}'")
            self._backend = LocalCacheBackend(namespace, base_dir)

    @property
    def base_dir(self) -> Path:
        """
        Return the cache directory path.

        - Local backend: returns the actual local cache directory
        - S3 backend: returns a local temp directory (for temporary file operations)
        """
        if isinstance(self._backend, LocalCacheBackend):
            return self._backend.base_dir
        else:
            # S3 backend: use local temp directory
            temp_dir = Path(config.cache_base_dir) / self.namespace
            temp_dir.mkdir(parents=True, exist_ok=True)
            return temp_dir

    def exists(self, key: str) -> bool:
        """Return True if the cache entry exists."""
        return self._backend.exists(key)

    def get(self, key: str) -> Optional[str]:
        """
        Get cached content.

        Returns:
            Cached content, or None if missing
        """
        return self._backend.get(key)

    def get_json(self, key: str) -> Optional[Any]:
        """
        Get a cached JSON value.

        Returns:
            Parsed JSON object, or None if missing
        """
        content = self.get(key)
        if content is None:
            return None

        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return None

    def put(self, key: str, content: str, metadata: Dict[str, Any] = None):
        """
        Write cached content.

        Args:
            key: Cache key
            content: Cache content
            metadata: Optional metadata (reserved for compatibility; currently unused)
        """
        self._backend.put(key, content)

    def put_json(self, key: str, data: Any, metadata: Dict[str, Any] = None):
        """
        Write a JSON cache entry.

        Args:
            key: Cache key
            data: Data to cache (JSON-serialized)
            metadata: Optional metadata
        """
        content = json.dumps(data, ensure_ascii=False, indent=2)
        self.put(key, content, metadata)

    def delete(self, key: str) -> bool:
        """
        Delete a cache entry.

        Returns:
            True if deleted successfully
        """
        return self._backend.delete(key)

    def clear(self):
        """Clear all cache entries."""
        self._backend.clear()

    @property
    def size(self) -> int:
        """Number of cached entries."""
        return self._backend.size

    def list_keys(self) -> list:
        """List all cache keys."""
        return self._backend.list_keys()


# ==================== Predefined cache instances ====================


def get_arxiv_cache() -> CacheManager:
    """Get the arXiv cache manager."""
    return CacheManager("arxiv")


def get_web_cache() -> CacheManager:
    """Get the web cache manager."""
    return CacheManager("web")


__all__ = [
    "CacheManager",
    "get_arxiv_cache",
    "get_web_cache",
]
