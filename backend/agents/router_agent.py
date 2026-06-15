"""Agent 1 -- Decision Router.

Uses GPT-4.1-mini with function calling to decide whether the AI tutor
should respond to a given transcript chunk, and if so, what kind of
response to generate.
"""

from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from openai import AsyncOpenAI

from agents.prompts import ROUTER_PROMPTS, DEFAULT_ROUTER_PROMPT
from models.schemas import RouterDecision

load_dotenv()

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

MODEL = "gpt-4.1-mini"

# OpenAI function-calling tool definition for structured output.
_ROUTER_TOOL = {
    "type": "function",
    "function": {
        "name": "make_decision",
        "description": (
            "Decide whether the AI tutor should respond to the student's "
            "latest transcript chunk and, if so, what it should say."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "should_respond": {
                    "type": "boolean",
                    "description": (
                        "True if the AI tutor should speak now, False if it "
                        "should stay silent."
                    ),
                },
                "response_instruction": {
                    "type": "string",
                    "description": (
                        "A clear, detailed instruction for the voice agent "
                        "describing WHAT to say and WHY. Include the specific "
                        "concept, fact, or question involved. Leave empty if "
                        "should_respond is false."
                    ),
                },
                "response_type": {
                    "type": "string",
                    "enum": [
                        "correction",
                        "question",
                        "explanation",
                        "encouragement",
                        "quiz_question",
                        "silent",
                    ],
                    "description": "The category of response to generate.",
                },
                "detected_level": {
                    "type": "string",
                    "enum": ["beginner", "intermediate", "advanced"],
                    "description": (
                        "Student's detected language proficiency based on their "
                        "speech patterns. Only set in language mode. "
                        "beginner: simple vocab, short sentences, frequent errors. "
                        "intermediate: varied vocab, compound sentences, occasional errors. "
                        "advanced: complex structures, idiomatic usage, rare errors."
                    ),
                },
            },
            "required": ["should_respond", "response_instruction", "response_type"],
        },
    },
}


async def should_respond(
    transcript_chunk: str,
    mode: str,
    context: str,
    language_proficiency: str | None = None,
) -> dict:
    """Evaluate a transcript chunk and decide on the AI's next action.

    Args:
        transcript_chunk: The latest text from the student's speech.
        mode: Current study mode (determines the system prompt).
        context: Assembled session context from the memory service.
        language_proficiency: Optional proficiency info for language mode.

    Returns:
        A dict matching the RouterDecision schema:
            {
                "should_respond": bool,
                "response_instruction": str,
                "response_type": str,
                "detected_level": str | None,
            }
    """
    system_prompt = ROUTER_PROMPTS.get(mode, DEFAULT_ROUTER_PROMPT)

    user_content = f"## Session Context\n{context}\n\n"
    if language_proficiency:
        user_content += f"## Student Language Proficiency\n{language_proficiency}\n\n"
    user_content += f"## Student Transcript\n{transcript_chunk}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    try:
        response = await _client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=[_ROUTER_TOOL],
            tool_choice={"type": "function", "function": {"name": "make_decision"}},
            temperature=0.2,
            max_tokens=256,
        )

        # Extract function call arguments.
        tool_call = response.choices[0].message.tool_calls[0]
        args = json.loads(tool_call.function.arguments)

        # Validate through pydantic then return as dict.
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
