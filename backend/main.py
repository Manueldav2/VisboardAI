"""FastAPI backend for the Thought Plot study platform.

Provides REST endpoints for material upload, embedding, search, and
session summarization, plus a WebSocket endpoint for real-time study
sessions orchestrating three AI agents concurrently.

Thought Plot agent pipeline
---------------------------
Every transcript chunk goes through a 3-agent pipeline:

1. **Plotter Agent** — ALWAYS runs.  Decomposes what the student said into
   visual nodes/edges and returns a Mermaid diagram update.
2. **Router Agent** — Evaluates whether the student needs a voice
   intervention (fact-check, correction, encouragement) and explains WHY.
3. **Voice Agent** — Only fires when the Router says "speak up".
   Generates a brief spoken response (with Gemini TTS audio when available)
   that can interrupt the student mid-speech.

For the Study Buddy tool the same pipeline runs but with study-mode-specific
prompts instead of the thought-plot fact-checking prompts.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from agents import router_agent, voice_agent, plotter_agent, fact_checker_agent, architect_agent, referee_agent, debate_coach_agent, intent_classifier
from agents import orchestrator as gideon_orchestrator
from agents import post_session_agent
from agents.fact_checker_agent import ClaimRegistry
from models.schemas import MaterialUpload, TranscriptChunk
from services.embeddings import create_embedding, create_embeddings_batch
from services.memory import get_session_context
from services.pdf_parser import chunk_text, extract_text_from_pdf
from services.supabase_client import (
    get_class,
    get_class_materials,
    get_student_profile,
    increment_study_streak,
    search_chunks,
    store_chunks,
    store_material,
    store_session,
    store_summary,
    store_transcript,
    update_student_profile,
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Thought Plot Backend",
    version="1.0.0",
    description="Real-time AI study platform backend",
)

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://localhost:3002",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===================================================================
# Health check
# ===================================================================

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


# ===================================================================
# POST /api/upload-material
# ===================================================================

@app.post("/api/upload-material")
async def upload_material(
    class_id: str = Form(...),
    title: str = Form(...),
    type: str = Form("text"),
    text: str | None = Form(None),
    file: UploadFile | None = File(None),
):
    """Upload study material (PDF file or raw text)."""
    raw_text: str = ""

    if file and type == "pdf":
        file_bytes = await file.read()
        raw_text = extract_text_from_pdf(file_bytes)
        if not raw_text.strip():
            return {"error": "Could not extract text from PDF"}, 400
    elif text:
        raw_text = text
    else:
        return {"error": "Provide either a PDF file or text content"}, 400

    material_record = store_material(
        {
            "class_id": class_id,
            "title": title,
            "type": type,
            "raw_text": raw_text[:50_000],
        }
    )
    material_id = material_record.get("id")
    if not material_id:
        return {"error": "Failed to store material record"}, 500

    chunks = chunk_text(raw_text, chunk_size=500, overlap=50)
    if not chunks:
        return {"error": "No text chunks produced"}, 400

    embeddings = await create_embeddings_batch(chunks)

    chunk_records = [
        {
            "material_id": material_id,
            "class_id": class_id,
            "content": chunk,
            "embedding": embedding,
            "chunk_index": idx,
        }
        for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings))
    ]
    store_chunks(chunk_records)

    return {
        "material_id": material_id,
        "title": title,
        "chunks_created": len(chunk_records),
    }


# ===================================================================
# POST /api/embed-text
# ===================================================================

class EmbedTextRequest(BaseModel):
    text: str


@app.post("/api/embed-text")
async def embed_text(req: EmbedTextRequest):
    embedding = await create_embedding(req.text)
    return {"embedding": embedding, "dimensions": len(embedding)}


# ===================================================================
# POST /api/search-materials
# ===================================================================

class SearchRequest(BaseModel):
    query: str
    class_id: str
    threshold: float = 0.5
    count: int = 5


@app.post("/api/search-materials")
async def search_materials(req: SearchRequest):
    query_embedding = await create_embedding(req.query)
    results = search_chunks(
        embedding=query_embedding,
        class_id=req.class_id,
        threshold=req.threshold,
        count=req.count,
    )
    return {"results": results, "count": len(results)}


# ===================================================================
# POST /api/summarize-session
# ===================================================================

class SummarizeRequest(BaseModel):
    session_id: str
    class_id: str | None = None
    transcript_text: str


@app.post("/api/summarize-session")
async def summarize_session(req: SummarizeRequest):
    from google import genai
    import os

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    prompt = (
        "You are an expert study assistant. Summarize the following study "
        "session transcript. Include:\n"
        "1. A concise summary (2-3 sentences)\n"
        "2. Key concepts discussed (as a JSON array of strings)\n"
        "3. Areas the student should review (as a JSON array of strings)\n\n"
        "Respond in JSON format with keys: summary_text, key_concepts, "
        "areas_for_review.\n\n"
        f"## Transcript\n{req.transcript_text[:10_000]}"
    )

    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=1024,
                response_mime_type="application/json",
                response_schema={
                    "type": "object",
                    "properties": {
                        "summary_text": {"type": "string"},
                        "key_concepts": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "areas_for_review": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["summary_text", "key_concepts", "areas_for_review"],
                },
            ),
        )

        data = json.loads(response.text)

        summary_record = {
            "session_id": req.session_id,
            "summary": data.get("summary_text", ""),
            "topics_covered": data.get("key_concepts", []),
            "weak_topics": data.get("areas_for_review", []),
        }
        if req.class_id:
            summary_record["class_id"] = req.class_id

        store_summary(summary_record)

        return {"summary": data}

    except Exception:
        logger.exception("Failed to summarize session %s", req.session_id)
        return {"error": "Failed to generate summary"}, 500


# ===================================================================
# GET /api/sessions — list past sessions
# ===================================================================

@app.get("/api/sessions")
async def list_sessions(
    tool: str | None = None,
    class_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    """List past study sessions with optional filtering."""
    from services.supabase_client import get_sessions
    sessions = get_sessions(tool=tool, class_id=class_id, limit=limit, offset=offset)
    return {"sessions": sessions, "count": len(sessions)}


# ===================================================================
# GET /api/sessions/{session_id} — full session detail
# ===================================================================

@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    """Get a session's full detail including transcript and optional graph/summary."""
    from services.supabase_client import (
        get_session_detail,
        get_session_transcripts,
        get_session_thought_plot,
        get_session_summary,
    )
    from fastapi import HTTPException

    session = get_session_detail(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    transcript = get_session_transcripts(session_id)
    summary = get_session_summary(session_id)
    thought_plot = get_session_thought_plot(session_id)

    return {
        "session": session,
        "transcript": transcript,
        "summary": summary,
        "thought_plot": thought_plot,
    }


# ===================================================================
# POST /api/realtime/session  —  OpenAI Realtime ephemeral token
# ===================================================================

class RealtimeSessionRequest(BaseModel):
    voice: str = "sage"
    tool: str | None = None
    mode: str = "general"


@app.post("/api/realtime/session")
async def create_realtime_session(req: RealtimeSessionRequest):
    """Create an ephemeral token for the OpenAI Realtime API.

    The frontend uses this short-lived token (1-min TTL) to establish a
    direct WebRTC connection with OpenAI — our API key never leaves the server.
    """
    import httpx

    system_prompt = _build_realtime_system_prompt(req.tool, req.mode)
    tools = _build_realtime_tools()

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.openai.com/v1/realtime/sessions",
            headers={
                "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-realtime-preview",
                "voice": req.voice,
                "instructions": system_prompt,
                "tools": tools,
                "input_audio_transcription": {"model": "whisper-1"},
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.7,
                    "prefix_padding_ms": 500,
                    "silence_duration_ms": 800,
                },
            },
            timeout=10.0,
        )

        if resp.status_code != 200:
            logger.error("Realtime session creation failed: %s", resp.text)
            return {"error": "Failed to create realtime session"}

        data = resp.json()
        return {
            "client_secret": data["client_secret"]["value"],
            "expires_at": data["client_secret"]["expires_at"],
        }


# ===================================================================
# WebSocket /ws/study-session
# ===================================================================

@app.websocket("/ws/study-session")
async def study_session_ws(websocket: WebSocket):
    """Real-time study session handler.

    Protocol
    --------
    Client sends JSON messages:
        # Full transcript chunk — triggers plotter + router + voice
        { "type": "transcript", "text": "...", "mode": "quiz",
          "class_id": "...", "topic": "...", "tool": "thought_plot" }

        # Interim text — lightweight router-only check for interruption
        { "type": "interim", "text": "...", "mode": "general",
          "tool": "thought_plot" }

    Server sends JSON messages:
        { "type": "ai_response", "text": "...", "should_speak": true,
          "is_interrupt": true/false, "audio_data": "...",
          "audio_format": "pcm", "audio_sample_rate": 24000 }
        { "type": "plot_update", "graph": { ..., "mermaid_code": "..." } }
        { "type": "fact_check", "id": "...", "claim": "...",
          "status": "incorrect|assumption", "confidence": 0.9,
          "correction": "...", "explanation": "...", "source_excerpt": "..." }
        { "type": "error", "message": "..." }
    """
    await websocket.accept()

    session_id = str(uuid.uuid4())
    existing_graph: dict = {"nodes": [], "edges": [], "clusters": []}  # Legacy fallback
    existing_graphs: dict[str, dict] = {}  # Per-tool diagram graphs
    claim_registry = ClaimRegistry()
    architect_history: list[dict] = []  # Conversation history for architect tool
    referee_history: list[dict] = []    # Conversation history for argument referee
    contentions: list[dict] = []         # Live contention tracking for debate
    general_chat_history: list[dict] = []  # Conversation history for general chat
    active_chat_tool: str | None = None     # Tracks which tool is active in general_chat
    active_chat_mode: str = "general"       # Tracks sub-mode for active tool
    locked_topic: str | None = None         # Topic lock for quiz accuracy
    quiz_context: str | None = None         # Cached web-search / RAG context for quizzing
    session_stored = False              # Track if we stored the session record
    language_level = "beginner"         # Adaptive language proficiency tracking
    _response_lock = asyncio.Lock()         # Prevents overlapping AI responses
    _pending_response_task: asyncio.Task | None = None  # Track in-flight work for cancellation
    _current_tts_task: asyncio.Task | None = None       # Cancel stale TTS when new response arrives
    _realtime_active = False                # When True, skip Gemini TTS (Realtime handles voice)
    logger.info("WebSocket session started: %s", session_id)

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json(
                    {"type": "error", "message": "Invalid JSON"}
                )
                continue

            msg_type = message.get("type")

            # Track if frontend has Realtime voice active (skip Gemini TTS)
            if message.get("realtime_active"):
                _realtime_active = True

            # Store session record on first real message (avoids FK errors)
            if not session_stored and msg_type in ("transcript", "interim", "realtime_transcript"):
                session_stored = True
                try:
                    # Map general_chat to study_buddy for DB storage
                    # (CHECK constraint doesn't include general_chat)
                    raw_tool = message.get("tool", "study_buddy")
                    db_tool = "study_buddy" if raw_tool == "general_chat" else raw_tool
                    store_session({
                        "id": session_id,
                        "mode": message.get("mode", "general"),
                        "tool": db_tool,
                        "class_id": message.get("class_id") or None,
                        "topic": message.get("topic") or None,
                    })
                    # Update study streak
                    try:
                        increment_study_streak()
                    except Exception:
                        logger.debug("Streak update failed (non-critical)")
                except Exception:
                    logger.debug("Session record storage failed (non-critical)")

            # ===========================================================
            # GENERAL CHAT — auto-routing meta interface
            # Classifies user intent and ROUTES to the actual pipeline.
            # If no specific tool detected, uses router→voice pipeline.
            # ===========================================================
            if msg_type in ("transcript", "interim") and message.get("tool") == "general_chat":
                text = message.get("text", "").strip()
                if not text:
                    continue

                try:
                    # ----- Reset detection -----
                    _lower = text.lower().strip()
                    if any(p in _lower for p in (
                        "switch back", "go back to chat", "just chat",
                        "general mode", "regular chat", "exit tool",
                        "stop quiz", "stop architect", "stop debate",
                    )):
                        active_chat_tool = None
                        active_chat_mode = "general"
                        await websocket.send_json({"type": "tool_deactivated"})
                        # Generate a casual response (direct — no Router needed)
                        voice_text = await voice_agent.generate_direct_response(
                            user_text=text,
                            conversation_history=general_chat_history,
                            context="The user wants to switch back to general chat. Acknowledge casually.",
                        )
                        if voice_text:
                            general_chat_history.append({"role": "model", "text": voice_text})
                            # Cancel stale TTS before sending new response
                            if _current_tts_task and not _current_tts_task.done():
                                _current_tts_task.cancel()
                            await websocket.send_json({
                                "type": "ai_response",
                                "text": voice_text,
                                "should_speak": True,
                                "is_interrupt": False,
                                "response_type": "explanation",
                            })
                            _current_tts_task = asyncio.create_task(
                                _send_tts_supplement(websocket, voice_text, "general_chat", skip=_realtime_active)
                            )
                        continue

                    _prefetched_ctx = None  # May be set by parallel orchestrator

                    # ----- Gideon Orchestrator (smart skip for continuations) -----
                    if msg_type == "transcript":
                        # Track conversation
                        general_chat_history.append({"role": "user", "text": text})

                        # Smart skip: continuation messages in active tool
                        # don't need re-classification (saves ~1s)
                        need_orchestrator = (
                            not active_chat_tool
                            or _might_switch_tool(text)
                        )

                        if need_orchestrator:
                            # Load student profile
                            student_profile = None
                            try:
                                student_profile = get_student_profile()
                            except Exception:
                                logger.debug("Failed to load student profile (non-critical)")

                            current_skills = []
                            if active_chat_tool:
                                current_skills.append(f"{active_chat_tool}:{active_chat_mode}")
                            current_skills.append("thought_plot")

                            # Run orchestrator + context in PARALLEL (saves ~100ms)
                            _orch_task = asyncio.create_task(
                                gideon_orchestrator.orchestrate(
                                    text=text,
                                    conversation_history=general_chat_history,
                                    student_profile=student_profile,
                                    current_skills=current_skills,
                                )
                            )
                            _ctx_task = asyncio.create_task(
                                get_session_context(
                                    class_id=message.get("class_id"),
                                    mode="general",
                                    topic=message.get("topic"),
                                    session_id=session_id,
                                )
                            )

                            orch = await _orch_task
                            _prefetched_ctx = await _ctx_task

                            new_tool = orch["primary_skill"]
                            new_mode = orch["primary_mode"]

                            if new_tool != "general" and new_tool != active_chat_tool:
                                active_chat_tool = new_tool
                                active_chat_mode = new_mode if new_mode != "default" else "general"

                                # Seed tool histories with conversation context
                                if new_tool == "architect" and not architect_history:
                                    for h in general_chat_history[-4:]:
                                        architect_history.append({
                                            "role": "user" if h.get("role") == "user" else "model",
                                            "text": h.get("text", ""),
                                        })
                                elif new_tool == "argument_ref" and not referee_history:
                                    for h in general_chat_history[-4:]:
                                        referee_history.append({
                                            "role": "user" if h.get("role") == "user" else "model",
                                            "text": h.get("text", ""),
                                        })

                                await websocket.send_json({
                                    "type": "tool_activated",
                                    "tool": active_chat_tool,
                                    "mode": active_chat_mode,
                                    "reason": orch["reasoning"],
                                })

                            elif new_tool == "general" and active_chat_tool:
                                active_chat_tool = None
                                active_chat_mode = "general"
                                await websocket.send_json({"type": "tool_deactivated"})

                    # ----- Route to specialized pipeline or general -----
                    if active_chat_tool:
                        if msg_type == "interim":
                            # NEVER reroute interims to specialized handlers.
                            # Interims fire rapidly during speech recognition and
                            # would trigger N overlapping response pipelines.
                            # Only the dedicated tool pages (study-buddy, etc.)
                            # use their own interim logic directly.
                            continue
                        # Reroute final transcript to the specialized handler
                        message["tool"] = active_chat_tool
                        message["mode"] = active_chat_mode
                        # DON'T continue — fall through to existing handlers below
                    else:
                        # ----- General mode: direct voice (Router skipped — saves ~650ms) -----
                        if msg_type == "interim":
                            continue

                        if _response_lock.locked():
                            logger.debug("Skipping general chat — response already in progress")
                            continue

                        async with _response_lock:
                            # Reuse pre-fetched context from parallel orchestrator
                            context = _prefetched_ctx or await get_session_context(
                                class_id=message.get("class_id"),
                                mode="general",
                                topic=message.get("topic"),
                                session_id=session_id,
                            )

                            # Direct voice response — single Gemini call
                            # replaces Router (GPT-4.1-mini) + Voice (Gemini)
                            voice_text = await voice_agent.generate_direct_response(
                                user_text=text,
                                conversation_history=general_chat_history,
                                context=context,
                            )

                            if voice_text:
                                general_chat_history.append({"role": "model", "text": voice_text})
                                # Cancel stale TTS before sending new response
                                if _current_tts_task and not _current_tts_task.done():
                                    _current_tts_task.cancel()
                                await websocket.send_json({
                                    "type": "ai_response",
                                    "text": voice_text,
                                    "should_speak": True,
                                    "is_interrupt": False,
                                    "response_type": "explanation",
                                })
                                _current_tts_task = asyncio.create_task(
                                    _send_tts_supplement(websocket, voice_text, "general_chat", skip=_realtime_active)
                                )

                            # Plotter in background
                            asyncio.create_task(
                                _general_chat_plot(
                                    websocket, text, voice_text or "",
                                    existing_graph,
                                )
                            )

                            # Store transcripts
                            asyncio.create_task(
                                _store_transcript_safe(session_id=session_id, speaker="user", text=text)
                            )
                            if voice_text:
                                asyncio.create_task(
                                    _store_transcript_safe(session_id=session_id, speaker="ai", text=voice_text)
                                )

                        continue

                except Exception:
                    logger.exception("General chat failed for session %s", session_id)
                    await websocket.send_json({
                        "type": "ai_response",
                        "text": "Sorry, I had trouble with that. Could you try again?",
                        "should_speak": False,
                        "is_interrupt": False,
                        "response_type": "explanation",
                    })
                    continue

            # ===========================================================
            # RESTORE SESSION — reload context from a previous session
            # ===========================================================
            if msg_type == "restore_session":
                restored_id = message.get("session_id", "")
                restored_history = message.get("history", [])
                restored_summary = message.get("summary", "")
                restored_tool = message.get("tool", "general_chat")
                restored_mode = message.get("mode", "general")
                restored_topic = message.get("topic")

                # Re-populate in-memory conversation history
                general_chat_history.clear()
                for entry in restored_history:
                    role = entry.get("role", "user")
                    text_val = entry.get("text", "")
                    if text_val:
                        general_chat_history.append({"role": role, "text": text_val})

                # Restore tool/mode state
                active_chat_tool = restored_tool if restored_tool != "general_chat" else None
                active_chat_mode = restored_mode
                if restored_topic:
                    locked_topic = restored_topic

                # Try to restore the graph for this session
                try:
                    tp = get_session_thought_plot(restored_id)
                    if tp and tp.get("graph_json"):
                        gj = tp["graph_json"]
                        if isinstance(gj, dict) and "nodes" in gj:
                            existing_graphs[restored_tool] = gj
                            existing_graph.update(gj)
                except Exception:
                    pass

                logger.info(
                    "Session restored: %s (%d messages, tool=%s)",
                    restored_id, len(general_chat_history), restored_tool,
                )
                await websocket.send_json({
                    "type": "session_restored",
                    "session_id": restored_id,
                    "message_count": len(general_chat_history),
                })
                continue

            # ===========================================================
            # REALTIME TRANSCRIPT — forwarded from OpenAI Realtime API
            # Run ONLY background agents (voice handled by Realtime).
            # ===========================================================
            if msg_type == "realtime_transcript":
                text = message.get("text", "").strip()
                tool = message.get("tool", "general_chat")
                mode = message.get("mode", "general")
                if not text:
                    continue

                # Track active tool/mode for AI response routing
                active_chat_tool = tool if tool != "general_chat" else None
                active_chat_mode = mode

                general_chat_history.append({"role": "user", "text": text})

                # ── Quiz context: detect topic + fetch material ──
                quiz_modes = {"quiz", "cram", "guided_study", "general"}
                quiz_tools = {"study_buddy", "thought_plot"}

                # Contextual request patterns — user wants content derived FROM their materials
                _CONTEXTUAL_PHRASES = [
                    "based on this", "based on my", "from this", "from my",
                    "give me a topic", "give me topics", "suggest a topic",
                    "give me questions", "give me some questions",
                    "ask me about this", "ask me questions",
                    "quiz me from", "test me from", "quiz me on my",
                    "use my notes", "use my materials", "from the material",
                    "from my notes", "from my slides", "from my textbook",
                    "what should I study", "what topics", "pick a topic",
                    "choose a topic", "random topic",
                ]
                # Topic shift keywords (explicit new topic)
                _TOPIC_SHIFT_PHRASES = [
                    "quiz me on", "quiz me about", "let's do",
                    "switch to", "now do", "test me on",
                    "ask me about", "questions on", "questions about",
                    "study", "teach me about", "help me with",
                ]

                if tool in quiz_tools and mode in quiz_modes and not quiz_context:
                    class_id = message.get("class_id")
                    lower = text.lower()
                    is_contextual = any(p in lower for p in _CONTEXTUAL_PHRASES)

                    if is_contextual and class_id:
                        # User wants topics/questions derived from their materials
                        # Use a broad topic to pull diverse material, then let AI pick
                        topic_text = message.get("topic") or await _extract_smart_topic(text, class_id)
                    else:
                        topic_text = message.get("topic") or text

                    # Detect topic from user text if not explicitly set
                    if not locked_topic:
                        locked_topic = topic_text[:200]  # Cap at 200 chars

                    async def _fetch_and_send_quiz_context():
                        nonlocal quiz_context
                        try:
                            if class_id:
                                # RAG path — pull from course materials
                                if is_contextual:
                                    # Broader retrieval for contextual requests
                                    ctx = await _fetch_quiz_context_rag(locked_topic or text, class_id, count=15)
                                else:
                                    ctx = await _fetch_quiz_context_rag(locked_topic or text, class_id)
                                source = "class_materials"
                            else:
                                # Web search path — general knowledge
                                grade = message.get("grade_level", "")
                                diff = message.get("difficulty", "")
                                ctx = await _fetch_quiz_context_web(locked_topic or text, mode, grade, diff)
                                source = "web_search"

                            if ctx:
                                quiz_context = ctx
                                await websocket.send_json({
                                    "type": "quiz_context_ready",
                                    "context": ctx,
                                    "topic": locked_topic,
                                    "source": source,
                                })
                        except Exception:
                            logger.exception("Quiz context fetch failed")

                    asyncio.create_task(_fetch_and_send_quiz_context())

                # Detect topic shift mid-quiz — re-fetch if topic changes significantly
                elif tool in quiz_tools and mode in quiz_modes and quiz_context and locked_topic:
                    lower = text.lower()
                    is_contextual = any(p in lower for p in _CONTEXTUAL_PHRASES)
                    is_shift = any(p in lower for p in _TOPIC_SHIFT_PHRASES)
                    if is_contextual or is_shift:
                        # Extract new topic and re-fetch
                        class_id = message.get("class_id")
                        if is_contextual and class_id:
                            locked_topic = await _extract_smart_topic(text, class_id)
                        else:
                            locked_topic = text[:200]
                        quiz_context = None  # Will be re-fetched on next iteration

                # Get or create per-tool graph
                tool_graph = existing_graphs.setdefault(
                    tool, {"nodes": [], "edges": [], "clusters": []}
                )

                # Always run plotter in background (per-tool graph)
                plot_mode = tool if tool in ("argument_ref", "harvey") else "general"
                asyncio.create_task(
                    _general_chat_plot(websocket, text, "", tool_graph, tool=tool, plot_mode=plot_mode)
                )

                # Run fact-checker (unless disabled for thought_plot)
                fact_check_on = message.get("fact_check_enabled", True)
                voice_on = message.get("voice_enabled", False)
                if fact_check_on:
                    asyncio.create_task(
                        _run_fact_check(
                            websocket=websocket,
                            session_id=session_id,
                            transcript_chunk=text,
                            router_instruction="",
                            class_id=message.get("class_id"),
                            topic=message.get("topic"),
                            claim_registry=claim_registry,
                            mode=mode,
                            existing_graph=existing_graph,
                            tool=tool,
                            voice_enabled=voice_on if tool == "thought_plot" else True,
                        )
                    )

                # Tool-specific background agents
                if tool == "architect":
                    architect_history.append({"role": "user", "text": text})
                    # Reuse the existing _architect_background helper
                    # (runs generate_research → generate_panel → sends architecture_state + plot_update)
                    asyncio.create_task(
                        _architect_background(
                            websocket, text, architect_history,
                            "",  # no chat_text — voice handled by Realtime
                            tool_graph,
                        )
                    )

                elif tool == "argument_ref":
                    referee_history.append({"role": "user", "text": text})
                    if mode == "harvey":
                        try:
                            harvey_result = await referee_agent.argue_back(
                                statement=text,
                                conversation_history=referee_history,
                            )
                            if harvey_result and harvey_result.get("text"):
                                referee_history.append({"role": "model", "text": harvey_result["text"]})
                        except Exception:
                            logger.exception("Realtime harvey background failed")
                    else:
                        # Fallacy + technique detection
                        asyncio.create_task(
                            _extract_and_send_contentions(
                                websocket, text, referee_history, contentions,
                            )
                        )
                        try:
                            fallacy = await referee_agent.analyze_statement(text, referee_history)
                            if fallacy and fallacy.get("has_issue"):
                                await websocket.send_json({
                                    "type": "fallacy_call",
                                    "fallacy": {
                                        "id": str(uuid.uuid4()),
                                        "name": fallacy.get("fallacy_name", ""),
                                        "category": fallacy.get("category", ""),
                                        "what_was_said": fallacy.get("what_was_said", ""),
                                        "why_its_wrong": fallacy.get("why_its_wrong", ""),
                                        "correct_form": fallacy.get("correct_form", ""),
                                        "severity": fallacy.get("severity", "medium"),
                                        "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
                                    },
                                })
                            technique = await referee_agent.analyze_technique(text, referee_history)
                            if technique and technique.get("technique_name") and technique["technique_name"] != "None":
                                await websocket.send_json({
                                    "type": "technique_detected",
                                    "technique": {
                                        "id": str(uuid.uuid4()),
                                        "name": technique.get("technique_name", ""),
                                        "quality": technique.get("technique_quality", "none"),
                                        "feedback": technique.get("feedback", ""),
                                        "contention_strength": technique.get("contention_strength", "none"),
                                        "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
                                    },
                                })
                        except Exception:
                            logger.exception("Realtime referee background failed")

                # Store transcript
                asyncio.create_task(
                    _store_transcript_safe(session_id=session_id, speaker="user", text=text)
                )
                continue

            # ===========================================================
            # REALTIME AI RESPONSE — forwarded from OpenAI Realtime API
            # Store in history for context building.
            # ===========================================================
            if msg_type == "realtime_ai_response":
                text = message.get("text", "").strip()
                if text:
                    general_chat_history.append({"role": "model", "text": text})
                    # Also update tool-specific histories so background agents have context
                    if active_chat_tool == "architect":
                        architect_history.append({"role": "model", "text": text})
                    elif active_chat_tool == "argument_ref":
                        referee_history.append({"role": "model", "text": text})
                    asyncio.create_task(
                        _store_transcript_safe(session_id=session_id, speaker="ai", text=text)
                    )
                    # Run plotter with AI response for richer diagrams (per-tool graph)
                    ai_tool = active_chat_tool or "general_chat"
                    ai_tool_graph = existing_graphs.setdefault(
                        ai_tool, {"nodes": [], "edges": [], "clusters": []}
                    )
                    ai_plot_mode = ai_tool if ai_tool in ("argument_ref", "harvey") else "general"
                    asyncio.create_task(
                        _general_chat_plot(websocket, "", text, ai_tool_graph, tool=ai_tool, plot_mode=ai_plot_mode)
                    )
                continue

            # ===========================================================
            # TOOL SECTION END — auto-save artifacts when switching tools
            # Frontend sends this when user switches from one tool to another.
            # ===========================================================
            if msg_type == "tool_section_end":
                ended_tool = message.get("tool", "general_chat")
                ended_mode = message.get("mode", "general")
                logger.info("Tool section ended: %s/%s in session %s", ended_tool, ended_mode, session_id)
                # Update session record with current tool/mode if it changed
                if session_stored:
                    try:
                        from services.supabase_client import supabase
                        supabase.table("study_sessions").update({
                            "tool": ended_tool if ended_tool != "general_chat" else "study_buddy",
                            "mode": ended_mode,
                            "topic": message.get("topic") or None,
                        }).eq("id", session_id).execute()
                    except Exception:
                        logger.debug("Tool section update failed (non-critical)")
                continue

            # ===========================================================
            # CONTEXT RESET — frontend sends this on tool switch
            # Clears conversation histories for full isolation.
            # ===========================================================
            if msg_type == "context_reset":
                new_tool = message.get("tool", "general_chat")
                new_mode = message.get("mode", "general")
                logger.info("Context reset: %s → %s/%s", active_chat_tool, new_tool, new_mode)
                # Clear all conversation histories
                general_chat_history.clear()
                architect_history.clear()
                referee_history.clear()
                # Reset quiz state
                locked_topic = None
                quiz_context = None
                # Update active tool tracking
                active_chat_tool = new_tool if new_tool != "general_chat" else None
                active_chat_mode = new_mode
                continue

            # ===========================================================
            # ARCHITECT — architecture planning tool
            # Separate pipeline from study tools: no Router/Plotter agents.
            # Uses the Architect Agent with web search grounding.
            # ===========================================================
            if msg_type == "transcript" and message.get("tool") == "architect":
                text = message.get("text", "").strip()
                if not text:
                    continue

                if _response_lock.locked():
                    logger.debug("Skipping architect — response already in progress")
                    continue

                try:
                    await _response_lock.acquire()
                    # Agent A: Fast chat response (<1s, no grounding)
                    chat_result = await architect_agent.generate_chat(
                        message=text,
                        conversation_history=architect_history,
                    )

                    # Update conversation history
                    architect_history.append({"role": "user", "text": text})
                    architect_history.append({"role": "model", "text": chat_result["text"]})

                    # Cancel stale TTS before sending new response
                    if _current_tts_task and not _current_tts_task.done():
                        _current_tts_task.cancel()
                    # Send text response IMMEDIATELY
                    await websocket.send_json({
                        "type": "ai_response",
                        "text": chat_result["text"],
                        "should_speak": True,
                        "is_interrupt": False,
                        "response_type": "explanation",
                        "suggestions": chat_result.get("suggestions", []),
                        "option_cards": chat_result.get("option_cards", []),
                    })

                    # Fire TTS in background
                    _current_tts_task = asyncio.create_task(
                        _send_tts_supplement(websocket, chat_result["text"], "architect", skip=_realtime_active)
                    )

                    # Fire research + panel + plot in background
                    asyncio.create_task(
                        _architect_background(
                            websocket, text, architect_history,
                            chat_result["text"], existing_graph,
                        )
                    )

                    # Fact-check the user's technical claims
                    asyncio.create_task(
                        _run_fact_check(
                            websocket=websocket,
                            session_id=session_id,
                            transcript_chunk=text,
                            router_instruction="",
                            class_id=message.get("class_id"),
                            topic=message.get("topic"),
                            claim_registry=claim_registry,
                            mode="architect",
                            existing_graph=existing_graph,
                            tool="architect",
                        )
                    )

                except Exception:
                    logger.exception("Architect agent failed for session %s", session_id)
                    await websocket.send_json({
                        "type": "ai_response",
                        "text": "Sorry, I had trouble processing that. Could you rephrase?",
                        "should_speak": False,
                        "is_interrupt": False,
                        "response_type": "explanation",
                        "suggestions": [],
                        "option_cards": [],
                    })
                finally:
                    if _response_lock.locked():
                        _response_lock.release()

                continue

            # ===========================================================
            # ANALYZE ARGUMENT — paste-and-analyze debate coaching
            # User pastes a written argument or debate transcript and
            # gets comprehensive coaching from the debate coach agent.
            # ===========================================================
            if msg_type == "analyze_argument" and message.get("tool") == "argument_ref":
                text = message.get("text", "").strip()
                context = message.get("context", "")
                logger.info("Debate coach — analyzing argument (%d chars)", len(text))
                if not text:
                    continue

                try:
                    analysis = await debate_coach_agent.analyze_argument(
                        argument_text=text,
                        context=context,
                    )

                    await websocket.send_json({
                        "type": "debate_analysis",
                        "analysis": analysis,
                    })

                    # Generate argument structure diagram in background
                    asyncio.create_task(
                        _analyze_debate_plot(websocket, analysis, existing_graph)
                    )

                    # Store transcript
                    asyncio.create_task(
                        _store_transcript_safe(
                            session_id=session_id,
                            speaker="user",
                            text=f"[ANALYZE] {text[:500]}",
                        )
                    )

                except Exception:
                    logger.exception("Debate coach failed for session %s", session_id)
                    await websocket.send_json({
                        "type": "error",
                        "message": "Failed to analyze argument — please try again.",
                    })

                continue

            # ===========================================================
            # ARGUMENT REF — real-time fallacy & bad-faith detector
            # Listens to every statement and calls out logical fallacies,
            # red herrings, bad-faith arguments, and factual errors.
            # Also supports Harvey Specter mode (aggressive opposing counsel).
            # ===========================================================
            if msg_type == "transcript" and message.get("tool") == "argument_ref":
                text = message.get("text", "").strip()
                arg_mode = message.get("mode", "referee")

                if _response_lock.locked():
                    logger.debug("Skipping argument_ref — response already in progress")
                    continue
                logger.info("Argument Ref — mode=%s, text=%s", arg_mode, text[:60])
                if not text:
                    continue

                try:
                    import time as _time

                    referee_history.append({"role": "user", "text": text})

                    # ---------- HARVEY SPECTER MODE ----------
                    if arg_mode == "harvey":
                        harvey_result = await referee_agent.argue_back(
                            statement=text,
                            conversation_history=referee_history,
                        )

                        harvey_text = harvey_result.get("text", "")

                        # Send Harvey's response immediately
                        await websocket.send_json({
                            "type": "ai_response",
                            "text": harvey_text,
                            "should_speak": True,
                            "is_interrupt": True,
                            "response_type": "harvey",
                        })

                        # Fire TTS in background (Fenrir — aggressive male voice)
                        asyncio.create_task(
                            _send_tts_supplement(websocket, harvey_text, "harvey", skip=_realtime_active)
                        )

                        referee_history.append({"role": "model", "text": harvey_text})

                        # Extract contentions in background
                        asyncio.create_task(
                            _extract_and_send_contentions(
                                websocket, text, referee_history, contentions,
                            )
                        )

                        # Run debate plotter in background
                        asyncio.create_task(
                            _argument_ref_plot(
                                websocket, text, harvey_text,
                                existing_graph, "harvey",
                            )
                        )

                    # ---------- REFEREE MODE (default) ----------
                    else:
                        # Run fallacy + technique detection in parallel
                        fallacy_task = asyncio.create_task(
                            referee_agent.analyze_statement(
                                statement=text,
                                conversation_history=referee_history,
                            )
                        )
                        technique_task = asyncio.create_task(
                            referee_agent.analyze_technique(
                                statement=text,
                                conversation_history=referee_history,
                            )
                        )

                        result = await fallacy_task
                        technique_result = await technique_task

                        # Send technique detection if notable
                        if technique_result.get("technique_name", "None") != "None":
                            await websocket.send_json({
                                "type": "technique_detected",
                                "technique": {
                                    "id": str(uuid.uuid4()),
                                    "name": technique_result["technique_name"],
                                    "quality": technique_result.get("technique_quality", "none"),
                                    "feedback": technique_result.get("feedback", ""),
                                    "contention_strength": technique_result.get("contention_strength", "none"),
                                    "timestamp": int(_time.time() * 1000),
                                },
                            })

                        if result.get("has_issue"):
                            callout = result.get("callout_text", "")

                            # Send voice interrupt IMMEDIATELY (no TTS wait)
                            ai_msg: dict[str, Any] = {
                                "type": "ai_response",
                                "text": callout,
                                "should_speak": True,
                                "is_interrupt": True,
                                "response_type": "fallacy",
                            }
                            await websocket.send_json(ai_msg)

                            # Fire TTS in background
                            asyncio.create_task(
                                _send_tts_supplement(websocket, callout, "referee", skip=_realtime_active)
                            )

                            # Send fallacy card
                            await websocket.send_json({
                                "type": "fallacy_call",
                                "fallacy": {
                                    "id": str(uuid.uuid4()),
                                    "name": result.get("fallacy_name", "Unknown"),
                                    "category": result.get("category", "None"),
                                    "what_was_said": result.get("what_was_said", ""),
                                    "why_its_wrong": result.get("why_its_wrong", ""),
                                    "correct_form": result.get("correct_form", ""),
                                    "severity": result.get("severity", "medium"),
                                    "timestamp": int(_time.time() * 1000),
                                },
                            })

                            referee_history.append({"role": "model", "text": callout})

                        # Extract contentions in background
                        asyncio.create_task(
                            _extract_and_send_contentions(
                                websocket, text, referee_history, contentions,
                            )
                        )

                        # Run debate plotter in background
                        asyncio.create_task(
                            _argument_ref_plot(
                                websocket, text,
                                result.get("callout_text", "") if result.get("has_issue") else "",
                                existing_graph, "argument_ref",
                            )
                        )

                    # Store transcript
                    asyncio.create_task(
                        _store_transcript_safe(
                            session_id=session_id,
                            speaker="user",
                            text=text,
                        )
                    )

                    # Skip fact-check for argument_ref — referee already
                    # analyzes statements, running both is redundant and slow.

                except Exception:
                    logger.exception("Referee agent failed for session %s", session_id)
                    await websocket.send_json({
                        "type": "ai_response",
                        "text": "I missed that — could you repeat?",
                        "should_speak": False,
                        "is_interrupt": False,
                        "response_type": "explanation",
                    })

                continue

            # ===========================================================
            # INTERIM — lightweight router-only check for fast interruption
            # No plotter, no transcript storage.  Lets the AI catch errors
            # while the student is still mid-sentence.
            # ===========================================================
            if msg_type == "interim":
                # Skip interims while a response is being generated —
                # prevents overlapping voice responses for the same turn.
                if _response_lock.locked():
                    continue

                chunk = TranscriptChunk(
                    text=message.get("text", ""),
                    mode=message.get("mode", "general"),
                    class_id=message.get("class_id"),
                    topic=message.get("topic"),
                    tool=message.get("tool"),
                )
                if not chunk.text.strip():
                    continue

                context = await get_session_context(
                    class_id=chunk.class_id,
                    mode=chunk.mode,
                    topic=chunk.topic,
                    session_id=session_id,
                )

                # Use thought-plot specific router when applicable
                router_mode = _get_router_mode(chunk.tool, chunk.mode)

                router_result = await router_agent.should_respond(
                    transcript_chunk=chunk.text,
                    mode=router_mode,
                    context=context,
                )

                if router_result.get("should_respond"):
                    # Voice text only (fast) — no TTS wait
                    voice_mode = _get_voice_mode(chunk.tool, chunk.mode)
                    voice_text = await voice_agent.generate_response(
                        instruction=router_result.get("response_instruction", ""),
                        transcript=chunk.text,
                        mode=voice_mode,
                        context=context,
                    )
                    if voice_text:
                        # Cancel stale TTS before sending new response
                        if _current_tts_task and not _current_tts_task.done():
                            _current_tts_task.cancel()
                        # Send text immediately
                        response_msg = _build_voice_response(
                            voice_text, None, router_result,
                            is_interrupt=True,
                        )
                        await websocket.send_json(response_msg)

                        # TTS in background
                        _current_tts_task = asyncio.create_task(
                            _send_tts_supplement(websocket, voice_text, voice_mode, skip=_realtime_active)
                        )

                        asyncio.create_task(
                            _store_transcript_safe(
                                session_id=session_id,
                                speaker="ai",
                                text=voice_text,
                            )
                        )

                continue

            # ===========================================================
            # TRANSCRIPT — full 3-agent pipeline
            # ===========================================================
            if msg_type != "transcript":
                await websocket.send_json(
                    {"type": "error", "message": f"Unknown message type: {msg_type}"}
                )
                continue

            # Wait for any in-flight response to finish before starting a new one
            async with _response_lock:
                pass  # Just ensures previous response completed

            chunk = TranscriptChunk(
                text=message.get("text", ""),
                mode=message.get("mode", "general"),
                class_id=message.get("class_id"),
                topic=message.get("topic"),
                tool=message.get("tool"),
            )

            if not chunk.text.strip():
                continue

            # ----------------------------------------------------------
            # Build context
            # ----------------------------------------------------------
            context = await get_session_context(
                class_id=chunk.class_id,
                mode=chunk.mode,
                topic=chunk.topic,
                session_id=session_id,
            )

            # ----------------------------------------------------------
            # Determine which agents to run
            # ----------------------------------------------------------
            is_thought_plot = chunk.tool == "thought_plot"

            # Plotter: always for thought_plot, conditional for study_buddy
            run_plotter = is_thought_plot or chunk.mode in (
                "quiz", "guided_study", "general"
            )

            # ----------------------------------------------------------
            # Launch agents concurrently
            # ----------------------------------------------------------
            tasks: dict[str, asyncio.Task] = {}

            # AGENT 1: Router — decides if voice intervention is needed
            router_mode = _get_router_mode(chunk.tool, chunk.mode)
            lang_proficiency = (
                f"Current level: {language_level}"
                if chunk.mode == "language" else None
            )
            tasks["router"] = asyncio.create_task(
                router_agent.should_respond(
                    transcript_chunk=chunk.text,
                    mode=router_mode,
                    context=context,
                    language_proficiency=lang_proficiency,
                )
            )

            # AGENT 2: Plotter — generates diagram update
            if run_plotter:
                plotter_mode = _map_plotter_mode(chunk.mode, chunk.class_id)
                tasks["plotter"] = asyncio.create_task(
                    plotter_agent.should_plot(
                        transcript_chunk=chunk.text,
                        mode=plotter_mode,
                        context=context,
                        existing_graph=existing_graph,
                    )
                )

            # Wait for router (plotter continues in parallel)
            router_result: dict = await tasks["router"]

            # Update language level from router's detection
            if chunk.mode == "language" and router_result.get("detected_level"):
                language_level = router_result["detected_level"]

            # ----------------------------------------------------------
            # AGENT 3: Voice — only if router says "speak up"
            # SKIP for Thought Plot — voice comes ONLY from fact-check.
            # Run voice generation concurrently with plotter await.
            # ----------------------------------------------------------
            voice_task: asyncio.Task | None = None
            if router_result.get("should_respond") and not is_thought_plot:
                voice_mode = _get_voice_mode(chunk.tool, chunk.mode)
                voice_context = context
                if chunk.mode == "language":
                    voice_context = (
                        f"## Student Language Level: {language_level}\n\n"
                        f"{context}"
                    )
                voice_task = asyncio.create_task(
                    voice_agent.generate_response(
                        instruction=router_result.get("response_instruction", ""),
                        transcript=chunk.text,
                        mode=voice_mode,
                        context=voice_context,
                    )
                )

            # ----------------------------------------------------------
            # Await voice + plotter in PARALLEL (not sequentially)
            # ----------------------------------------------------------
            voice_text = ""
            if voice_task:
                voice_text = await voice_task
            if voice_text:
                # Cancel stale TTS before sending new response
                if _current_tts_task and not _current_tts_task.done():
                    _current_tts_task.cancel()
                response_msg = _build_voice_response(
                    voice_text, None, router_result,
                    is_interrupt=is_thought_plot,
                )
                await websocket.send_json(response_msg)
                voice_mode_for_tts = _get_voice_mode(chunk.tool, chunk.mode)
                _current_tts_task = asyncio.create_task(
                    _send_tts_supplement(websocket, voice_text, voice_mode_for_tts, skip=_realtime_active)
                )
                asyncio.create_task(
                    _store_transcript_safe(
                        session_id=session_id,
                        speaker="ai",
                        text=voice_text,
                    )
                )

            # ----------------------------------------------------------
            # Background fact-checker — gated to reduce API overhead.
            # Thought Plot: always (fact-checking IS the core feature).
            # Study Buddy: only when router detected something to respond to.
            # ----------------------------------------------------------
            should_fact_check = is_thought_plot or router_result.get("should_respond")
            if should_fact_check:
                asyncio.create_task(
                    _run_fact_check(
                        websocket=websocket,
                        session_id=session_id,
                        transcript_chunk=chunk.text,
                        router_instruction=router_result.get("response_instruction", ""),
                        class_id=chunk.class_id,
                        topic=chunk.topic,
                        claim_registry=claim_registry,
                        mode="thought_plot" if is_thought_plot else chunk.mode,
                        existing_graph=existing_graph,
                        tool=chunk.tool,
                    )
                )

            # ----------------------------------------------------------
            # Plotter result → Mermaid diagram (may already be done)
            # ----------------------------------------------------------
            if "plotter" in tasks:
                plot_result = await tasks["plotter"]
                if plot_result is not None:
                    _merge_graph(existing_graph, plot_result)
                    mermaid_code = _graph_to_mermaid(existing_graph)

                    await websocket.send_json(
                        {
                            "type": "plot_update",
                            "graph": {
                                **plot_result,
                                "mermaid_code": mermaid_code,
                            },
                        }
                    )

            # ----------------------------------------------------------
            # Store user transcript (fire and forget)
            # ----------------------------------------------------------
            asyncio.create_task(
                _store_transcript_safe(
                    session_id=session_id,
                    speaker="user",
                    text=chunk.text,
                )
            )

    except WebSocketDisconnect:
        logger.info("WebSocket session ended: %s", session_id)
        # Run post-session analysis in the background
        if session_stored:
            # Pick the richest conversation history available
            history = general_chat_history or referee_history or architect_history or []
            asyncio.create_task(
                _run_post_session(
                    session_id=session_id,
                    conversation_history=history,
                    tool=active_chat_tool or "general_chat",
                    mode=active_chat_mode,
                )
            )
    except Exception:
        logger.exception("WebSocket error in session %s", session_id)
        try:
            await websocket.send_json(
                {"type": "error", "message": "Internal server error"}
            )
        except Exception:
            pass


# ===================================================================
# Helpers
# ===================================================================


async def _run_post_session(
    session_id: str,
    conversation_history: list[dict],
    tool: str = "general_chat",
    mode: str = "general",
) -> None:
    """Run post-session analysis: summarize, update profile, store results."""
    try:
        # Calculate approximate duration from conversation timestamps
        duration = 0
        if len(conversation_history) >= 2:
            # Rough estimate: ~10 seconds per conversational turn
            duration = len(conversation_history) * 10

        result = await post_session_agent.analyze_session(
            conversation_history=conversation_history,
            tool=tool,
            mode=mode,
            duration_seconds=duration,
        )

        # Store session summary
        if result.get("summary"):
            try:
                store_summary({
                    "session_id": session_id,
                    "summary": result["summary"],
                    "topics_covered": result.get("topics_covered", []),
                    "weak_topics": result.get("weak_topics", []),
                })
            except Exception:
                logger.debug("Failed to store session summary (non-critical)")

        # Update student profile with detected preferences
        profile_updates = result.get("profile_updates", {})
        if profile_updates:
            # Merge topic lists with existing profile data
            try:
                existing = get_student_profile()
                if existing:
                    # Merge strongest topics (keep unique, cap at 10)
                    new_strong = result.get("strong_topics", [])
                    if new_strong:
                        existing_strong = existing.get("strongest_topics") or []
                        if isinstance(existing_strong, list):
                            merged = list(dict.fromkeys(existing_strong + new_strong))[:10]
                            profile_updates["strongest_topics"] = merged

                    # Merge weakest topics
                    new_weak = result.get("weak_topics", [])
                    if new_weak:
                        existing_weak = existing.get("weakest_topics") or []
                        if isinstance(existing_weak, list):
                            merged = list(dict.fromkeys(existing_weak + new_weak))[:10]
                            profile_updates["weakest_topics"] = merged

                    # Merge debate strengths/weaknesses
                    for key in ("debate_strengths", "debate_weaknesses"):
                        if key in profile_updates:
                            existing_list = existing.get(key) or []
                            if isinstance(existing_list, list):
                                merged = list(dict.fromkeys(existing_list + profile_updates[key]))[:10]
                                profile_updates[key] = merged

                    # Update total study minutes (rough estimate)
                    if duration > 0:
                        total_mins = (existing.get("total_study_minutes") or 0) + (duration // 60)
                        profile_updates["total_study_minutes"] = total_mins

                    # Update last session summary
                    profile_updates["last_session_summary"] = result.get("summary", "")[:200]

                update_student_profile("default", profile_updates)
            except Exception:
                logger.debug("Failed to update student profile (non-critical)")

        # Update session end time
        try:
            from services.supabase_client import supabase
            supabase.table("study_sessions").update({
                "ended_at": datetime.now(timezone.utc).isoformat(),
                "duration_seconds": duration,
            }).eq("id", session_id).execute()
        except Exception:
            logger.debug("Failed to update session end time (non-critical)")

        logger.info("Post-session analysis complete for %s", session_id)

    except Exception:
        logger.exception("Post-session analysis failed for %s", session_id)


# Voice name mapping for non-study-buddy tools
_TOOL_VOICES = {
    "architect": "Aoede",
    "referee": "Charon",
    "harvey": "Fenrir",
    "general_chat": "Fenrir",
}


async def _architect_background(
    websocket: WebSocket,
    user_text: str,
    conversation_history: list[dict],
    chat_text: str,
    existing_graph: dict,
) -> None:
    """Background: run research → panel extraction → plot for architect.

    Fires after the fast chat response is already sent. Sends
    architecture_state and plot_update as they become available.
    """
    try:
        # Agent B: Google Search grounded research (~2s)
        research_text = await architect_agent.generate_research(
            message=user_text,
            conversation_history=conversation_history,
        )

        # Agent C: Structured panel extraction (~2-3s)
        panel = await architect_agent.generate_panel(
            conversation_history=conversation_history,
            message=user_text,
            chat_text=chat_text,
            research_text=research_text,
        )

        if panel:
            review = panel.get("review", {})
            if review.get("requested"):
                logger.info(
                    "Architecture review generated: grade=%s score=%s",
                    review.get("overall_grade"),
                    review.get("overall_score"),
                )
            await websocket.send_json({
                "type": "architecture_state",
                "panel": panel,
            })

        # If the panel includes a diagram instruction, run the plotter
        diagram_instruction = panel.get("diagram_instruction", "") if panel else ""
        if diagram_instruction and len(diagram_instruction) > 10:
            try:
                plot_result = await plotter_agent.should_plot(
                    transcript_chunk=diagram_instruction,
                    mode="general",
                    context=f"Architecture planning session. The user is building: {user_text}",
                    existing_graph=existing_graph,
                )
                if plot_result is not None:
                    _merge_graph(existing_graph, plot_result)
                    mermaid_code = _graph_to_mermaid(existing_graph)
                    await websocket.send_json({
                        "type": "plot_update",
                        "graph": {
                            **plot_result,
                            "mermaid_code": mermaid_code,
                        },
                    })
            except Exception:
                logger.exception("Architect plotter failed")

    except Exception:
        logger.exception("Architect background pipeline failed")


def _truncate_for_speech(text: str, max_sentences: int = 8) -> str:
    """Limit text to N sentences for TTS. The voice agent chunks long text
    internally so we can be generous here — just avoid absurdly long inputs.
    """
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    if len(sentences) <= max_sentences:
        return text
    return " ".join(sentences[:max_sentences])


async def _send_tts_supplement(
    websocket: WebSocket,
    text: str,
    mode_or_tool: str,
    skip: bool = False,
) -> None:
    """Background: generate Gemini TTS audio and send as ai_audio supplement.

    The text response was already sent instantly. This delivers human-sounding
    audio a moment later. Uses voice_agent.generate_tts() for all paths
    (includes retry logic and per-mode/tool voice selection).

    If skip=True (Realtime active), silently return — Realtime handles voice.
    """
    if skip:
        return
    try:
        audio_bytes = await voice_agent.generate_tts(
            _truncate_for_speech(text), mode_or_tool
        )
        if audio_bytes:
            await websocket.send_json({
                "type": "ai_audio",
                "audio_data": base64.b64encode(audio_bytes).decode("ascii"),
                "audio_format": "pcm",
                "audio_sample_rate": 24000,
            })
        else:
            # TTS failed after retries — tell frontend to recover
            logger.warning("TTS failed for mode=%s, notifying client", mode_or_tool)
            await websocket.send_json({"type": "tts_failed"})

    except asyncio.CancelledError:
        logger.debug("TTS cancelled (superseded by newer response) for mode=%s", mode_or_tool)
    except Exception:
        logger.debug("TTS supplement delivery failed — notifying client")
        try:
            await websocket.send_json({"type": "tts_failed"})
        except Exception:
            pass  # WebSocket already closed


async def _extract_and_send_contentions(
    websocket: WebSocket,
    text: str,
    conversation_history: list[dict],
    contentions: list[dict],
) -> None:
    """Background task: extract contentions and send update to frontend."""
    try:
        updated = await referee_agent.extract_contentions(
            statement=text,
            conversation_history=conversation_history,
            existing_contentions=contentions,
        )
        if updated:
            # Update the shared contentions list in-place
            contentions.clear()
            contentions.extend(updated)
            await websocket.send_json({
                "type": "contention_update",
                "contentions": updated,
            })
    except Exception:
        logger.debug("Contention extraction failed (non-critical)")


async def _argument_ref_plot(
    websocket: WebSocket,
    user_text: str,
    ai_text: str,
    existing_graph: dict,
    mode: str,
) -> None:
    """Background task: generate debate diagram for argument_ref/harvey mode."""
    try:
        context = f"User argued: {user_text}"
        if ai_text:
            context += f"\nResponse: {ai_text}"

        plot_result = await plotter_agent.should_plot(
            transcript_chunk=context,
            mode=mode,
            context=context,
            existing_graph=existing_graph,
        )

        if plot_result:
            _merge_graph(existing_graph, plot_result)
            mermaid_code = _graph_to_mermaid(existing_graph)
            if mermaid_code:
                await websocket.send_json({
                    "type": "plot_update",
                    "graph": {
                        **plot_result,
                        "mermaid_code": mermaid_code,
                    },
                })
    except Exception:
        logger.debug("Argument ref plot failed — non-critical")


async def _analyze_debate_plot(
    websocket: WebSocket,
    analysis: dict,
    existing_graph: dict,
) -> None:
    """Background task: generate argument structure diagram from debate analysis."""
    try:
        structure = analysis.get("argument_structure", {})
        parts = [f"Thesis: {structure.get('thesis', 'Unknown')}"]
        for c in structure.get("contentions", []):
            parts.append(
                f"Contention ({c.get('strength', '?')}): {c.get('text', '')}"
            )
            ev = c.get("evidence_cited", "")
            if ev:
                parts.append(f"  Evidence: {ev}")
            needed = c.get("evidence_needed", "")
            if needed:
                parts.append(f"  Missing: {needed}")

        for f in analysis.get("fallacies", []):
            parts.append(f"Fallacy ({f.get('name', '?')}): {f.get('what_was_said', '')}")

        for r in structure.get("rebuttals_missing", []):
            parts.append(f"Missing rebuttal: {r}")

        diagram_instruction = "\n".join(parts)

        plot_result = await plotter_agent.should_plot(
            transcript_chunk=diagram_instruction,
            mode="analyze_debate",
            context=f"Debate analysis: {analysis.get('summary', '')}",
            existing_graph=existing_graph,
        )

        if plot_result:
            _merge_graph(existing_graph, plot_result)
            mermaid_code = _graph_to_mermaid(existing_graph)
            if mermaid_code:
                await websocket.send_json({
                    "type": "plot_update",
                    "graph": {
                        **plot_result,
                        "mermaid_code": mermaid_code,
                    },
                })
    except Exception:
        logger.debug("Analyze debate plot failed — non-critical")


async def _fetch_quiz_context_web(topic: str, mode: str = "quiz", grade_level: str = "", difficulty: str = "") -> str:
    """Fetch domain-specific quiz material via Gemini + Google Search.

    Returns ~1500 words of grounded content with key facts, terminology,
    and common exam questions for the requested topic.
    """
    from google import genai

    # Build a smart search query based on topic + context
    grade_hint = f" {grade_level} level" if grade_level else ""
    difficulty_hint = f" {difficulty}" if difficulty else ""
    if mode == "quiz":
        search_focus = "exam questions, key concepts, terminology, common test topics"
    elif mode == "cram":
        search_focus = "high-yield facts, must-know concepts, rapid review, mnemonics"
    elif mode == "guided_study":
        search_focus = "core concepts, explanations, examples, prerequisite knowledge"
    else:
        search_focus = "key concepts, important facts, fundamentals"

    prompt = (
        f"Research the topic: {topic}{grade_hint}{difficulty_hint}\n\n"
        f"Focus on: {search_focus}\n\n"
        "Provide a comprehensive knowledge dump that covers:\n"
        "1. Key concepts and definitions (be specific and precise)\n"
        "2. Common exam/test questions and their answers for this specific topic\n"
        "3. Important terminology with definitions\n"
        "4. Common misconceptions and tricky points\n"
        "5. Critical facts and numbers students must know\n\n"
        f"IMPORTANT: Stay STRICTLY on the topic of {topic}. "
        "Do NOT drift into related but different subjects. "
        f"If the topic is '{topic}', every fact should be specifically about {topic}, "
        "not adjacent fields.\n\n"
        "Format as a clear reference document, ~1500 words."
    )

    try:
        client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=3000,
                tools=[genai.types.Tool(google_search=genai.types.GoogleSearch())],
            ),
        )
        return response.text or ""
    except Exception:
        logger.exception("Quiz web search failed")
        return ""


async def _fetch_quiz_context_rag(topic: str, class_id: str, count: int = 10) -> str:
    """Fetch quiz material from uploaded course materials via RAG.

    Returns formatted material chunks from the student's actual course content.
    """
    try:
        embedding = await create_embedding(topic)
        results = search_chunks(
            embedding=embedding,
            class_id=class_id,
            threshold=0.30,  # Slightly more permissive for broader recall
            count=count,
        )
        if not results:
            return ""

        chunks = []
        for r in results:
            chunks.append(r.get("content", ""))

        return (
            "## Course Material (from student's uploaded content)\n\n"
            + "\n\n---\n\n".join(chunks)
        )
    except Exception:
        logger.exception("Quiz RAG context fetch failed")
        return ""


async def _extract_smart_topic(user_text: str, class_id: str) -> str:
    """Extract a meaningful topic from a contextual request like 'give me questions based on this'.

    When the user says 'based on this' or 'from my materials', we need to figure out
    what 'this' refers to — typically their uploaded class materials. We pull a broad
    sample of their materials and use Gemini to identify the best topic to quiz on.
    """
    try:
        # Pull a broad sample of the student's materials
        from google import genai

        # Use a general embedding to get diverse chunks
        embedding = await create_embedding("key concepts main topics important ideas")
        results = search_chunks(
            embedding=embedding,
            class_id=class_id,
            threshold=0.20,  # Very permissive — we want breadth
            count=20,
        )

        if not results:
            # Fallback: just clean up the user's text
            return user_text[:200]

        material_sample = "\n\n".join(r.get("content", "")[:500] for r in results[:12])

        prompt = (
            f"The student said: \"{user_text}\"\n\n"
            f"Here is a sample of their uploaded course materials:\n\n{material_sample}\n\n"
            "Based on this, identify the BEST specific topic to quiz/study from their materials. "
            "Return ONLY the topic name — a specific, focused subject area from their content. "
            "Examples of good topics: 'Pharmacokinetics and Drug Metabolism', "
            "'Photosynthesis Light Reactions', 'Binary Search Trees'. "
            "Do NOT return generic topics like 'biology' or 'chapter 3'. "
            "Be specific to what's actually in their materials."
        )

        client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=100,
            ),
        )
        topic = (response.text or "").strip().strip('"').strip("'")
        return topic[:200] if topic else user_text[:200]

    except Exception:
        logger.exception("Smart topic extraction failed")
        return user_text[:200]


async def _general_chat_plot(
    websocket: WebSocket,
    user_text: str,
    ai_text: str,
    existing_graph: dict,
    tool: str = "general_chat",
    plot_mode: str = "general",
) -> None:
    """Background task: generate conversation diagram.

    Uses per-tool graphs so each tool accumulates its own diagram.
    """
    try:
        context = ""
        if user_text:
            context += f"User: {user_text}"
        if ai_text:
            if context:
                context += "\n"
            context += f"Assistant: {ai_text}"
        if not context.strip():
            return

        plot_result = await plotter_agent.should_plot(
            transcript_chunk=context,
            mode=plot_mode,
            context=f"{'Architecture planning' if tool == 'architect' else 'Study'} session. Map concepts and systems discussed.",
            existing_graph=existing_graph,
        )

        if plot_result:
            _merge_graph(existing_graph, plot_result)
            mermaid_code = _graph_to_mermaid(existing_graph)
            if mermaid_code:
                await websocket.send_json({
                    "type": "plot_update",
                    "tool": tool,
                    "graph": {
                        **plot_result,
                        "mermaid_code": mermaid_code,
                    },
                })
    except Exception:
        logger.debug("Plot failed for tool=%s — non-critical", tool)


async def _run_fact_check(
    websocket: WebSocket,
    session_id: str,
    transcript_chunk: str,
    router_instruction: str,
    class_id: str | None,
    topic: str | None,
    claim_registry: ClaimRegistry,
    mode: str = "general",
    existing_graph: dict | None = None,
    tool: str | None = None,
    voice_enabled: bool = True,
) -> None:
    """Background task: deep fact-check with RAG, sends results via WebSocket."""
    try:
        results = await fact_checker_agent.check_claims(
            transcript_chunk=transcript_chunk,
            router_instruction=router_instruction,
            class_id=class_id,
            topic=topic,
            claim_registry=claim_registry,
            mode=mode,
        )

        for result in results:
            # Only notify about incorrect or unverified findings
            if result.status == "verified":
                continue
            # Skip low-confidence assumptions — these are usually
            # conversational statements the user doesn't need to see
            if result.status == "assumption" and result.confidence < 0.6:
                continue

            try:
                await websocket.send_json(
                    {
                        "type": "fact_check",
                        "id": result.id,
                        "claim": result.claim,
                        "status": result.status,
                        "confidence": result.confidence,
                        "correction": result.correction,
                        "explanation": result.explanation,
                        "source_excerpt": result.source_excerpt,
                    }
                )

                # Thought Plot: TTS for incorrect fact-checks — only if voice is enabled
                if tool == "thought_plot" and result.status == "incorrect" and voice_enabled:
                    correction_text = result.correction or f"{result.claim} is incorrect."
                    asyncio.create_task(
                        _send_tts_supplement(websocket, correction_text, "thought_plot", skip=_realtime_active)
                    )

            except Exception:
                logger.debug("WebSocket closed before fact-check delivery")
                return

        # Store corrections in transcript for session context
        incorrect = [r for r in results if r.status == "incorrect"]
        if incorrect:
            corrections_text = "; ".join(
                f"[FACT CHECK] '{r.claim}' → {r.correction}" for r in incorrect
            )
            asyncio.create_task(
                _store_transcript_safe(
                    session_id=session_id, speaker="ai", text=corrections_text
                )
            )

            # Mark matching nodes as incorrect in the graph and re-send
            if existing_graph and existing_graph.get("nodes"):
                graph_updated = False
                for r in incorrect:
                    claim_lower = r.claim.lower()
                    for node in existing_graph["nodes"]:
                        label_lower = node.get("label", "").lower()
                        # Match if claim text overlaps significantly with node label
                        if (label_lower in claim_lower or claim_lower in label_lower
                                or _word_overlap(claim_lower, label_lower) > 0.5):
                            if node.get("type") != "incorrect":
                                node["type"] = "incorrect"
                                graph_updated = True
                if graph_updated:
                    mermaid_code = _graph_to_mermaid(existing_graph)
                    try:
                        await websocket.send_json({
                            "type": "plot_update",
                            "graph": {
                                "nodes": [],
                                "edges": [],
                                "clusters": [],
                                "mermaid_code": mermaid_code,
                            },
                        })
                    except Exception:
                        logger.debug("WebSocket closed before plot re-send")

    except Exception:
        logger.exception("Background fact-check failed for session %s", session_id)


def _word_overlap(a: str, b: str) -> float:
    """Simple word overlap score between two strings."""
    words_a = {w for w in a.split() if len(w) > 2}
    words_b = {w for w in b.split() if len(w) > 2}
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    return (2 * len(intersection)) / (len(words_a) + len(words_b))


def _get_router_mode(tool: str | None, study_mode: str) -> str:
    """Pick the router prompt.  Thought Plot uses a dedicated fact-checking
    prompt; Study Buddy uses the study-mode-specific prompt."""
    if tool == "thought_plot":
        return "thought_plot"
    return study_mode


def _get_voice_mode(tool: str | None, study_mode: str) -> str:
    """Pick the voice prompt.  Thought Plot uses a brief interrupt-style
    prompt; Study Buddy uses the study-mode-specific prompt."""
    if tool == "thought_plot":
        return "thought_plot"
    return study_mode


# Keywords that signal a potential tool switch — used to decide whether to
# run the Orchestrator on continuation messages.  When the user is already
# in an active tool and their message does NOT contain any switch keywords,
# we skip the Orchestrator entirely (saves ~1s).
_SWITCH_KEYWORDS = frozenset({
    "quiz me", "test me", "plan an app", "help me plan", "help me build",
    "debate", "argue with me", "let's debate", "practice debate",
    "map a concept", "thought map", "let's study", "teach me",
    "switch to", "use architect", "use study", "help me design",
})


def _might_switch_tool(text: str) -> bool:
    """Check if user text might signal a tool switch."""
    lower = text.lower().strip()
    return any(kw in lower for kw in _SWITCH_KEYWORDS)


def _build_voice_response(
    text: str,
    audio_bytes: bytes | None,
    router_result: dict,
    *,
    is_interrupt: bool = False,
) -> dict[str, Any]:
    """Assemble the ``ai_response`` WebSocket message."""
    msg: dict[str, Any] = {
        "type": "ai_response",
        "text": text,
        "should_speak": True,
        "is_interrupt": is_interrupt,
        "response_type": router_result.get("response_type", "explanation"),
    }
    if audio_bytes:
        msg["audio_data"] = base64.b64encode(audio_bytes).decode("ascii")
        msg["audio_format"] = "pcm"
        msg["audio_sample_rate"] = 24000
    return msg


def _map_plotter_mode(study_mode: str, class_id: str | None) -> str:
    """Map the study mode + context to the appropriate plotter mode."""
    if class_id:
        return "class_mode"
    mode_map = {
        "quiz": "quiz",
        "guided_study": "guided_study",
        "cram": "general",
        "language": "topic_locked",
        "strategy": "general",
        "general": "general",
    }
    return mode_map.get(study_mode, "general")


def _node_to_mermaid(node: dict) -> str:
    """Render a single node in its type-appropriate Mermaid shape."""
    nid = node.get("id", "")
    label = node.get("label", "").replace('"', "'")
    ntype = node.get("type", "idea")

    if ntype == "decision":
        return f'{nid}{{"{label}"}}'         # diamond / rhombus
    elif ntype == "system":
        return f'{nid}[["{label}"]]'         # subroutine (double bracket)
    elif ntype == "person":
        return f'{nid}(["{label}"])'         # stadium
    elif ntype == "process":
        return f'{nid}("{label}")'           # rounded rectangle
    elif ntype == "action":
        return f'{nid}[/"{label}"\\]'        # trapezoid
    elif ntype == "assumption":
        return f'{nid}(("{label}"))'         # double circle
    elif ntype == "fact":
        return f'{nid}["{label}"]'           # rectangle
    else:  # idea, concept, etc.
        return f'{nid}("{label}")'           # rounded rectangle


def _graph_to_mermaid(graph: dict) -> str:
    """Convert a graph dict (nodes + edges + clusters) to rich Mermaid syntax."""
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    clusters = graph.get("clusters", [])

    if not nodes:
        return ""

    # Filter out orphan nodes (no edges) — they create visual clutter
    connected_ids: set[str] = set()
    for edge in edges:
        connected_ids.add(edge.get("from", ""))
        connected_ids.add(edge.get("to", ""))
    # Keep nodes that have edges, or keep all if there are very few (≤3)
    if len(nodes) > 3:
        nodes = [n for n in nodes if n.get("id") in connected_ids]
        # Also update graph in-place so orphans don't accumulate
        graph["nodes"] = nodes

    if not nodes:
        return ""

    lines = ["flowchart TD"]

    # classDef styling — rounded, distinct colors, dark-mode palette
    lines.append("  classDef process fill:#c4a882,stroke:#3d3a35,color:#141413,rx:12,ry:12")
    lines.append("  classDef decision fill:#e0b85e,stroke:#8b6914,color:#141413,rx:12,ry:12")
    lines.append("  classDef action fill:#5a9fd4,stroke:#2a6a9e,color:#141413,rx:12,ry:12")
    lines.append("  classDef fact fill:#6b9e5a,stroke:#3d6b2e,color:#141413,rx:12,ry:12")
    lines.append("  classDef assumption fill:#cc5040,stroke:#7f1d1d,color:#faf9f5,rx:12,ry:12,stroke-dasharray:5")
    lines.append("  classDef system fill:#5a9e9e,stroke:#2e6b6b,color:#faf9f5,rx:12,ry:12")
    lines.append("  classDef person fill:#8b7ec8,stroke:#5a4ea0,color:#faf9f5,rx:12,ry:12")
    lines.append("  classDef idea fill:#b86e7e,stroke:#7e3a4a,color:#faf9f5,rx:12,ry:12")
    lines.append("  classDef incorrect fill:#ef4444,stroke:#7f1d1d,color:#faf9f5,rx:12,ry:12,stroke-width:3px,stroke-dasharray:5")

    clustered_node_ids: set[str] = set()
    for cluster in clusters:
        for nid in cluster.get("node_ids", []):
            clustered_node_ids.add(nid)

    node_map: dict[str, dict] = {n["id"]: n for n in nodes}

    for cluster in clusters:
        cid = cluster.get("id", "")
        clabel = cluster.get("label", "").replace('"', "'")
        lines.append(f'  subgraph {cid}["{clabel}"]')
        for nid in cluster.get("node_ids", []):
            node = node_map.get(nid)
            if node:
                lines.append(f"    {_node_to_mermaid(node)}")
        lines.append("  end")

    for node in nodes:
        if node.get("id") not in clustered_node_ids:
            lines.append(f"  {_node_to_mermaid(node)}")

    for edge in edges:
        src = edge.get("from", "")
        dst = edge.get("to", "")
        label = edge.get("label", "").replace('"', "'")
        style = edge.get("style", "solid")

        if style in ("dashed", "dotted"):
            if label:
                lines.append(f'  {src} -. "{label}" .-> {dst}')
            else:
                lines.append(f"  {src} -.-> {dst}")
        else:
            if label:
                lines.append(f'  {src} -->|"{label}"| {dst}')
            else:
                lines.append(f"  {src} --> {dst}")

    valid_types = {"process", "decision", "action", "fact", "assumption", "system", "person", "idea"}
    for node in nodes:
        ntype = node.get("type", "idea")
        nid = node.get("id", "")
        if ntype in valid_types:
            lines.append(f"  class {nid} {ntype}")

    return "\n".join(lines)


def _merge_graph(existing: dict, update: dict) -> None:
    """Merge new nodes, edges, and clusters into the existing graph."""
    existing_node_ids = {n["id"] for n in existing.get("nodes", [])}

    # Determine which new node IDs appear in edges (existing or new)
    all_edge_ids: set[str] = set()
    for edge in existing.get("edges", []):
        all_edge_ids.add(edge.get("from", ""))
        all_edge_ids.add(edge.get("to", ""))
    for edge in update.get("edges", []):
        all_edge_ids.add(edge.get("from", ""))
        all_edge_ids.add(edge.get("to", ""))

    for node in update.get("nodes", []):
        nid = node["id"]
        if nid not in existing_node_ids:
            # Only add nodes that participate in at least one edge
            if nid in all_edge_ids or len(existing.get("nodes", [])) < 3:
                existing.setdefault("nodes", []).append(node)
                existing_node_ids.add(nid)

    existing_edge_set = {
        (e.get("from", e.get("source", "")), e["to"])
        for e in existing.get("edges", [])
    }

    for edge in update.get("edges", []):
        edge_key = (edge.get("from", ""), edge.get("to", ""))
        if edge_key not in existing_edge_set:
            existing.setdefault("edges", []).append(edge)
            existing_edge_set.add(edge_key)

    existing_cluster_ids = {c["id"] for c in existing.get("clusters", [])}

    for cluster in update.get("clusters", []):
        if cluster["id"] not in existing_cluster_ids:
            existing.setdefault("clusters", []).append(cluster)
            existing_cluster_ids.add(cluster["id"])
        else:
            for ec in existing.get("clusters", []):
                if ec["id"] == cluster["id"]:
                    existing_nids = set(ec.get("node_ids", []))
                    for nid in cluster.get("node_ids", []):
                        if nid not in existing_nids:
                            ec.setdefault("node_ids", []).append(nid)
                            existing_nids.add(nid)
                    break

    if "graph_type" in update:
        existing["graph_type"] = update["graph_type"]


async def _store_transcript_safe(
    session_id: str, speaker: str, text: str
) -> None:
    """Store a transcript entry, swallowing exceptions."""
    try:
        import time
        store_transcript(
            {
                "session_id": session_id,
                "speaker": speaker,
                "text": text,
                "timestamp_ms": int(time.time() * 1000),
            }
        )
    except Exception:
        logger.warning(
            "Failed to store transcript for session %s", session_id, exc_info=True
        )


# ===================================================================
# OpenAI Realtime API helpers
# ===================================================================

from agents.prompts import (
    VOICE_PROMPTS,
    ARCHITECT_SYSTEM_PROMPT,
    HARVEY_SPECTER_PROMPT,
)


def _build_realtime_system_prompt(tool: str | None, mode: str) -> str:
    """Build the system prompt for an OpenAI Realtime session.

    Combines the base Gideon personality with tool-specific overlays
    adapted from the existing VOICE_PROMPTS.
    """
    base = (
        "You are Gideon, a brilliant AI study companion and assistant. "
        "You are warm, conversational, and genuinely helpful. "
        "Keep responses concise — 2-4 sentences — since you are speaking aloud.\n\n"
        "You have access to tool functions. When the student wants to study, "
        "be quizzed, debate, plan software, or map concepts, call activate_tool "
        "with the appropriate tool and mode. When they want to switch back to "
        "general chat, call deactivate_tool.\n\n"
        "Available tools:\n"
        "- study_buddy: Tutoring (modes: quiz, guided_study, cram, language, strategy, general)\n"
        "- architect: Software architecture planning\n"
        "- argument_ref: Debate training (modes: referee, harvey)\n"
        "- thought_plot: Concept mapping and fact-checking\n\n"
        "CRITICAL RULES:\n"
        "- Never say 'As an AI' or reference being a language model.\n"
        "- Be natural and conversational, like a smart friend.\n"
        "- Even when a tool is active, ALWAYS watch for intent to switch tools. "
        "If someone in quiz mode says 'help me plan an app', call activate_tool for architect.\n"
        "- Match the student's energy. If they're excited, be excited. If they're "
        "focused, be focused."
    )

    # Tool-specific overlays
    _overlays: dict[str, dict[str, str]] = {
        "study_buddy": {
            "quiz": (
                "\n\nYou are now in QUIZ MODE. You are an encouraging quiz-master.\n"
                "- Ask one question at a time, starting easy and increasing difficulty.\n"
                "- When correct: brief praise, then harder question.\n"
                "- When wrong: state correct answer clearly, explain briefly, ask simpler follow-up.\n"
                "- Hint progression: category hint → partial answer → full answer + explanation.\n"
                "- Keep it fast-paced. 1-3 sentences max."
            ),
            "guided_study": (
                "\n\nYou are now in GUIDED STUDY mode. Patient, knowledgeable tutor.\n"
                "- Explain with analogies and real-world examples.\n"
                "- Connect new concepts to what the student already knows.\n"
                "- After explaining, ask a specific comprehension check.\n"
                "- Build on what the student said. 2-4 sentences."
            ),
            "cram": (
                "\n\nYou are now in CRAM MODE. High-energy, direct.\n"
                "- Lead with the most important fact. No filler.\n"
                "- Bullet-point speech: 'Three things: first... second... third...'\n"
                "- Provide mnemonics. Correct immediately — no Socratic method.\n"
                "- 1-3 punchy sentences. Say 'This is critical' for high-yield facts."
            ),
            "language": (
                "\n\nYou are now in LANGUAGE mode. Immersive language tutor.\n"
                "- Speak primarily in the target language.\n"
                "- Correct errors naturally in a sentence, then briefly explain.\n"
                "- Ask follow-ups in the target language.\n"
                "- Adapt to level: beginner=simple/slow, intermediate=moderate, advanced=full speed with idioms."
            ),
            "strategy": (
                "\n\nYou are now a STUDY STRATEGY coach.\n"
                "- Give specific, actionable advice — not generic 'study more'.\n"
                "- Suggest techniques by material type (flashcards for vocab, practice for math).\n"
                "- Create concrete plans with what/order/duration. 2-4 sentences."
            ),
            "general": (
                "\n\nYou are now a STUDY TUTOR in general mode.\n"
                "- When any topic is mentioned, TEACH IT immediately.\n"
                "- Start with key concept, why it matters, concrete example.\n"
                "- After explaining, ask a comprehension question.\n"
                "- Use real-world analogies. 2-4 sentences."
            ),
        },
        "architect": {
            "default": (
                "\n\nYou are now the ARCHITECT — a senior CTO helping plan software.\n"
                "- YOU make technical decisions. Don't ask 'What framework?' — recommend one.\n"
                "- Only ask about BUSINESS needs: what users do, who they are, how many.\n"
                "- Name exact services (Supabase, not 'a database'). Give realistic costs.\n"
                "- Keep responses SHORT (3-5 sentences). Be confident and opinionated.\n"
                "- End with 1-2 brief next topics to explore."
            ),
        },
        "argument_ref": {
            "referee": (
                "\n\nYou are now the ARGUMENT REFEREE.\n"
                "- Detect and call out logical fallacies immediately by name.\n"
                "- Be direct: 'That's an ad hominem. You attacked the person, not the argument.'\n"
                "- Track argument structure. Note when evidence is cited vs assumed.\n"
                "- Stay neutral — evaluate both sides fairly."
            ),
            "harvey": (
                "\n\nYou are now HARVEY SPECTER — aggressive opposing counsel.\n"
                "- Take the opposing side of EVERY argument the student makes.\n"
                "- Use evidence and logic to dismantle weak claims.\n"
                "- Be confident, sharp, and cutting. 2-4 sentences.\n"
                "- Phrases like: 'That's cute, but...', 'The data says otherwise.', "
                "'I'll give you that one. But...'"
            ),
            "default": (
                "\n\nYou are a DEBATE COACH helping improve argumentation skills.\n"
                "- Detect fallacies and weak arguments.\n"
                "- Suggest stronger formulations.\n"
                "- Track the argument structure."
            ),
        },
        "thought_plot": {
            "default": (
                "\n\nYou are now in THOUGHT PLOT mode — the student is thinking out loud and mapping ideas.\n"
                "CRITICAL: BE COMPLETELY PASSIVE AND SILENT.\n"
                "- Do NOT speak. Do NOT respond. Do NOT ask questions. Do NOT interrupt.\n"
                "- The student wants to talk freely without any AI interruption.\n"
                "- You are a silent listener. The backend handles fact-checking and diagrams separately.\n"
                "- If the student directly asks you a question, give a brief 1-sentence answer, then go silent.\n"
                "- NEVER ask follow-up questions. NEVER prompt them to continue. Just be quiet."
            ),
        },
    }

    if not tool:
        return base

    tool_set = _overlays.get(tool, {})
    overlay = tool_set.get(mode, tool_set.get("default", ""))
    return base + overlay


def _build_realtime_tools() -> list[dict]:
    """Build function tool definitions for the OpenAI Realtime session."""
    return [
        {
            "type": "function",
            "name": "activate_tool",
            "description": (
                "Activate a specialized tool when the student's intent clearly requires it. "
                "Call this when the student wants to: be quizzed (study_buddy/quiz), "
                "study with guidance (study_buddy/guided_study), cram (study_buddy/cram), "
                "practice a language (study_buddy/language), plan software (architect), "
                "debate or argue (argument_ref/referee or argument_ref/harvey), "
                "or map concepts visually (thought_plot)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "tool": {
                        "type": "string",
                        "enum": [
                            "study_buddy",
                            "architect",
                            "argument_ref",
                            "thought_plot",
                        ],
                    },
                    "mode": {
                        "type": "string",
                        "description": (
                            "Sub-mode for the tool. "
                            "study_buddy: quiz, guided_study, cram, language, strategy, general. "
                            "architect: general. "
                            "argument_ref: referee, harvey. "
                            "thought_plot: general."
                        ),
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief user-facing explanation of why this tool was activated.",
                    },
                },
                "required": ["tool", "mode", "reason"],
            },
        },
        {
            "type": "function",
            "name": "deactivate_tool",
            "description": (
                "Return to general conversation. Call when the student wants to stop "
                "using the current tool, switch back, or just chat."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Brief explanation of why deactivating.",
                    },
                },
            },
        },
    ]
