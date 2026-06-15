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
from openai import AsyncOpenAI

load_dotenv()

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

MODEL = "gpt-4.1-mini"

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

    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]

    # Build context
    context_parts = [
        f"Tool: {tool}, Mode: {mode}",
        f"Duration: {duration_seconds // 60} minutes",
    ]
    if class_id:
        context_parts.append(f"Class ID: {class_id}")
    messages.append({
        "role": "system",
        "content": "Session context:\n" + "\n".join(context_parts),
    })

    # Add conversation (cap at last 40 turns for token efficiency)
    for entry in conversation_history[-40:]:
        role = entry.get("role", "user")
        if role == "model":
            role = "assistant"
        messages.append({
            "role": role,
            "content": entry.get("text", ""),
        })

    messages.append({
        "role": "user",
        "content": "The session has ended. Analyze the conversation and provide your assessment.",
    })

    try:
        response = await _client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=[_ANALYZE_TOOL],
            tool_choice={
                "type": "function",
                "function": {"name": "session_analysis"},
            },
            temperature=0.2,
            max_tokens=512,
        )

        tool_call = response.choices[0].message.tool_calls[0]
        args = json.loads(tool_call.function.arguments)

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
