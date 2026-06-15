"""PDF text extraction and text chunking utilities."""

from __future__ import annotations

import io

from PyPDF2 import PdfReader


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract all text content from a PDF file.

    Args:
        file_bytes: Raw bytes of the PDF file.

    Returns:
        The concatenated text of all pages, separated by newlines.
        Returns an empty string if the PDF has no extractable text.
    """
    reader = PdfReader(io.BytesIO(file_bytes))
    pages: list[str] = []

    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text.strip())

    return "\n\n".join(pages)


def chunk_text(
    text: str,
    chunk_size: int = 500,
    overlap: int = 50,
) -> list[str]:
    """Split text into overlapping chunks of approximately `chunk_size` words.

    The chunker splits on word boundaries so that no word is cut in half.
    Adjacent chunks overlap by `overlap` words so that context is preserved
    across boundaries.

    Args:
        text: The source text to chunk.
        chunk_size: Target number of words per chunk.
        overlap: Number of overlapping words between consecutive chunks.

    Returns:
        A list of text chunks. If the input is empty an empty list is returned.
    """
    if not text or not text.strip():
        return []

    words = text.split()

    if len(words) <= chunk_size:
        return [text.strip()]

    chunks: list[str] = []
    start = 0

    while start < len(words):
        end = start + chunk_size
        chunk_words = words[start:end]
        chunks.append(" ".join(chunk_words))

        # Advance by (chunk_size - overlap) words, ensuring forward progress.
        step = max(chunk_size - overlap, 1)
        start += step

    return chunks
