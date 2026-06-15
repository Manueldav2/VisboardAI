"""Debate Coach Agent — comprehensive argument analysis and coaching.

Analyzes pasted arguments/debate transcripts for structure, technique,
fallacies, and provides actionable coaching on how to win.
Uses Google Search grounding for evidence verification.
"""

from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from google import genai

from agents.prompts import DEBATE_COACH_PROMPT

load_dotenv()

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-2.5-flash"


# ---------------------------------------------------------------------------
# Structured output schema for debate analysis
# ---------------------------------------------------------------------------

_DEBATE_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "overall_grade": {
            "type": "string",
            "description": "Letter grade A+ through F",
        },
        "overall_score": {
            "type": "number",
            "description": "Numeric score 0-100",
        },
        "summary": {
            "type": "string",
            "description": "2-3 sentence overview of argument quality",
        },
        "argument_structure": {
            "type": "object",
            "properties": {
                "thesis": {
                    "type": "string",
                    "description": "The main claim or position being argued",
                },
                "contentions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "text": {
                                "type": "string",
                                "description": "The supporting point",
                            },
                            "strength": {
                                "type": "string",
                                "enum": ["strong", "moderate", "weak"],
                            },
                            "evidence_quality": {
                                "type": "string",
                                "enum": ["strong", "moderate", "weak", "missing"],
                            },
                            "evidence_cited": {
                                "type": "string",
                                "description": "What evidence was given",
                            },
                            "evidence_needed": {
                                "type": "string",
                                "description": "What evidence would strengthen this",
                            },
                            "logical_connection": {
                                "type": "string",
                                "description": "How well this supports the thesis",
                            },
                        },
                        "required": [
                            "id",
                            "text",
                            "strength",
                            "evidence_quality",
                        ],
                    },
                },
                "rebuttals_addressed": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Counter-arguments that were addressed",
                },
                "rebuttals_missing": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Counter-arguments that should have been addressed",
                },
            },
            "required": ["thesis", "contentions"],
        },
        "techniques_used": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "quality": {
                        "type": "string",
                        "enum": ["effective", "weak", "misapplied"],
                    },
                    "where": {
                        "type": "string",
                        "description": "Quote from the text",
                    },
                    "feedback": {
                        "type": "string",
                        "description": "Why it was effective/weak/misapplied",
                    },
                },
                "required": ["name", "quality", "where", "feedback"],
            },
        },
        "techniques_missing": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "why_needed": {
                        "type": "string",
                        "description": "Why this technique would strengthen the argument",
                    },
                    "example": {
                        "type": "string",
                        "description": "Specific example of how to apply it here",
                    },
                },
                "required": ["name", "why_needed", "example"],
            },
        },
        "fallacies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "category": {
                        "type": "string",
                        "enum": [
                            "Formal",
                            "Relevance",
                            "Presumption",
                            "Ambiguity",
                            "Bad Faith",
                            "Factual Error",
                        ],
                    },
                    "what_was_said": {"type": "string"},
                    "why_its_wrong": {"type": "string"},
                    "correct_form": {"type": "string"},
                    "severity": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                    },
                },
                "required": [
                    "name",
                    "category",
                    "what_was_said",
                    "why_its_wrong",
                    "correct_form",
                    "severity",
                ],
            },
        },
        "how_to_win": {
            "type": "object",
            "properties": {
                "strongest_points": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Best arguments to lead with",
                },
                "weakest_links": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Arguments your opponent will attack",
                },
                "missing_evidence": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Research these to strengthen your case",
                },
                "rewrite_suggestions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "original": {"type": "string"},
                            "improved": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": ["original", "improved", "reason"],
                    },
                },
                "opponent_likely_attacks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "attack": {
                                "type": "string",
                                "description": "What the opponent will say",
                            },
                            "counter": {
                                "type": "string",
                                "description": "How to respond",
                            },
                        },
                        "required": ["attack", "counter"],
                    },
                },
            },
            "required": [
                "strongest_points",
                "weakest_links",
                "missing_evidence",
                "rewrite_suggestions",
                "opponent_likely_attacks",
            ],
        },
    },
    "required": [
        "overall_grade",
        "overall_score",
        "summary",
        "argument_structure",
        "techniques_used",
        "techniques_missing",
        "fallacies",
        "how_to_win",
    ],
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def analyze_argument(
    argument_text: str,
    context: str = "",
) -> dict:
    """Comprehensive debate analysis of a pasted argument.

    Args:
        argument_text: The full argument or debate transcript to analyze.
        context: Optional context (topic, opposing position, etc.).

    Returns:
        Full structured analysis dict matching _DEBATE_ANALYSIS_SCHEMA.
    """
    prompt = argument_text
    if context:
        prompt = f"DEBATE CONTEXT: {context}\n\nARGUMENT TO ANALYZE:\n{argument_text}"

    contents = [
        genai.types.Content(
            role="user",
            parts=[genai.types.Part(text=prompt)],
        )
    ]

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=contents,
            config=genai.types.GenerateContentConfig(
                system_instruction=DEBATE_COACH_PROMPT,
                temperature=0.3,
                max_output_tokens=4096,
                response_mime_type="application/json",
                response_schema=_DEBATE_ANALYSIS_SCHEMA,
                tools=[genai.types.Tool(google_search=genai.types.GoogleSearch())],
            ),
        )

        result = json.loads(response.text or "{}")
        return result

    except Exception:
        logger.exception("Debate coach analysis failed")
        return {
            "overall_grade": "?",
            "overall_score": 0,
            "summary": "Analysis failed — please try again.",
            "argument_structure": {
                "thesis": "",
                "contentions": [],
                "rebuttals_addressed": [],
                "rebuttals_missing": [],
            },
            "techniques_used": [],
            "techniques_missing": [],
            "fallacies": [],
            "how_to_win": {
                "strongest_points": [],
                "weakest_links": [],
                "missing_evidence": [],
                "rewrite_suggestions": [],
                "opponent_likely_attacks": [],
            },
        }
