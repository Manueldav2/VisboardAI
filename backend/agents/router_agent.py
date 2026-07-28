"""Agent 1 -- Decision Router.

Uses Gemini 2.5 Flash with structured JSON output to decide whether the AI
tutor should respond to a given transcript chunk, and if so, what kind of
response to generate.
"""

from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from google import genai

from agents.prompts import ROUTER_PROMPTS, DEFAULT_ROUTER_PROMPT
from models.schemas import RouterDecision

load_dotenv()

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-2.5-flash"

_ROUTER_SCHEMA = {
    "type": "object",
    "properties": {
        "should_respond": {
            "type": "boolean",
            "description": "True if the AI tutor should speak now, False to stay silent.",
        },
        "response_instruction": {
            "type": "string",
            "description": (
                "A clear instruction for the voice agent describing WHAT to say "
                "and WHY (specific concept, fact, or question). Empty if silent."
            ),
        },
        "response_type": {
            "type": "string",
            "enum": ["correction", "question", "explanation", "encouragement", "quiz_question", "silent"],
            "description": "The category of response to generate.",
        },
        "detected_level": {
            "type": "string",
            "enum": ["beginner", "intermediate", "advanced"],
            "description": "Student's detected proficiency (language mode only).",
        },
    },
    "required": ["should_respond", "response_instruction", "response_type"],
}


async def should_respond(
    transcript_chunk: str,
    mode: str,
    context: str,
    language_proficiency: str | None = None,
) -> dict:
    """Evaluate a transcript chunk and decide on the AI's next action.

    Returns a dict matching the RouterDecision schema.
    """
    system_prompt = ROUTER_PROMPTS.get(mode, DEFAULT_ROUTER_PROMPT)

    user_content = f"## Session Context\n{context}\n\n"
    if language_proficiency:
        user_content += f"## Student Language Proficiency\n{language_proficiency}\n\n"
    user_content += (
        f"## Student Transcript\n{transcript_chunk}\n\n"
        "Decide whether to respond now and, if so, what to say. Respond with JSON."
    )

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=user_content,
            config=genai.types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.2,
                max_output_tokens=512,
                thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
                response_mime_type="application/json",
                response_schema=_ROUTER_SCHEMA,
            ),
        )

        text = response.text
        if not text:
            raise ValueError("empty router response")

        args = json.loads(text)
        decision = RouterDecision(**args)
        return decision.model_dump()

    except Exception:
        logger.exception("Router agent failed for mode=%s", mode)
        # Fail-safe: stay silent so the student isn't interrupted by an error.
        return RouterDecision(
            should_respond=False,
            response_instruction="",
            response_type="silent",
        ).model_dump()
