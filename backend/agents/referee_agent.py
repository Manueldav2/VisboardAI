"""Agent 6 -- Argument Referee.

Listens to debate/argument statements and aggressively detects logical
fallacies, bad faith arguments, red herrings, and factual errors.
Speaks up immediately like a debate referee with a brief, punchy callout.
"""

from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from google import genai

from agents.prompts import REFEREE_SYSTEM_PROMPT, HARVEY_SPECTER_PROMPT, TECHNIQUE_ANALYZER_PROMPT

load_dotenv()

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-2.5-flash"
TTS_MODEL = "gemini-2.5-flash-preview-tts"


def _clean_for_speech(text: str) -> str:
    """Strip formatting for natural spoken delivery."""
    import re
    text = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'\n+', ' ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip().strip('"').strip("'")


# ---------------------------------------------------------------------------
# Structured output schema for fallacy detection
# ---------------------------------------------------------------------------

_FALLACY_SCHEMA = {
    "type": "object",
    "properties": {
        "has_issue": {"type": "boolean"},
        "fallacy_name": {
            "type": "string",
            "description": "Name of the fallacy or 'None' if no issue",
        },
        "category": {
            "type": "string",
            "enum": [
                "Formal",
                "Relevance",
                "Presumption",
                "Ambiguity",
                "Bad Faith",
                "Factual Error",
                "None",
            ],
        },
        "what_was_said": {
            "type": "string",
            "description": "The exact problematic statement or paraphrase",
        },
        "why_its_wrong": {
            "type": "string",
            "description": "Brief explanation of why this is a fallacy/error",
        },
        "correct_form": {
            "type": "string",
            "description": "How the argument should be properly formed",
        },
        "severity": {
            "type": "string",
            "enum": ["low", "medium", "high"],
        },
        "callout_text": {
            "type": "string",
            "description": "Brief, punchy voice callout (1-2 sentences max)",
        },
    },
    "required": [
        "has_issue",
        "fallacy_name",
        "category",
        "what_was_said",
        "why_its_wrong",
        "correct_form",
        "severity",
        "callout_text",
    ],
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def analyze_statement(
    statement: str,
    conversation_history: list[dict],
) -> dict:
    """Analyze a statement for logical fallacies, bad faith, and factual errors.

    Args:
        statement: The latest spoken statement to analyze.
        conversation_history: Previous conversation entries.

    Returns:
        {
            "has_issue": bool,
            "fallacy_name": str,
            "category": str,
            "what_was_said": str,
            "why_its_wrong": str,
            "correct_form": str,
            "severity": str,
            "callout_text": str,
        }
    """
    # Build conversation context
    contents = []
    for entry in conversation_history:
        contents.append(
            genai.types.Content(
                role=entry["role"],
                parts=[genai.types.Part(text=entry["text"])],
            )
        )
    contents.append(
        genai.types.Content(
            role="user",
            parts=[genai.types.Part(text=statement)],
        )
    )

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=contents,
            config=genai.types.GenerateContentConfig(
                system_instruction=REFEREE_SYSTEM_PROMPT,
                temperature=0.2,
                max_output_tokens=512,
                response_mime_type="application/json",
                response_schema=_FALLACY_SCHEMA,
            ),
        )

        result = json.loads(response.text or "{}")
        return result

    except Exception:
        logger.exception("Referee analysis failed")
        return {
            "has_issue": False,
            "fallacy_name": "None",
            "category": "None",
            "what_was_said": "",
            "why_its_wrong": "",
            "correct_form": "",
            "severity": "low",
            "callout_text": "",
        }


async def argue_back(
    statement: str,
    conversation_history: list[dict],
) -> dict:
    """Harvey Specter mode: aggressively argue the opposing side with research.

    Uses Google Search grounding for counter-evidence.

    Returns:
        {
            "text": str (Harvey's response),
            "claim_valid": bool (whether the user's claim has merit),
            "counter_argument": str (the core counter-point),
            "evidence": str (supporting data/sources for counter),
        }
    """
    contents = []
    for entry in conversation_history:
        contents.append(
            genai.types.Content(
                role=entry["role"],
                parts=[genai.types.Part(text=entry["text"])],
            )
        )
    contents.append(
        genai.types.Content(
            role="user",
            parts=[genai.types.Part(text=statement)],
        )
    )

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=contents,
            config=genai.types.GenerateContentConfig(
                system_instruction=HARVEY_SPECTER_PROMPT,
                temperature=0.7,
                max_output_tokens=300,
                tools=[genai.types.Tool(google_search=genai.types.GoogleSearch())],
            ),
        )

        raw_text = response.text or ""
        return {
            "text": raw_text,
            "claim_valid": False,
            "counter_argument": "",
            "evidence": "",
        }

    except Exception:
        logger.exception("Harvey Specter argue_back failed")
        return {
            "text": "I didn't catch that. Say it again — and this time, make it worth my time.",
            "claim_valid": False,
            "counter_argument": "",
            "evidence": "",
        }


# ---------------------------------------------------------------------------
# Structured output schema for technique detection
# ---------------------------------------------------------------------------

_TECHNIQUE_SCHEMA = {
    "type": "object",
    "properties": {
        "technique_name": {
            "type": "string",
            "description": "Name of the technique detected, or 'None' if no notable technique",
        },
        "technique_quality": {
            "type": "string",
            "enum": ["effective", "weak", "misapplied", "none"],
        },
        "feedback": {
            "type": "string",
            "description": "1-2 sentence feedback on the technique",
        },
        "contention_strength": {
            "type": "string",
            "enum": ["strong", "moderate", "weak", "none"],
        },
    },
    "required": ["technique_name", "technique_quality", "feedback", "contention_strength"],
}


async def analyze_technique(
    statement: str,
    conversation_history: list[dict],
) -> dict:
    """Analyze debate techniques used in the latest statement.

    Runs in parallel with analyze_statement for live sessions.

    Returns:
        {
            "technique_name": str,
            "technique_quality": "effective" | "weak" | "misapplied" | "none",
            "feedback": str,
            "contention_strength": "strong" | "moderate" | "weak" | "none",
        }
    """
    contents = []
    for entry in conversation_history[-6:]:  # Last 6 turns for context
        contents.append(
            genai.types.Content(
                role=entry["role"],
                parts=[genai.types.Part(text=entry["text"])],
            )
        )
    contents.append(
        genai.types.Content(
            role="user",
            parts=[genai.types.Part(text=statement)],
        )
    )

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=contents,
            config=genai.types.GenerateContentConfig(
                system_instruction=TECHNIQUE_ANALYZER_PROMPT,
                temperature=0.2,
                max_output_tokens=256,
                response_mime_type="application/json",
                response_schema=_TECHNIQUE_SCHEMA,
            ),
        )

        result = json.loads(response.text or "{}")
        return result

    except Exception:
        logger.exception("Technique analysis failed")
        return {
            "technique_name": "None",
            "technique_quality": "none",
            "feedback": "",
            "contention_strength": "none",
        }


# ---------------------------------------------------------------------------
# Contention extraction
# ---------------------------------------------------------------------------

_CONTENTION_SCHEMA = {
    "type": "object",
    "properties": {
        "contentions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Contention ID like c1, c2, etc."},
                    "text": {"type": "string", "description": "The core claim/contention"},
                    "strength": {
                        "type": "string",
                        "enum": ["strong", "moderate", "weak"],
                    },
                    "evidence_status": {
                        "type": "string",
                        "enum": ["cited", "implied", "missing"],
                    },
                    "vulnerability": {
                        "type": "string",
                        "description": "Key weakness or counter-argument vulnerability",
                    },
                },
                "required": ["id", "text", "strength", "evidence_status", "vulnerability"],
            },
        },
    },
    "required": ["contentions"],
}

_CONTENTION_PROMPT = """You are a debate structure analyst. Extract the contentions (main claims/arguments)
from the speaker's statements. For each contention:
- Identify the core claim
- Rate its strength (strong=well-evidenced, moderate=some support, weak=assertion only)
- Note if evidence was cited, implied, or missing
- Identify the main vulnerability (what an opponent would attack)

Merge with existing contentions if they overlap. Update strength based on new evidence or fallacies.
Only return contentions that are substantive claims, not filler or meta-comments.
If there are no real contentions in the text, return an empty array."""


async def extract_contentions(
    statement: str,
    conversation_history: list[dict],
    existing_contentions: list[dict] | None = None,
) -> list[dict]:
    """Extract and update contentions from the latest statement.

    Returns list of contention dicts with id, text, strength, evidence_status, vulnerability.
    """
    context_parts = []
    if existing_contentions:
        context_parts.append(
            f"Existing contentions:\n{json.dumps(existing_contentions, indent=2)}"
        )

    contents = []
    for entry in conversation_history[-6:]:
        contents.append(
            genai.types.Content(
                role=entry["role"],
                parts=[genai.types.Part(text=entry["text"])],
            )
        )

    user_text = statement
    if context_parts:
        user_text = "\n".join(context_parts) + f"\n\nNew statement: {statement}"

    contents.append(
        genai.types.Content(
            role="user",
            parts=[genai.types.Part(text=user_text)],
        )
    )

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=contents,
            config=genai.types.GenerateContentConfig(
                system_instruction=_CONTENTION_PROMPT,
                temperature=0.2,
                max_output_tokens=512,
                response_mime_type="application/json",
                response_schema=_CONTENTION_SCHEMA,
            ),
        )

        result = json.loads(response.text or "{}")
        return result.get("contentions", [])

    except Exception:
        logger.exception("Contention extraction failed")
        return existing_contentions or []


async def generate_audio(text: str) -> bytes | None:
    """Generate TTS audio for the referee callout.

    Uses Charon — firm, authoritative voice for callouts.
    """
    speech_text = _clean_for_speech(text)
    if not speech_text:
        return None

    try:
        response = await _client.aio.models.generate_content(
            model=TTS_MODEL,
            contents=speech_text,
            config=genai.types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=genai.types.SpeechConfig(
                    voice_config=genai.types.VoiceConfig(
                        prebuilt_voice_config=genai.types.PrebuiltVoiceConfig(
                            voice_name="Charon",
                        )
                    )
                ),
            ),
        )

        if response.candidates:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    return part.inline_data.data

    except Exception:
        logger.exception("Referee TTS failed")

    return None
