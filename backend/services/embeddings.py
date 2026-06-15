"""Embedding service using OpenAI text-embedding-3-small (1536 dimensions)."""

from __future__ import annotations

import os

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

MODEL = "text-embedding-3-small"
DIMENSIONS = 1536


async def create_embedding(text: str) -> list[float]:
    """Generate a single embedding vector for the given text.

    Args:
        text: The text to embed. Will be stripped and truncated to ~8 000 tokens
              worth of characters as a safety measure.

    Returns:
        A list of 1536 floats representing the embedding vector.
    """
    text = text.strip()
    if not text:
        return [0.0] * DIMENSIONS

    # OpenAI's text-embedding-3-small supports up to 8191 tokens.
    # A rough char limit (~32 000 chars) avoids token-counting overhead.
    text = text[:32_000]

    response = await _client.embeddings.create(
        input=text,
        model=MODEL,
        dimensions=DIMENSIONS,
    )
    return response.data[0].embedding


async def create_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a batch of texts in a single API call.

    Args:
        texts: A list of strings to embed. Empty strings receive zero vectors.

    Returns:
        A list of embedding vectors, one per input text, preserving order.
    """
    if not texts:
        return []

    # Separate empty texts so we don't waste API calls on them.
    cleaned: list[tuple[int, str]] = []
    results: list[list[float] | None] = [None] * len(texts)

    for idx, t in enumerate(texts):
        stripped = t.strip()[:32_000]
        if stripped:
            cleaned.append((idx, stripped))
        else:
            results[idx] = [0.0] * DIMENSIONS

    if cleaned:
        # OpenAI allows up to 2048 inputs per batch call.
        batch_texts = [t for _, t in cleaned]
        response = await _client.embeddings.create(
            input=batch_texts,
            model=MODEL,
            dimensions=DIMENSIONS,
        )

        # The API returns embeddings in the same order as the inputs, but each
        # object carries an `index` field for safety.
        for emb_obj in response.data:
            original_idx = cleaned[emb_obj.index][0]
            results[original_idx] = emb_obj.embedding

    # Replace any remaining Nones (shouldn't happen, but be safe).
    return [v if v is not None else [0.0] * DIMENSIONS for v in results]
