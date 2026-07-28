"""Intent Classifier — Routes general chat to the right tool/mode.

Uses GPT-4.1-mini with function calling to detect user intent and suggest
the best tool (study_buddy, thought_plot, architect, argument_ref) and
mode for handling the request.
"""

from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from google import genai

load_dotenv()

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-2.5-flash"

_SYSTEM_PROMPT = """You are an intent classifier for an AI study platform called VisboardAI.
The platform has these tools:

1. **study_buddy** — Voice-powered tutoring with modes:
   - quiz: Test knowledge with Q&A
   - guided_study: Step-by-step concept explanations
   - cram: Fast exam review
   - language: Language practice
   - strategy: Exam strategies and tips
   - general: Open conversation about any topic

2. **thought_plot** — Visual knowledge mapping, creates diagrams of concepts with modes:
   - general: Free-form concept mapping
   - topic_locked: Focused on one topic
   - class_mode: Uses class materials
   - study: Study with visual relationships
   - quiz: Quiz with visual answers

3. **architect** — Software architecture planner:
   - Helps plan tech stacks, system designs, app architecture
   - Provides cost analysis, health scores, checklists

4. **argument_ref** — Debate training and argument analysis:
   - referee: Live fallacy detection
   - harvey: Aggressive opposing counsel (Harvey Specter mode)
   - analyze: Paste arguments to get coached

Classify the user's message into the best tool and mode. If the message is just
casual conversation or doesn't clearly match any tool, use tool="general" to keep
it in the general chat.

Be decisive — if there's even a moderate signal, suggest the specialized tool."""

_INTENT_SCHEMA = {
    "type": "object",
    "properties": {
        "tool": {
            "type": "string",
            "enum": ["study_buddy", "thought_plot", "architect", "argument_ref", "general"],
            "description": "The best tool to handle this request.",
        },
        "mode": {
            "type": "string",
            "description": (
                "The specific mode within the tool. "
                "study_buddy: quiz, guided_study, cram, language, strategy, general. "
                "thought_plot: general, topic_locked, class_mode, study, quiz. "
                "architect: default. argument_ref: referee, harvey, analyze. general: default."
            ),
        },
        "confidence": {"type": "number", "description": "Confidence 0-1."},
        "reason": {"type": "string", "description": "Brief user-friendly explanation of the fit."},
    },
    "required": ["tool", "mode", "confidence", "reason"],
}


async def classify_intent(
    text: str,
    conversation_history: list[dict] | None = None,
) -> dict:
    """Classify user intent and suggest the best tool/mode.

    Args:
        text: The user's latest message.
        conversation_history: Optional recent conversation for context.

    Returns:
        {
            "tool": str,
            "mode": str,
            "confidence": float,
            "reason": str,
        }
    """
    convo = ""
    if conversation_history:
        for entry in conversation_history[-4:]:
            who = "Student" if entry.get("role", "user") == "user" else "Gideon"
            convo += f"{who}: {entry.get('text', '')}\n"

    user_content = (
        (f"## Recent conversation\n{convo}\n" if convo else "")
        + f"## Latest message\n{text}\n\nClassify into the best tool and mode. Respond with JSON."
    )

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=user_content,
            config=genai.types.GenerateContentConfig(
                system_instruction=_SYSTEM_PROMPT,
                temperature=0,
                max_output_tokens=256,
                thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
                response_mime_type="application/json",
                response_schema=_INTENT_SCHEMA,
            ),
        )
        args = json.loads(response.text or "{}")
        return {
            "tool": args.get("tool", "general"),
            "mode": args.get("mode", "default"),
            "confidence": args.get("confidence", 0.5),
            "reason": args.get("reason", ""),
        }

    except Exception:
        logger.exception("Intent classification failed")
        return {
            "tool": "general",
            "mode": "default",
            "confidence": 0.0,
            "reason": "Classification unavailable",
        }
