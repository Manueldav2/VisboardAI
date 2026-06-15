"""Supabase client and helper functions for database operations."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

_url: str = os.environ["SUPABASE_URL"]
_key: str = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(_url, _key)


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------

def get_class(class_id: str) -> dict | None:
    """Fetch a single class by its ID."""
    response = supabase.table("classes").select("*").eq("id", class_id).maybe_single().execute()
    return response.data


def get_class_materials(class_id: str) -> list[dict]:
    """Return all materials associated with a class."""
    response = (
        supabase.table("course_materials")
        .select("*")
        .eq("class_id", class_id)
        .order("created_at", desc=True)
        .execute()
    )
    return response.data or []


# ---------------------------------------------------------------------------
# Materials & chunks
# ---------------------------------------------------------------------------

def store_material(material_data: dict) -> dict:
    """Insert a material record and return the created row."""
    material_data.setdefault("created_at", datetime.now(timezone.utc).isoformat())
    response = supabase.table("course_materials").insert(material_data).execute()
    return response.data[0] if response.data else {}


def store_chunks(chunks: list[dict]) -> None:
    """Bulk-insert embedding chunks.

    Each chunk dict should contain at minimum:
        material_id, class_id, content, embedding, chunk_index
    """
    if not chunks:
        return
    # Supabase supports batch inserts natively
    supabase.table("material_chunks").insert(chunks).execute()


def search_chunks(
    embedding: list[float],
    class_id: str,
    threshold: float = 0.5,
    count: int = 5,
) -> list[dict]:
    """Perform vector similarity search on material_chunks via an RPC function.

    Requires a Supabase SQL function `match_chunks` accepting:
        query_embedding vector(1536), p_class_id uuid, match_threshold float,
        match_count int
    """
    response = supabase.rpc(
        "match_material_chunks",
        {
            "query_embedding": embedding,
            "match_class_id": class_id,
            "match_threshold": threshold,
            "match_count": count,
        },
    ).execute()
    return response.data or []


# ---------------------------------------------------------------------------
# Concept mastery
# ---------------------------------------------------------------------------

def get_concept_mastery(class_id: str) -> list[dict]:
    """Return all concept mastery records for a class."""
    response = (
        supabase.table("concept_mastery")
        .select("*")
        .eq("class_id", class_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return response.data or []


def update_concept_mastery(class_id: str, concept: str, correct: bool) -> None:
    """Upsert concept mastery for a class.

    Increments total_attempts and conditionally increments correct_count.
    Uses upsert with on_conflict so a single call handles insert-or-update.
    """
    # First, try to fetch existing record
    existing = (
        supabase.table("concept_mastery")
        .select("*")
        .eq("class_id", class_id)
        .eq("concept", concept)
        .maybe_single()
        .execute()
    )

    now = datetime.now(timezone.utc).isoformat()

    if existing.data:
        total = existing.data["times_tested"] + 1
        correct_count = existing.data["times_correct"] + (1 if correct else 0)
        mastery_level = correct_count / total if total > 0 else 0.0

        supabase.table("concept_mastery").update(
            {
                "times_tested": total,
                "times_correct": correct_count,
                "mastery_level": mastery_level,
                "last_tested_at": now,
                "updated_at": now,
            }
        ).eq("id", existing.data["id"]).execute()
    else:
        supabase.table("concept_mastery").insert(
            {
                "class_id": class_id,
                "concept": concept,
                "times_tested": 1,
                "times_correct": 1 if correct else 0,
                "mastery_level": 1.0 if correct else 0.0,
                "last_tested_at": now,
                "updated_at": now,
            }
        ).execute()


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

def store_session(session_data: dict) -> dict:
    """Insert a study session record."""
    response = supabase.table("study_sessions").insert(session_data).execute()
    return response.data[0] if response.data else {}


def store_transcript(transcript_data: dict) -> None:
    """Insert a single transcript entry.

    transcript_data should contain:
        session_id, speaker ('user' | 'ai'), text, timestamp_ms
    """
    supabase.table("session_transcripts").insert(transcript_data).execute()


def store_summary(summary_data: dict) -> None:
    """Insert a session summary.

    summary_data should contain:
        session_id, class_id (optional), summary, topics_covered,
        weak_topics
    """
    supabase.table("session_summaries").insert(summary_data).execute()


# ---------------------------------------------------------------------------
# Summaries (read)
# ---------------------------------------------------------------------------

def get_recent_summaries(class_id: str, limit: int = 5) -> list[dict]:
    """Fetch the most recent session summaries for a class."""
    response = (
        supabase.table("session_summaries")
        .select("*")
        .eq("class_id", class_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return response.data or []


# ---------------------------------------------------------------------------
# Session history (read)
# ---------------------------------------------------------------------------

def get_sessions(
    tool: str | None = None,
    class_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Fetch past study sessions with optional tool/class filters."""
    query = (
        supabase.table("study_sessions")
        .select("id, user_id, class_id, mode, tool, topic, started_at, ended_at, duration_seconds, metadata")
        .order("started_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if tool:
        query = query.eq("tool", tool)
    if class_id:
        query = query.eq("class_id", class_id)
    response = query.execute()
    return response.data or []


def get_session_detail(session_id: str) -> dict | None:
    """Fetch a single session by ID."""
    response = (
        supabase.table("study_sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    return response.data[0] if response and response.data else None


def get_session_transcripts(session_id: str) -> list[dict]:
    """Fetch all transcript entries for a session, ordered by timestamp."""
    response = (
        supabase.table("session_transcripts")
        .select("id, session_id, speaker, text, timestamp_ms, metadata")
        .eq("session_id", session_id)
        .order("timestamp_ms", desc=False)
        .execute()
    )
    return response.data if response and response.data else []


def get_recent_transcript(session_id: str, limit: int = 10) -> list[dict]:
    """Fetch the most recent transcript entries for a session."""
    response = (
        supabase.table("session_transcripts")
        .select("speaker, text, timestamp_ms")
        .eq("session_id", session_id)
        .order("timestamp_ms", desc=True)
        .limit(limit)
        .execute()
    )
    entries = response.data if response and response.data else []
    entries.reverse()  # Return in chronological order
    return entries


def get_session_thought_plot(session_id: str) -> dict | None:
    """Fetch the thought plot graph data for a session."""
    response = (
        supabase.table("thought_plots")
        .select("*")
        .eq("session_id", session_id)
        .limit(1)
        .execute()
    )
    return response.data[0] if response and response.data else None


def get_session_summary(session_id: str) -> dict | None:
    """Fetch the summary for a session."""
    response = (
        supabase.table("session_summaries")
        .select("*")
        .eq("session_id", session_id)
        .limit(1)
        .execute()
    )
    return response.data[0] if response and response.data else None


# ---------------------------------------------------------------------------
# Student Profiles
# ---------------------------------------------------------------------------

def get_student_profile(user_id: str = "default") -> dict | None:
    """Fetch the student profile, creating one if it doesn't exist."""
    response = (
        supabase.table("student_profiles")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if response.data:
        return response.data[0]

    # Auto-create profile on first access
    now = datetime.now(timezone.utc).isoformat()
    create_resp = (
        supabase.table("student_profiles")
        .insert({"user_id": user_id, "created_at": now, "updated_at": now})
        .execute()
    )
    return create_resp.data[0] if create_resp.data else None


def update_student_profile(user_id: str, updates: dict) -> None:
    """Update student profile fields."""
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    supabase.table("student_profiles").update(updates).eq("user_id", user_id).execute()


def increment_study_streak(user_id: str = "default") -> None:
    """Update the study streak — increment if last study was yesterday, reset if gap."""
    from datetime import date, timedelta

    profile = get_student_profile(user_id)
    if not profile:
        return

    today = date.today()
    last_date_str = profile.get("last_study_date")

    if last_date_str:
        last_date = date.fromisoformat(str(last_date_str))
        if last_date == today:
            return  # Already studied today
        elif last_date == today - timedelta(days=1):
            new_streak = (profile.get("study_streak_days") or 0) + 1
        else:
            new_streak = 1  # Streak broken
    else:
        new_streak = 1

    update_student_profile(user_id, {
        "study_streak_days": new_streak,
        "last_study_date": today.isoformat(),
        "total_sessions": (profile.get("total_sessions") or 0) + 1,
    })
