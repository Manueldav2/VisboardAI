"""Agent 4 -- Background Fact-Checker Agent.

Runs asynchronously after the Router Agent flags a potential correction.
Extracts individual claims from the transcript, deduplicates them against
previously-checked claims, performs RAG lookup for course material context,
and batch-verifies via Gemini 2.0 Flash with structured JSON output.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid

from dotenv import load_dotenv
from google import genai

from agents.prompts import FACT_CHECKER_PROMPTS
from models.schemas import FactCheckResult
from services.embeddings import create_embedding
from services.supabase_client import search_chunks

load_dotenv()

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-2.5-flash"


# ---------------------------------------------------------------------------
# Claim deduplication (ported from src/services/claimRegistry.ts)
# ---------------------------------------------------------------------------

class ClaimRegistry:
    """Server-side claim deduplication using Jaccard word-overlap."""

    def __init__(self, threshold: float = 0.70) -> None:
        self._claims: dict[str, str] = {}  # normalized → original
        self._threshold = threshold

    def _normalize(self, text: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", text.lower())).strip()

    def _word_overlap(self, a: str, b: str) -> float:
        words_a = {w for w in a.split() if len(w) > 2}
        words_b = {w for w in b.split() if len(w) > 2}
        if not words_a or not words_b:
            return 0.0
        intersection = words_a & words_b
        return (2 * len(intersection)) / (len(words_a) + len(words_b))

    def register(self, claim: str) -> bool:
        """Return True if claim is NEW (not a duplicate)."""
        normalized = self._normalize(claim)
        if len(normalized) < 10:
            return False
        for existing in self._claims:
            if self._word_overlap(normalized, existing) > self._threshold:
                return False
        self._claims[normalized] = claim
        return True


# ---------------------------------------------------------------------------
# Structured output schema for Gemini
# ---------------------------------------------------------------------------

_VERIFY_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "claim": {"type": "string"},
            "status": {
                "type": "string",
                "enum": ["verified", "incorrect", "assumption"],
            },
            "confidence": {"type": "number"},
            "correction": {"type": "string"},
            "explanation": {"type": "string"},
            "source_excerpt": {"type": "string"},
        },
        "required": ["claim", "status", "confidence", "correction", "explanation"],
    },
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def check_claims(
    transcript_chunk: str,
    router_instruction: str,
    class_id: str | None,
    topic: str | None,
    claim_registry: ClaimRegistry,
    mode: str = "general",
) -> list[FactCheckResult]:
    """Extract claims from a transcript chunk, deduplicate, and verify.

    Returns a list of FactCheckResult objects for each novel claim found.
    Verified claims are included so callers can decide what to surface.
    """
    # 1) Extract individual claims using the router's hint
    claims = _extract_claims(transcript_chunk, router_instruction, mode=mode)
    if not claims:
        return []

    # 2) Deduplicate against session history
    novel_claims = [c for c in claims if claim_registry.register(c)]
    if not novel_claims:
        return []

    # 3) Gather RAG context for the claims
    rag_context = ""
    if class_id:
        rag_context = await _gather_rag_context(novel_claims, class_id)

    # 4) Batch verify via Gemini with structured output
    results = await _verify_claims(novel_claims, rag_context, mode=mode)
    return results


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_claims(
    transcript: str, router_instruction: str, mode: str = "general",
) -> list[str]:
    """Extract verifiable claims from the transcript chunk.

    Uses the router instruction as a hint for what's potentially wrong,
    and splits the transcript into individual factual assertions.
    In language mode, every sentence is a potential grammar check target.
    """
    claims: list[str] = []

    # Language mode: every sentence is a grammar check target
    is_language = mode == "language"
    min_length = 5 if is_language else 15

    # Split transcript into sentences
    sentences = re.split(r"[.!?]+", transcript)
    for s in sentences:
        s = s.strip()
        if len(s) < min_length or s.endswith("?"):
            continue
        # In language mode, skip filler check — check all utterances
        if not is_language and _is_filler(s):
            continue
        claims.append(s)

    # If the router flagged something specific, ensure it's included
    if router_instruction and len(router_instruction) > 10:
        pass  # claims from sentences above should cover it

    return claims[:5]  # Cap at 5 claims per chunk to control costs


def _is_filler(text: str) -> bool:
    """Return True if text is conversational filler or a subjective/meta statement,
    not a verifiable factual claim."""
    lower = text.lower().strip()

    filler_patterns = [
        r"^(um|uh|like|so|okay|alright|well|hmm|let me)",
        r"^(you know|basically)",
        r"^(wait|hold on|never mind)",
    ]
    if any(re.match(p, lower) for p in filler_patterns):
        return True

    # Subjective / meta-conversation — NOT verifiable claims
    subjective_patterns = [
        r"^i (don'?t|do not) (understand|know|get|remember|think)",
        r"^i('m| am) (currently |just |still )?(learning|studying|working|trying|looking|reading|thinking|confused)",
        r"^i (really |just )?(don'?t|do not|can'?t|cannot)",
        r"^i (think|believe|feel|guess|suppose|hope|wish|want|need|would like)",
        r"^(this is|that'?s|it'?s) (hard|easy|confusing|interesting|cool|great|difficult|tricky|weird)",
        r"^(can you|could you|would you|please|help me)",
        r"^(thank|thanks|sorry|excuse me|pardon)",
        r"^(yes|no|yeah|yep|nah|nope|sure|right|exactly|correct|true)$",
        r"^(oh|ah|wow|huh|hmm|interesting|okay)",
        r"^(actually )?i('m| am) (not )?((that |very |really )?(good|bad|sure|certain|confident))",
        r"(explain|tell me|what is|what are|how do|how does|can you explain)",
        r"^(the |a )?(psychological|history|science|math) term",
    ]
    if any(re.search(p, lower) for p in subjective_patterns):
        return True

    return False


async def _gather_rag_context(claims: list[str], class_id: str) -> str:
    """Embed claims and search course materials for relevant context."""
    # Combine claims into a single search query for efficiency
    query = " ".join(claims)
    try:
        embedding = await create_embedding(query)
        chunks = search_chunks(
            embedding=embedding,
            class_id=class_id,
            threshold=0.40,
            count=6,
        )
        if chunks:
            excerpts = [c.get("content", "") for c in chunks]
            return "\n---\n".join(excerpts)
    except Exception:
        logger.exception("RAG lookup failed for fact-checker")

    return ""


async def _verify_claims(
    claims: list[str],
    rag_context: str,
    mode: str = "general",
) -> list[FactCheckResult]:
    """Batch-verify claims via Gemini with structured JSON output."""
    numbered = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(claims))

    material_section = ""
    if rag_context:
        material_section = (
            f"## Course Material Excerpts\n{rag_context}\n\n"
        )

    user_content = (
        f"{material_section}"
        f"## Claims to Verify\n{numbered}\n\n"
        "Return a JSON array with one object per claim. Each object must have: "
        "claim, status, confidence, correction (empty string if not incorrect), "
        "explanation, and source_excerpt (empty string if no material cited)."
    )

    system_prompt = FACT_CHECKER_PROMPTS.get(mode, FACT_CHECKER_PROMPTS["general"])

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=user_content,
            config=genai.types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.2,
                max_output_tokens=1024,
                response_mime_type="application/json",
                response_schema=_VERIFY_SCHEMA,
            ),
        )

        text = response.text or "[]"
        parsed = json.loads(text)

        results: list[FactCheckResult] = []
        for entry in parsed:
            results.append(
                FactCheckResult(
                    id=f"fc_{uuid.uuid4().hex[:8]}",
                    claim=entry.get("claim", ""),
                    status=entry.get("status", "assumption"),
                    confidence=entry.get("confidence", 0.5),
                    correction=entry.get("correction", ""),
                    explanation=entry.get("explanation", ""),
                    source_excerpt=entry.get("source_excerpt", ""),
                )
            )
        return results

    except Exception:
        logger.exception("Gemini fact-check verification failed")
        return []
