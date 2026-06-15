"""Memory retrieval service.

Builds a rich context string for the AI agents by combining student profile,
class info, relevant material chunks, recent session summaries, concept mastery
data, and recent conversation transcript.
"""

from __future__ import annotations

import logging
from typing import Any

from services.supabase_client import (
    get_class,
    get_concept_mastery,
    get_recent_summaries,
    get_recent_transcript,
    get_student_profile,
    search_chunks,
)
from services.embeddings import create_embedding

logger = logging.getLogger(__name__)


def _build_student_briefing(profile: dict) -> str:
    """Build a concise student briefing string from profile data (~200 tokens)."""
    lines = ["## About This Student"]

    style = profile.get("learning_style", "adaptive")
    pace = profile.get("preferred_pace", "moderate")
    lines.append(f"- Learning style: {style}, {pace} pace")

    vt_ratio = profile.get("voice_vs_text_ratio", 0.5)
    if vt_ratio > 0.7:
        lines.append("- Prefers: voice interaction")
    elif vt_ratio < 0.3:
        lines.append("- Prefers: text interaction")
    else:
        lines.append("- Uses: both voice and text")

    resp_len = profile.get("avg_response_length", "medium")
    lines.append(f"- Preferred response length: {resp_len}")

    if profile.get("prefers_hints"):
        lines.append("- Appreciates hints when stuck")
    if profile.get("prefers_challenges"):
        lines.append("- Likes being challenged")

    if profile.get("personality_notes"):
        lines.append(f"- Notes: {profile['personality_notes']}")

    strongest = profile.get("strongest_topics") or []
    weakest = profile.get("weakest_topics") or []
    if strongest:
        topics = strongest[:5] if isinstance(strongest, list) else []
        if topics:
            lines.append(f"- Strong at: {', '.join(str(t) for t in topics)}")
    if weakest:
        topics = weakest[:5] if isinstance(weakest, list) else []
        if topics:
            lines.append(f"- Weak at: {', '.join(str(t) for t in topics)}")

    debate_str = profile.get("debate_strengths") or []
    debate_wk = profile.get("debate_weaknesses") or []
    if debate_str and isinstance(debate_str, list) and debate_str:
        lines.append(f"- Debate strengths: {', '.join(str(s) for s in debate_str[:3])}")
    if debate_wk and isinstance(debate_wk, list) and debate_wk:
        lines.append(f"- Debate weaknesses: {', '.join(str(w) for w in debate_wk[:3])}")

    streak = profile.get("study_streak_days", 0)
    total_mins = profile.get("total_study_minutes", 0)
    total_sess = profile.get("total_sessions", 0)
    if streak:
        lines.append(f"- Study streak: {streak} day{'s' if streak != 1 else ''}")
    if total_sess:
        lines.append(f"- Total sessions: {total_sess} ({total_mins} minutes)")

    if profile.get("last_session_summary"):
        lines.append(f"- Last session: {profile['last_session_summary']}")

    return "\n".join(lines)


async def get_session_context(
    class_id: str | None,
    mode: str,
    topic: str | None,
    session_id: str | None = None,
    user_id: str = "default",
) -> str:
    """Assemble a context string that captures everything the AI needs.

    The returned string is designed to be dropped straight into a system /
    user prompt so that the agents have full awareness of:
    - The student's profile (learning style, strengths, weaknesses)
    - The class the student is studying (if any)
    - Relevant material excerpts (retrieved via vector search)
    - Recent session summaries (for continuity across sessions)
    - Concept mastery scores (so the AI knows strengths/weaknesses)
    - Recent conversation transcript (for within-session continuity)
    """
    sections: list[str] = []

    # ------------------------------------------------------------------
    # 0. Student profile
    # ------------------------------------------------------------------
    try:
        profile = get_student_profile(user_id)
        if profile:
            sections.append(_build_student_briefing(profile))
    except Exception:
        logger.debug("Failed to load student profile (non-critical)")

    # ------------------------------------------------------------------
    # 1. Class information
    # ------------------------------------------------------------------
    class_info: dict | None = None
    if class_id:
        try:
            class_info = get_class(class_id)
        except Exception:
            logger.warning("Failed to fetch class %s", class_id, exc_info=True)

    if class_info:
        sections.append(
            f"## Class\n"
            f"Name: {class_info.get('name', 'Unknown')}\n"
            f"Description: {class_info.get('description', 'N/A')}\n"
        )

    # ------------------------------------------------------------------
    # 2. Relevant material chunks (vector search)
    # ------------------------------------------------------------------
    if class_id and topic:
        try:
            topic_embedding = await create_embedding(topic)
            chunks = search_chunks(
                embedding=topic_embedding,
                class_id=class_id,
                threshold=0.45,
                count=6,
            )
            if chunks:
                chunk_texts = [c.get("content", "") for c in chunks]
                sections.append(
                    "## Relevant Study Material\n"
                    + "\n---\n".join(chunk_texts)
                )
        except Exception:
            logger.warning(
                "Vector search failed for class=%s topic=%s",
                class_id,
                topic,
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # 3. Recent session summaries
    # ------------------------------------------------------------------
    if class_id:
        try:
            summaries = get_recent_summaries(class_id, limit=3)
            if summaries:
                summary_lines: list[str] = []
                for s in summaries:
                    summary_lines.append(
                        f"- {s.get('summary', '')}"
                    )
                sections.append(
                    "## Recent Session Summaries\n"
                    + "\n".join(summary_lines)
                )
        except Exception:
            logger.warning(
                "Failed to fetch summaries for class %s",
                class_id,
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # 4. Concept mastery
    # ------------------------------------------------------------------
    if class_id:
        try:
            mastery = get_concept_mastery(class_id)
            if mastery:
                mastery_lines: list[str] = []
                for m in mastery:
                    concept = m.get("concept", "?")
                    score = m.get("mastery_level", 0)
                    total = m.get("times_tested", 0)
                    pct = f"{score * 100:.0f}%" if isinstance(score, (int, float)) else "N/A"
                    mastery_lines.append(
                        f"- {concept}: {pct} mastery ({total} attempts)"
                    )
                sections.append(
                    "## Concept Mastery\n"
                    + "\n".join(mastery_lines)
                )
        except Exception:
            logger.warning(
                "Failed to fetch mastery for class %s",
                class_id,
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # 5. Recent conversation transcript (for continuity within session)
    # ------------------------------------------------------------------
    if session_id:
        try:
            recent = get_recent_transcript(session_id, limit=8)
            if recent:
                convo_lines: list[str] = []
                for entry in recent:
                    speaker = "Student" if entry.get("speaker") == "user" else "AI"
                    convo_lines.append(f"- {speaker}: {entry.get('text', '')}")
                sections.append(
                    "## Recent Conversation\n"
                    + "\n".join(convo_lines)
                )
        except Exception:
            logger.debug("Failed to fetch recent transcript (non-critical)")

    # ------------------------------------------------------------------
    # 6. Mode hint
    # ------------------------------------------------------------------
    sections.append(f"## Current Mode\n{mode}")

    if topic:
        sections.append(f"## Current Topic\n{topic}")

    if not sections:
        return "No additional context is available for this session."

    return "\n\n".join(sections)
