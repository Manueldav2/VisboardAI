"""Post-Session Agent — runs on session end to summarize and update profile.

After a WebSocket session disconnects, this agent:
1. Summarizes the conversation (topics covered, weak spots, key moments)
2. Updates the student profile (learning preferences, topic mastery, voice/text ratio)
3. Stores the summary in session_summaries table
4. Updates session end time and duration
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from google import genai

load_dotenv()

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-2.5-flash"

_SYSTEM_PROMPT = """You are a post-session analyst for Gideon, an AI study assistant.
Analyze the session transcript and produce a structured summary.

For the summary:
- What topics were covered?
- What areas was the student weak in?
- What went well?
- Key moments (breakthroughs, confusion points)

For profile updates, detect:
- Learning style signals (visual, auditory, reading/writing, kinesthetic)
- Pace preference (fast, moderate, slow) — based on how quickly they move through topics
- Response length preference (short, medium, long) — based on their message lengths
- Whether they like challenges or prefer hints
- Topics they seem strong or weak at
- For debate sessions: techniques used well, techniques to improve
- Personality notes (humor style, communication patterns)

IMPORTANT: Only return profile updates you have STRONG evidence for from this session.
Do not guess or extrapolate from a single data point."""

_ANALYZE_TOOL = {
    "type": "function",
    "function": {
        "name": "session_analysis",
        "description": "Analyze the session and return structured results.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "2-3 sentence summary of the session.",
                },
                "topics_covered": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of topics discussed.",
                },
                "weak_topics": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Topics the student struggled with.",
                },
                "strong_topics": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Topics the student showed strength in.",
                },
                "profile_updates": {
                    "type": "object",
                    "properties": {
                        "learning_style": {
                            "type": "string",
                            "enum": ["visual", "auditory", "reading_writing", "kinesthetic", "adaptive"],
                            "description": "Only set if clearly evidenced.",
                        },
                        "preferred_pace": {
                            "type": "string",
                            "enum": ["fast", "moderate", "slow"],
                            "description": "Only set if clearly evidenced.",
                        },
                        "avg_response_length": {
                            "type": "string",
                            "enum": ["short", "medium", "long"],
                            "description": "Based on student's typical message length.",
                        },
                        "prefers_hints": {
                            "type": "boolean",
                            "description": "True if student asked for/responded well to hints.",
                        },
                        "prefers_challenges": {
                            "type": "boolean",
                            "description": "True if student sought or enjoyed challenges.",
                        },
                        "personality_notes": {
                            "type": "string",
                            "description": "Brief personality/communication style note.",
                        },
                        "debate_strengths": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Debate techniques used well (debate sessions only).",
                        },
                        "debate_weaknesses": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Debate areas to improve (debate sessions only).",
                        },
                    },
                    "description": "Profile fields to update. Only include fields with strong evidence.",
                },
            },
            "required": ["summary", "topics_covered", "weak_topics"],
        },
    },
}


async def analyze_session(
    conversation_history: list[dict],
    tool: str = "general_chat",
    mode: str = "general",
    class_id: str | None = None,
    duration_seconds: int = 0,
) -> dict:
    """Analyze a completed session and return summary + profile updates.

    Args:
        conversation_history: The full conversation from the session.
        tool: Which tool was primarily used.
        mode: Which mode was active.
        class_id: Associated class ID if any.
        duration_seconds: Session duration in seconds.

    Returns:
        {
            "summary": str,
            "topics_covered": list[str],
            "weak_topics": list[str],
            "strong_topics": list[str],
            "profile_updates": dict,
        }
    """
    if not conversation_history or len(conversation_history) < 2:
        return {
            "summary": "Session too short to analyze.",
            "topics_covered": [],
            "weak_topics": [],
            "strong_topics": [],
            "profile_updates": {},
        }

    context_parts = [f"Tool: {tool}, Mode: {mode}", f"Duration: {duration_seconds // 60} minutes"]
    if class_id:
        context_parts.append(f"Class ID: {class_id}")

    convo = ""
    for entry in conversation_history[-40:]:
        who = "Student" if entry.get("role", "user") == "user" else "Gideon"
        convo += f"{who}: {entry.get('text', '')}\n"

    user_content = (
        "Session context:\n" + "\n".join(context_parts)
        + f"\n\n## Transcript\n{convo}\n\nThe session has ended. Analyze it and respond with JSON."
    )

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=user_content,
            config=genai.types.GenerateContentConfig(
                system_instruction=_SYSTEM_PROMPT,
                temperature=0.2,
                max_output_tokens=1024,
                thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
                response_mime_type="application/json",
                response_schema=_ANALYZE_TOOL["function"]["parameters"],
            ),
        )
        args = json.loads(response.text or "{}")

        return {
            "summary": args.get("summary", ""),
            "topics_covered": args.get("topics_covered", []),
            "weak_topics": args.get("weak_topics", []),
            "strong_topics": args.get("strong_topics", []),
            "profile_updates": args.get("profile_updates", {}),
        }

    except Exception:
        logger.exception("Post-session analysis failed")
        return {
            "summary": "Session analysis could not be completed.",
            "topics_covered": [],
            "weak_topics": [],
            "strong_topics": [],
            "profile_updates": {},
        }
