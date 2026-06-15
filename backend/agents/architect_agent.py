"""Agent 5 -- Architecture Advisor.

Conversational AI that helps users plan software architecture. Uses Gemini
with Google Search grounding for live tool pricing, then a structured JSON
call to generate panel data (stack, checklist, health, costs, decisions).
"""

from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from google import genai

from agents.prompts import ARCHITECT_SYSTEM_PROMPT, ARCHITECT_PANEL_PROMPT, ARCHITECT_RESEARCH_PROMPT

load_dotenv()

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-2.5-flash"
TTS_MODEL = "gemini-2.5-flash-preview-tts"


def _clean_for_speech(text: str) -> str:
    """Strip markdown formatting that sounds unnatural when spoken."""
    import re
    text = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)
    text = re.sub(r'^#{1,4}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(r'^[\-\*]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'\n{2,}', '. ', text)
    text = re.sub(r'\n', ' ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip().strip('"').strip("'")


# ---------------------------------------------------------------------------
# Structured output schema for panel data
# ---------------------------------------------------------------------------

_PANEL_SCHEMA = {
    "type": "object",
    "properties": {
        "stack": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "category": {"type": "string"},
                    "description": {"type": "string"},
                    "difficulty": {"type": "string", "enum": ["Easy", "Medium", "Hard"]},
                    "monthly_cost": {"type": "number"},
                    "website": {"type": "string"},
                    "reason": {"type": "string"},
                    "alternatives": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "cost_tier": {
                        "type": "string",
                        "enum": ["budget", "premium", "both"],
                    },
                    "purpose": {"type": "string"},
                },
                "required": ["id", "name", "category", "description", "difficulty", "monthly_cost", "website", "cost_tier", "purpose"],
            },
        },
        "checklist": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "category": {"type": "string"},
                    "label": {"type": "string"},
                    "discussed": {"type": "boolean"},
                },
                "required": ["id", "category", "label", "discussed"],
            },
        },
        "health": {
            "type": "object",
            "properties": {
                "scalability": {"type": "number"},
                "security": {"type": "number"},
                "cost_efficiency": {"type": "number"},
                "maintainability": {"type": "number"},
                "reliability": {"type": "number"},
            },
            "required": ["scalability", "security", "cost_efficiency", "maintainability", "reliability"],
        },
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "status": {"type": "string", "enum": ["proposed", "accepted", "rejected"]},
                    "context": {"type": "string"},
                },
                "required": ["id", "title", "status", "context"],
            },
        },
        "changelog_entry": {"type": "string"},
        "diagram_instruction": {"type": "string"},
        "review": {
            "type": "object",
            "properties": {
                "requested": {"type": "boolean"},
                "overall_score": {"type": "number"},
                "overall_grade": {"type": "string"},
                "categories": {
                    "type": "object",
                    "properties": {
                        "scalability": {
                            "type": "object",
                            "properties": {
                                "score": {"type": "number"},
                                "grade": {"type": "string"},
                                "reasoning": {"type": "string"},
                            },
                            "required": ["score", "grade", "reasoning"],
                        },
                        "security": {
                            "type": "object",
                            "properties": {
                                "score": {"type": "number"},
                                "grade": {"type": "string"},
                                "reasoning": {"type": "string"},
                            },
                            "required": ["score", "grade", "reasoning"],
                        },
                        "cost_efficiency": {
                            "type": "object",
                            "properties": {
                                "score": {"type": "number"},
                                "grade": {"type": "string"},
                                "reasoning": {"type": "string"},
                            },
                            "required": ["score", "grade", "reasoning"],
                        },
                        "maintainability": {
                            "type": "object",
                            "properties": {
                                "score": {"type": "number"},
                                "grade": {"type": "string"},
                                "reasoning": {"type": "string"},
                            },
                            "required": ["score", "grade", "reasoning"],
                        },
                        "reliability": {
                            "type": "object",
                            "properties": {
                                "score": {"type": "number"},
                                "grade": {"type": "string"},
                                "reasoning": {"type": "string"},
                            },
                            "required": ["score", "grade", "reasoning"],
                        },
                        "developer_experience": {
                            "type": "object",
                            "properties": {
                                "score": {"type": "number"},
                                "grade": {"type": "string"},
                                "reasoning": {"type": "string"},
                            },
                            "required": ["score", "grade", "reasoning"],
                        },
                    },
                    "required": ["scalability", "security", "cost_efficiency", "maintainability", "reliability", "developer_experience"],
                },
                "strengths": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                        },
                        "required": ["title", "description"],
                    },
                },
                "weaknesses": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "anti_pattern": {"type": "string"},
                        },
                        "required": ["title", "description", "anti_pattern"],
                    },
                },
                "recommendations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "impact": {"type": "string", "enum": ["critical", "high", "medium", "low"]},
                            "effort": {"type": "string", "enum": ["easy", "medium", "hard"]},
                        },
                        "required": ["title", "description", "impact", "effort"],
                    },
                },
                "breaking_point": {
                    "type": "object",
                    "properties": {
                        "component": {"type": "string"},
                        "scenario": {"type": "string"},
                        "estimated_load": {"type": "string"},
                        "mitigation": {"type": "string"},
                    },
                    "required": ["component", "scenario", "estimated_load", "mitigation"],
                },
            },
            "required": ["requested", "overall_score", "overall_grade", "categories", "strengths", "weaknesses", "recommendations", "breaking_point"],
        },
    },
    "required": ["stack", "checklist", "health", "decisions", "changelog_entry", "diagram_instruction", "review"],
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _build_contents(conversation_history: list[dict], message: str) -> list:
    """Build Gemini Content objects from conversation history + new message."""
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
            parts=[genai.types.Part(text=message)],
        )
    )
    return contents


async def generate_chat(
    message: str,
    conversation_history: list[dict],
) -> dict:
    """Agent A: Fast conversational response (no grounding, ~500ms).

    Returns:
        {"text": str, "suggestions": list, "option_cards": list}
    """
    contents = _build_contents(conversation_history, message)

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=contents,
            config=genai.types.GenerateContentConfig(
                system_instruction=ARCHITECT_SYSTEM_PROMPT,
                temperature=0.7,
                max_output_tokens=512,
            ),
        )

        raw_text = response.text or ""
        parsed = _try_parse_chat_response(raw_text)
        return {
            "text": parsed.get("text", raw_text),
            "suggestions": parsed.get("suggestions", [])[:3],
            "option_cards": parsed.get("option_cards", [])[:4],
        }

    except Exception:
        logger.exception("Architect chat call failed")
        return {
            "text": "I'd love to help you plan your architecture! Could you tell me more about what you're building?",
            "suggestions": [],
            "option_cards": [],
        }


async def generate_research(
    message: str,
    conversation_history: list[dict],
) -> str:
    """Agent B: Google Search grounded research for pricing, best practices (~2s).

    Returns research text for consumption by the panel agent.
    """
    contents = _build_contents(conversation_history, message)

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=contents,
            config=genai.types.GenerateContentConfig(
                system_instruction=ARCHITECT_RESEARCH_PROMPT,
                temperature=0.3,
                max_output_tokens=2048,
                tools=[genai.types.Tool(google_search=genai.types.GoogleSearch())],
            ),
        )
        return response.text or ""

    except Exception:
        logger.exception("Architect research call failed")
        return ""


async def generate_panel(
    conversation_history: list[dict],
    message: str,
    chat_text: str,
    research_text: str,
) -> dict:
    """Agent C: Structured panel data extraction (~2-3s).

    Returns panel dict matching _PANEL_SCHEMA.
    """
    conv_summary = _build_conversation_summary(
        conversation_history, message, chat_text
    )
    if research_text:
        conv_summary += f"\n\n## Research Findings\n{research_text}\n"

    default_panel: dict = {
        "stack": [],
        "checklist": _default_checklist(),
        "health": {"scalability": 1, "security": 1, "cost_efficiency": 1, "maintainability": 1, "reliability": 1},
        "decisions": [],
        "changelog_entry": "",
        "diagram_instruction": "",
        "review": _default_review(),
    }

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=conv_summary,
            config=genai.types.GenerateContentConfig(
                system_instruction=ARCHITECT_PANEL_PROMPT,
                temperature=0.2,
                max_output_tokens=8192,
                response_mime_type="application/json",
                response_schema=_PANEL_SCHEMA,
            ),
        )

        panel_text = response.text or "{}"
        return json.loads(panel_text)

    except Exception:
        logger.exception("Architect panel call failed")
        return default_panel


async def generate_audio(text: str) -> bytes | None:
    """Generate TTS audio for the architect response."""
    # Clean markdown for natural speech
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
                            voice_name="Aoede",
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
        logger.exception("Architect TTS failed")

    return None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _try_parse_chat_response(text: str) -> dict:
    """Try to parse the grounded response as JSON with text/suggestions/option_cards.

    With grounding enabled, Gemini may not return valid JSON. Fall back to
    treating the whole response as plain text.
    """
    # Try to find JSON block in the response
    text = text.strip()

    # Try direct JSON parse
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "text" in parsed:
            return parsed
    except (json.JSONDecodeError, ValueError):
        pass

    # Try to extract JSON from markdown code block
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.index("```", start) if "```" in text[start:] else len(text)
        try:
            return json.loads(text[start:end].strip())
        except (json.JSONDecodeError, ValueError):
            pass

    # Not JSON — extract suggestions from bullet points at the end
    suggestions = []
    lines = text.strip().split("\n")
    # Look for numbered suggestions at the bottom
    clean_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and stripped[0].isdigit() and ". " in stripped:
            # Could be a suggestion
            suggestion_text = stripped.split(". ", 1)[1] if ". " in stripped else stripped
            if len(suggestion_text) < 80:
                suggestions.append(suggestion_text)
            else:
                clean_lines.append(line)
        else:
            clean_lines.append(line)

    return {
        "text": "\n".join(clean_lines).strip() if clean_lines else text,
        "suggestions": suggestions[:3],
        "option_cards": [],
    }


def _build_conversation_summary(
    history: list[dict],
    latest_message: str,
    latest_response: str,
) -> str:
    """Build a summary of the conversation for the panel extraction call."""
    parts = ["## Full Architecture Conversation\n"]

    for entry in history:
        role_label = "USER" if entry["role"] == "user" else "ARCHITECT"
        parts.append(f"**{role_label}:** {entry['text']}\n")

    parts.append(f"**USER:** {latest_message}\n")
    parts.append(f"**ARCHITECT:** {latest_response}\n")

    return "\n".join(parts)


def _default_review() -> dict:
    """Return a default empty review (not requested)."""
    empty_cat = {"score": 0, "grade": "", "reasoning": ""}
    return {
        "requested": False,
        "overall_score": 0,
        "overall_grade": "",
        "categories": {
            "scalability": {**empty_cat},
            "security": {**empty_cat},
            "cost_efficiency": {**empty_cat},
            "maintainability": {**empty_cat},
            "reliability": {**empty_cat},
            "developer_experience": {**empty_cat},
        },
        "strengths": [],
        "weaknesses": [],
        "recommendations": [],
        "breaking_point": {"component": "", "scenario": "", "estimated_load": "", "mitigation": ""},
    }


def _default_checklist() -> list[dict]:
    """Return the default architecture checklist items."""
    items = [
        ("security", "Authentication"),
        ("security", "Rate limiting"),
        ("infrastructure", "Database"),
        ("reliability", "Caching"),
        ("reliability", "Error handling"),
        ("devops", "CI/CD"),
        ("devops", "Monitoring"),
        ("devops", "Logging"),
    ]
    return [
        {
            "id": f"chk_{cat}_{label.lower().replace(' ', '_')}",
            "category": cat.title(),
            "label": label,
            "discussed": False,
        }
        for cat, label in items
    ]
