"""
Embedding engine
================

High-performance embedding engine with:
- In-memory caching
- Concurrency control
- Batch processing
- Automatic truncation

Usage:
    from core.embedding import EmbeddingEngine

    engine = EmbeddingEngine()

    # Single text
    embedding = await engine.embed("Hello, world!")

    # Batch
    embeddings = await engine.embed_batch(["Hello", "World"])

    # Similarity
    similarity = EmbeddingEngine.cosine_similarity(emb1, emb2)
"""

import asyncio
import hashlib
from typing import List, Dict

import numpy as np

from core.config import config
from core.llm import get_embedding_client
from core.utils import api_retry


class EmbeddingEngine:
    """
    OpenAI-compatible embedding engine.

    Features:
    - In-memory cache (avoid recomputation)
    - Concurrency control (Semaphore)
    - Auto-truncate long text
    - Async + retry
    """

    def __init__(
        self,
        model: str = None,
        max_text_length: int = 8000,
        batch_size: int = 20,
        max_concurrent: int = 5,
    ):
        """
        Args:
            model: Embedding model name (defaults to config)
            max_text_length: Max text length; longer text is truncated
            batch_size: Batch size per API call
            max_concurrent: Max concurrent requests
        """
        self.client = get_embedding_client()
        self.model = model or config.embedding_model
        self.max_text_length = max_text_length
        self.batch_size = batch_size
        self.max_concurrent = max_concurrent
        self._cache: Dict[str, np.ndarray] = {}
        self._semaphore: asyncio.Semaphore = None  # Lazy init

    def _get_semaphore(self) -> asyncio.Semaphore:
        """Get or create a semaphore (must be created within an event loop)."""
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.max_concurrent)
        return self._semaphore

    def _get_cache_key(self, text: str) -> str:
        """Generate cache key."""
        return hashlib.md5(text.encode()).hexdigest()

    def _truncate(self, text: str) -> str:
        """Truncate overly long text."""
        if len(text) > self.max_text_length:
            return text[: self.max_text_length]
        return text

    def clear_cache(self):
        """Clear cache."""
        self._cache.clear()

    @property
    def cache_size(self) -> int:
        """Return cache size."""
        return len(self._cache)

    @api_retry
    async def _embed_one_batch(self, texts: List[str]) -> List[np.ndarray]:
        """
        Internal: embed one batch with concurrency control.
        """
        async with self._get_semaphore():
            response = await self.client.embeddings.create(
                model=self.model,
                input=texts,
                encoding_format="float",
            )

        if response.data is None:
            raise RuntimeError(
                f"Embedding API returned empty response (model={self.model}). "
                "Check that EMBEDDING_API_BASE supports the configured EMBEDDING_MODEL."
            )

        return [np.array(item.embedding) for item in response.data]

    async def embed(self, text: str) -> np.ndarray:
        """Embed a single text."""
        cache_key = self._get_cache_key(text)
        if cache_key in self._cache:
            return self._cache[cache_key]

        text = self._truncate(text)
        embeddings = await self._embed_one_batch([text])

        self._cache[cache_key] = embeddings[0]
        return embeddings[0]

    async def embed_batch(self, texts: List[str]) -> List[np.ndarray]:
        """
        Embed multiple texts in parallel.

        Strategy:
        1. Check cache and collect uncached texts
        2. Split uncached texts into batches
        3. Embed batches concurrently
        4. Merge results and update cache
        """
        if not texts:
            return []

        # 1) Cache lookup
        results = [None] * len(texts)
        uncached_indices = []
        uncached_texts = []

        for i, text in enumerate(texts):
            cache_key = self._get_cache_key(text)
            if cache_key in self._cache:
                results[i] = self._cache[cache_key]
            else:
                uncached_indices.append(i)
                uncached_texts.append(self._truncate(text))

        if not uncached_texts:
            return results

        # 2) Batch
        batches = []
        for i in range(0, len(uncached_texts), self.batch_size):
            batches.append(uncached_texts[i : i + self.batch_size])

        # 3) Concurrent requests
        batch_results = await asyncio.gather(
            *[self._embed_one_batch(batch) for batch in batches]
        )

        # 4) Merge + cache update
        flat_embeddings = []
        for batch_embs in batch_results:
            flat_embeddings.extend(batch_embs)

        for idx, emb in zip(uncached_indices, flat_embeddings):
            results[idx] = emb
            cache_key = self._get_cache_key(texts[idx])
            self._cache[cache_key] = emb

        return results

    # ==================== Static helpers ====================

    @staticmethod
    def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """Cosine similarity."""
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

    @staticmethod
    def batch_cosine_similarity(
        query: np.ndarray, candidates: List[np.ndarray]
    ) -> List[float]:
        """Batch cosine similarity."""
        query_norm = np.linalg.norm(query)
        return [
            float(np.dot(query, c) / (query_norm * np.linalg.norm(c)))
            for c in candidates
        ]


__all__ = ["EmbeddingEngine"]
