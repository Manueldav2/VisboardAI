"""Gideon Orchestrator — Agentic skill activation for the unified AI assistant.

Uses GPT-4.1-mini with function calling to contextually understand what the
user needs and activate the right skills. Unlike the simple intent classifier,
the orchestrator:
- Supports multiple simultaneous skills
- Adapts tone based on student profile and context
- Is proactive (suggests next steps, offers hints)
- Learns communication preferences
"""

from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

MODEL = "gpt-4.1-mini"

_SYSTEM_PROMPT = """You are the orchestrator for Gideon, an AI study assistant. Your job is to
understand what the student needs and activate the right skills.

Available skills:
1. **study_buddy** — Tutoring with modes: quiz, guided_study, cram, language, general
2. **thought_plot** — Always active, builds concept maps from conversation
3. **architect** — Software/system architecture planning, coding questions
4. **argument_ref** — Debate training with modes: referee (fallacy detection), harvey (aggressive debate), contention_builder (track argument structure)
5. **general** — Casual conversation, no specialized skill needed

Key rules:
- You can activate MULTIPLE skills simultaneously (e.g. quiz + thought_plot)
- thought_plot should almost always be active — it maps conversation visually
- Understand context from the full conversation, not just keywords
- If the student has been in a skill and says something ambiguous, keep the current skill
- Only deactivate skills if the student explicitly wants to change or the topic clearly shifts
- Set gideon_tone based on the situation: encouraging, patient, challenging, casual, focused

Student profile is provided. Use it to personalize:
- If they're weak at a topic and studying it → be patient and encouraging
- If they're strong and want a challenge → push harder
- If they prefer short responses → be concise
- If they use voice mostly → keep responses conversational and brief"""

_ORCHESTRATE_TOOL = {
    "type": "function",
    "function": {
        "name": "orchestrate",
        "description": "Decide which skills to activate and how Gideon should respond.",
        "parameters": {
            "type": "object",
            "properties": {
                "active_skills": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Skills to keep active. Format: 'skill_name' or 'skill_name:mode'. "
                        "Examples: ['study_buddy:quiz', 'thought_plot'], ['argument_ref:harvey', 'thought_plot'], ['general', 'thought_plot']. "
                        "thought_plot should almost always be included."
                    ),
                },
                "deactivate_skills": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Skills to deactivate. Only if explicitly no longer needed.",
                },
                "primary_skill": {
                    "type": "string",
                    "description": (
                        "The main skill for this message. One of: study_buddy, thought_plot, "
                        "architect, argument_ref, general. This determines which pipeline handles the response."
                    ),
                },
                "primary_mode": {
                    "type": "string",
                    "description": (
                        "Mode for the primary skill. "
                        "study_buddy: quiz/guided_study/cram/language/general. "
                        "argument_ref: referee/harvey/contention_builder. "
                        "Others: default."
                    ),
                },
                "gideon_tone": {
                    "type": "string",
                    "enum": ["encouraging", "patient", "challenging", "casual", "focused", "playful"],
                    "description": "Tone Gideon should use for this response.",
                },
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation of why these skills were chosen (user-facing).",
                },
                "proactive_action": {
                    "type": "string",
                    "description": (
                        "Optional proactive suggestion. "
                        "e.g. 'offer_hint', 'suggest_harder', 'suggest_break', 'suggest_topic', 'none'"
                    ),
                },
            },
            "required": [
                "active_skills",
                "primary_skill",
                "primary_mode",
                "gideon_tone",
                "reasoning",
            ],
        },
    },
}


async def orchestrate(
    text: str,
    conversation_history: list[dict] | None = None,
    student_profile: dict | None = None,
    current_skills: list[str] | None = None,
    session_duration_seconds: int = 0,
) -> dict:
    """Decide which skills to activate for the current message.

    Args:
        text: The user's latest message.
        conversation_history: Recent conversation for context.
        student_profile: Student profile dict from Supabase.
        current_skills: Currently active skills (e.g. ['study_buddy:quiz', 'thought_plot']).
        session_duration_seconds: How long the session has been going.

    Returns:
        {
            "active_skills": ["study_buddy:quiz", "thought_plot"],
            "deactivate_skills": [],
            "primary_skill": "study_buddy",
            "primary_mode": "quiz",
            "gideon_tone": "encouraging",
            "reasoning": "Student wants to be quizzed",
            "proactive_action": "none",
        }
    """
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]

    # Add student profile context
    if student_profile:
        profile_summary = _summarize_profile(student_profile)
        messages.append({
            "role": "system",
            "content": f"Student profile:\n{profile_summary}",
        })

    # Add current state
    state_parts = []
    if current_skills:
        state_parts.append(f"Currently active skills: {', '.join(current_skills)}")
    if session_duration_seconds > 0:
        mins = session_duration_seconds // 60
        state_parts.append(f"Session duration: {mins} minutes")
    if state_parts:
        messages.append({
            "role": "system",
            "content": "\n".join(state_parts),
        })

    # Add conversation context
    if conversation_history:
        for entry in conversation_history[-6:]:
            role = entry.get("role", "user")
            # Map 'model' to 'assistant' for OpenAI
            if role == "model":
                role = "assistant"
            messages.append({
                "role": role,
                "content": entry.get("text", ""),
            })

    messages.append({"role": "user", "content": text})

    try:
        response = await _client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=[_ORCHESTRATE_TOOL],
            tool_choice={
                "type": "function",
                "function": {"name": "orchestrate"},
            },
            temperature=0,
            max_tokens=256,
        )

        tool_call = response.choices[0].message.tool_calls[0]
        args = json.loads(tool_call.function.arguments)

        return {
            "active_skills": args.get("active_skills", ["general", "thought_plot"]),
            "deactivate_skills": args.get("deactivate_skills", []),
            "primary_skill": args.get("primary_skill", "general"),
            "primary_mode": args.get("primary_mode", "default"),
            "gideon_tone": args.get("gideon_tone", "casual"),
            "reasoning": args.get("reasoning", ""),
            "proactive_action": args.get("proactive_action", "none"),
        }

    except Exception:
        logger.exception("Orchestrator failed")
        return {
            "active_skills": current_skills or ["general", "thought_plot"],
            "deactivate_skills": [],
            "primary_skill": "general",
            "primary_mode": "default",
            "gideon_tone": "casual",
            "reasoning": "Continuing in current mode",
            "proactive_action": "none",
        }


def _summarize_profile(profile: dict) -> str:
    """Create a concise profile summary for the orchestrator prompt."""
    lines = []

    style = profile.get("learning_style", "adaptive")
    pace = profile.get("preferred_pace", "moderate")
    lines.append(f"Learning: {style}, {pace} pace")

    vt = profile.get("voice_vs_text_ratio", 0.5)
    if vt > 0.7:
        lines.append("Input: mostly voice")
    elif vt < 0.3:
        lines.append("Input: mostly text")

    resp = profile.get("avg_response_length", "medium")
    lines.append(f"Prefers {resp} responses")

    if profile.get("prefers_challenges"):
        lines.append("Likes challenges")
    if profile.get("prefers_hints"):
        lines.append("Appreciates hints")

    strongest = profile.get("strongest_topics") or []
    weakest = profile.get("weakest_topics") or []
    if strongest and isinstance(strongest, list):
        lines.append(f"Strong: {', '.join(str(t) for t in strongest[:3])}")
    if weakest and isinstance(weakest, list):
        lines.append(f"Weak: {', '.join(str(t) for t in weakest[:3])}")

    streak = profile.get("study_streak_days", 0)
    if streak:
        lines.append(f"Streak: {streak} days")

    return "\n".join(lines)
