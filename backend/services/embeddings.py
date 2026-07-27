"""Embedding service using Gemini gemini-embedding-001.

Output is truncated to 1536 dimensions to match the existing pgvector
column, then L2-normalized (recommended for sub-3072-dim Gemini vectors).
"""

from __future__ import annotations

import math
import os

from dotenv import load_dotenv
from google import genai

load_dotenv()

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-embedding-001"
DIMENSIONS = 1536


def _normalize(v: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


async def create_embedding(text: str) -> list[float]:
    """Generate a single 1536-dim embedding vector for the given text."""
    text = text.strip()[:32_000]
    if not text:
        return [0.0] * DIMENSIONS

    res = await _client.aio.models.embed_content(
        model=MODEL,
        contents=text,
        config=genai.types.EmbedContentConfig(output_dimensionality=DIMENSIONS),
    )
    return _normalize(list(res.embeddings[0].values))


async def create_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a batch of texts, preserving order."""
    if not texts:
        return []

    cleaned: list[tuple[int, str]] = []
    results: list[list[float] | None] = [None] * len(texts)

    for idx, t in enumerate(texts):
        stripped = t.strip()[:32_000]
        if stripped:
            cleaned.append((idx, stripped))
        else:
            results[idx] = [0.0] * DIMENSIONS

    if cleaned:
        batch_texts = [t for _, t in cleaned]
        res = await _client.aio.models.embed_content(
            model=MODEL,
            contents=batch_texts,
            config=genai.types.EmbedContentConfig(output_dimensionality=DIMENSIONS),
        )
        for (orig_idx, _), emb in zip(cleaned, res.embeddings):
            results[orig_idx] = _normalize(list(emb.values))

    return [v if v is not None else [0.0] * DIMENSIONS for v in results]
