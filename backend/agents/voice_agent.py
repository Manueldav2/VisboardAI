"""Agent 2 -- Voice Response Agent.

Uses Gemini 2.0 Flash (REST) to generate the actual spoken response text
based on instructions from the Router Agent. Optionally generates audio
via Gemini TTS for human-sounding voice output.
"""

from __future__ import annotations

import asyncio
import logging
import os

from dotenv import load_dotenv
from google import genai

from agents.prompts import VOICE_PROMPTS, DEFAULT_VOICE_PROMPT

load_dotenv()

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-2.5-flash"
TTS_MODEL = "gemini-2.5-flash-preview-tts"

# Retry config for TTS reliability
TTS_MAX_RETRIES = 3
TTS_RETRY_DELAY = 0.5   # initial delay; doubles each retry (exp backoff)
TTS_TIMEOUT = 12.0       # hard timeout per attempt — fail fast
TTS_CHUNK_MAX_CHARS = 200  # shorter chunks are more reliable

# Map modes to distinct Gemini voices for natural, varied speech
_MODE_VOICES: dict[str, str] = {
    # Study Buddy modes
    "quiz": "Puck",            # Energetic, encouraging quiz-master
    "guided_study": "Kore",    # Patient, warm tutor
    "cram": "Charon",          # Direct, fast-paced
    "language": "Aoede",       # Fluid, natural conversationalist
    "strategy": "Kore",        # Measured, thoughtful coach
    "general": "Puck",         # Friendly study buddy
    # Thought Plot — brief interruptions
    "thought_plot": "Fenrir",  # Clear, concise corrector
    # Tool-specific voices (architect, referee, harvey)
    "architect": "Aoede",      # Thoughtful architecture advisor
    "referee": "Charon",       # Authoritative debate referee
    "harvey": "Fenrir",        # Bold Harvey Specter voice
    "general_chat": "Fenrir",  # General chat voice
}

_DEFAULT_VOICE = "Puck"


async def _tts_single_chunk(speech_text: str, voice_name: str, mode: str) -> bytes | None:
    """Call Gemini TTS for a single chunk with retries and exponential backoff."""
    delay = TTS_RETRY_DELAY
    for attempt in range(1, TTS_MAX_RETRIES + 1):
        try:
            response = await asyncio.wait_for(
                _client.aio.models.generate_content(
                    model=TTS_MODEL,
                    contents=speech_text,
                    config=genai.types.GenerateContentConfig(
                        response_modalities=["AUDIO"],
                        speech_config=genai.types.SpeechConfig(
                            voice_config=genai.types.VoiceConfig(
                                prebuilt_voice_config=genai.types.PrebuiltVoiceConfig(
                                    voice_name=voice_name,
                                )
                            )
                        ),
                    ),
                ),
                timeout=TTS_TIMEOUT,
            )

            if response.candidates:
                for part in response.candidates[0].content.parts:
                    if hasattr(part, "inline_data") and part.inline_data:
                        if attempt > 1:
                            logger.info("TTS succeeded on attempt %d for mode=%s", attempt, mode)
                        return part.inline_data.data

            logger.warning("TTS attempt %d/%d: no audio data for mode=%s voice=%s",
                           attempt, TTS_MAX_RETRIES, mode, voice_name)

        except asyncio.TimeoutError:
            logger.warning("TTS attempt %d/%d timed out (%.0fs) for mode=%s",
                           attempt, TTS_MAX_RETRIES, TTS_TIMEOUT, mode)

        except Exception as e:
            logger.warning("TTS attempt %d/%d failed for mode=%s voice=%s: %s",
                           attempt, TTS_MAX_RETRIES, mode, voice_name, str(e))

        if attempt < TTS_MAX_RETRIES:
            await asyncio.sleep(delay)
            delay = min(delay * 2, 8.0)  # exponential backoff, cap at 8s

    logger.error("TTS exhausted all %d retries for mode=%s voice=%s", TTS_MAX_RETRIES, mode, voice_name)
    return None


def _split_tts_chunks(text: str) -> list[str]:
    """Split text into TTS-friendly chunks at sentence boundaries.

    Gemini TTS is most reliable with shorter inputs. We split on sentence
    endings so each chunk sounds natural.
    """
    import re
    if len(text) <= TTS_CHUNK_MAX_CHARS:
        return [text]

    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    chunks: list[str] = []
    current = ""
    for s in sentences:
        if current and len(current) + len(s) + 1 > TTS_CHUNK_MAX_CHARS:
            chunks.append(current.strip())
            current = s
        else:
            current = f"{current} {s}".strip() if current else s
    if current:
        chunks.append(current.strip())
    return chunks


async def _tts_with_retry(speech_text: str, voice_name: str, mode: str) -> bytes | None:
    """Generate TTS audio, splitting long text into chunks for reliability.

    Short text (<350 chars) goes in a single call. Longer text is split at
    sentence boundaries, each chunk synthesised independently, and the raw
    PCM audio is concatenated.
    """
    chunks = _split_tts_chunks(speech_text)

    if len(chunks) == 1:
        return await _tts_single_chunk(chunks[0], voice_name, mode)

    # Synthesise chunks concurrently for speed
    tasks = [_tts_single_chunk(c, voice_name, mode) for c in chunks]
    results = await asyncio.gather(*tasks)

    # Concatenate PCM bytes in order — skip any failed chunks
    audio_parts = [r for r in results if r]
    if not audio_parts:
        return None

    return b"".join(audio_parts)


def _clean_for_speech(text: str) -> str:
    """Strip markdown and formatting that sounds weird when spoken aloud."""
    import re
    # Remove markdown bold/italic
    text = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)
    # Remove markdown headers
    text = re.sub(r'^#{1,4}\s+', '', text, flags=re.MULTILINE)
    # Remove markdown links [text](url) → text
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    # Remove bullet points
    text = re.sub(r'^[\-\*]\s+', '', text, flags=re.MULTILINE)
    # Remove numbered list prefixes
    text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)
    # Remove backtick code formatting
    text = re.sub(r'`([^`]+)`', r'\1', text)
    # Collapse multiple newlines
    text = re.sub(r'\n{2,}', '. ', text)
    text = re.sub(r'\n', ' ', text)
    # Clean up any leftover double spaces
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip().strip('"').strip("'")


async def generate_response(
    instruction: str,
    transcript: str,
    mode: str,
    context: str,
) -> str:
    """Generate the spoken response text for the student.

    Args:
        instruction: What to say and why (from the Router Agent).
        transcript: Recent transcript text for conversational continuity.
        mode: Current study mode (determines the system prompt).
        context: Assembled session context from the memory service.

    Returns:
        The text that should be spoken aloud to the student.
    """
    system_prompt = VOICE_PROMPTS.get(mode, DEFAULT_VOICE_PROMPT)

    user_content = (
        f"## Session Context\n{context}\n\n"
        f"## Recent Transcript\n{transcript}\n\n"
        f"## Instruction\n{instruction}\n\n"
        "Generate ONLY the spoken response text. Do not include stage "
        "directions, action descriptions, or metadata. The text will be "
        "read aloud via text-to-speech."
    )

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=user_content,
            config=genai.types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.6,
                max_output_tokens=200,
            ),
        )

        text = response.text
        if not text:
            logger.warning("Gemini returned empty response for mode=%s", mode)
            return ""

        # Strip any accidental markdown formatting or quotes that would
        # sound odd when spoken aloud.
        text = text.strip().strip('"').strip("'")
        return text

    except Exception:
        logger.exception("Voice agent failed for mode=%s", mode)
        return ""


async def generate_direct_response(
    user_text: str,
    conversation_history: list[dict],
    context: str,
) -> str:
    """Generate a conversational response directly — no Router needed.

    Used for general_chat where the Router is redundant (always responds).
    Single Gemini Flash call replaces what was Router + Voice (saves ~650ms).
    """
    system_prompt = VOICE_PROMPTS.get("general_chat", DEFAULT_VOICE_PROMPT)

    # Build conversation thread
    conv_lines = []
    for h in conversation_history[-6:]:
        role = "Student" if h.get("role") == "user" else "Gideon"
        conv_lines.append(f"{role}: {h.get('text', '')}")

    user_content = f"## Session Context\n{context}\n\n"
    if conv_lines:
        user_content += "## Recent Conversation\n" + "\n".join(conv_lines) + "\n\n"
    user_content += (
        f"## Student's Latest Message\n{user_text}\n\n"
        "Generate ONLY the spoken response text. Be conversational and natural. "
        "Do not include stage directions, action descriptions, or metadata. "
        "The text will be read aloud via text-to-speech."
    )

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=user_content,
            config=genai.types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.6,
                max_output_tokens=150,
            ),
        )

        text = response.text
        if not text:
            logger.warning("Direct response returned empty for general_chat")
            return ""

        return text.strip().strip('"').strip("'")

    except Exception:
        logger.exception("Direct response failed for general_chat")
        return ""


async def generate_audio_response(
    instruction: str,
    transcript: str,
    mode: str,
    context: str,
) -> tuple[str, bytes | None]:
    """Generate spoken response with optional Gemini TTS audio.

    Returns a (text, audio_bytes) tuple. If audio generation fails,
    audio_bytes is None and the frontend falls back to browser TTS.
    """
    # Always generate text first (needed for transcript display)
    text = await generate_response(instruction, transcript, mode, context)
    if not text:
        return ("", None)

    # Clean text for natural speech (strip markdown, formatting)
    speech_text = _clean_for_speech(text)
    if not speech_text:
        return (text, None)

    # Pick the voice for this mode
    voice_name = _MODE_VOICES.get(mode, _DEFAULT_VOICE)

    # Synthesise audio via Gemini TTS with retry
    audio_bytes = await _tts_with_retry(speech_text, voice_name, mode)
    return (text, audio_bytes)


async def transcribe_audio(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """Transcribe a short audio chunk to text with Gemini (verbatim).

    Used by the desktop listener, which streams mic/system audio chunks
    instead of browser speech-to-text. Returns '' on silence/failure.
    """
    if not audio_bytes:
        return ""
    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=[
                genai.types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
                "Transcribe this audio to text verbatim. Return ONLY the spoken words, "
                "no commentary, no timestamps, no speaker labels. If there is no clear "
                "speech, return an empty string.",
            ],
            config=genai.types.GenerateContentConfig(
                temperature=0,
                max_output_tokens=1024,
                thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
            ),
        )
        text = (response.text or "").strip()
        # Gemini sometimes says this when there's nothing to transcribe.
        low = text.lower()
        if not text or low in ("(no speech)", "no speech", "[no speech]", "...") or "no clear speech" in low:
            return ""
        return text
    except Exception:
        logger.exception("Audio transcription failed")
        return ""


async def answer_question(question: str, context: str = "") -> str:
    """Copilot Q&A for the desktop listener.

    Answers the user's question using the recent conversation/meeting
    transcript as context. Concise, directly useful — like a meeting copilot.
    """
    if not question.strip():
        return ""
    sys = (
        "You are Gideon, a sharp real-time meeting copilot. Answer the user's "
        "question directly and concisely using the meeting transcript for context. "
        "If they ask what to say, give them the actual words. If they ask for a "
        "summary, give tight bullets. Never say 'as an AI'. 2-5 sentences unless "
        "bullets are clearly better."
    )
    user = (
        (f"## Meeting transcript so far\n{context}\n\n" if context.strip() else "")
        + f"## Question\n{question}"
    )
    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=user,
            config=genai.types.GenerateContentConfig(
                system_instruction=sys,
                temperature=0.4,
                max_output_tokens=700,
                thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
            ),
        )
        return (response.text or "").strip()
    except Exception:
        logger.exception("Copilot answer failed")
        return "I couldn't answer that just now — try again."


_TERMS_SCHEMA = {
    "type": "object",
    "properties": {
        "terms": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "term": {"type": "string"},
                    "definition": {"type": "string"},
                },
                "required": ["term", "definition"],
            },
        }
    },
    "required": ["terms"],
}


async def extract_terms(text: str) -> list[dict]:
    """Pull out abbreviations / acronyms / jargon a listener might not know
    and define each in one line (CAC, LP, ARR, TAM, SDK, etc.). [] if none."""
    if not text or len(text) < 8:
        return []
    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=(
                f"Transcript: {text}\n\n"
                "List any abbreviations, acronyms, or specialized jargon a general "
                "listener might not know (business, finance, tech, legal, medical — "
                "e.g. CAC, LP, ARR, TAM, EBITDA, SDK). For each give a concise "
                "one-sentence definition in this context. Ignore common words and "
                "proper names. Return an empty list if there are none."
            ),
            config=genai.types.GenerateContentConfig(
                temperature=0,
                max_output_tokens=700,
                thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
                response_mime_type="application/json",
                response_schema=_TERMS_SCHEMA,
            ),
        )
        import json as _json
        data = _json.loads(response.text or "{}")
        return [t for t in data.get("terms", []) if t.get("term") and t.get("definition")]
    except Exception:
        logger.debug("term extraction failed", exc_info=True)
        return []


async def generate_title(transcript: str, notes: str = "") -> str:
    """A short, human title for the meeting/note from its content (3-6 words)."""
    src = (notes + "\n" + transcript).strip()
    if len(src) < 12:
        return ""
    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=(
                f"{src[:4000]}\n\n"
                "Give a concise, specific title for this conversation in 3-6 words, "
                "based ONLY on what is actually said above. Do not invent a topic or "
                "meeting type that isn't there — if it's just small talk or a brief "
                "note, title it plainly (e.g. 'Quick Personal Check-in'). "
                "No quotes, no punctuation at the end, Title Case. Return ONLY the title."
            ),
            config=genai.types.GenerateContentConfig(
                temperature=0.2, max_output_tokens=30,
                thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
            ),
        )
        return (response.text or "").strip().strip('"').splitlines()[0][:70]
    except Exception:
        return ""


async def enhance_notes(transcript: str, notes: str = "", title: str = "") -> str:
    """Granola-style: turn a rough note + the meeting transcript into clean,
    structured meeting notes (markdown). The transcript is the source of truth;
    the user's rough notes signal what THEY cared about."""
    if not transcript.strip() and not notes.strip():
        return ""
    sys = (
        "You are Gideon, an elite meeting note-taker. Turn the transcript into "
        "clean, skimmable notes in Markdown.\n\n"
        "ABSOLUTE RULE — GROUND EVERYTHING IN THE TRANSCRIPT:\n"
        "- Only write things that were ACTUALLY said. Never invent decisions, "
        "action items, owners, names, teams, metrics, goals, or topics. If it is "
        "not in the transcript or the user's notes, it does not go in the notes.\n"
        "- Do NOT infer a 'type' of meeting and fill in what such a meeting would "
        "typically cover. No plausible-sounding filler.\n"
        "- A section that has no real content is OMITTED entirely. Do not pad with "
        "generic bullets to make it look complete.\n"
        "- If the transcript is short, casual, rambling, or has no substantive "
        "discussion, just write a one-line '## TL;DR' that literally reflects what "
        "was said (e.g. 'Brief personal check-in; mentioned ARR is high.') and stop "
        "there. Never manufacture a business meeting out of small talk.\n\n"
        "Weave in what the user jotted (it signals what matters to them). Use these "
        "sections, INCLUDING ONLY the ones with real content:\n\n"
        "## TL;DR (1-3 sentences)\n## Key points (bullets)\n## Decisions (bullets)\n"
        "## Action items (bullets, '- [ ] owner — task' — only if an owner+task was "
        "actually stated)\n## Open questions (bullets — only questions actually "
        "raised)\n\nBe concise and specific. Use the real names/terms from the "
        "transcript. No preamble, no 'here are your notes'."
    )
    user = (
        (f"# {title}\n\n" if title.strip() else "")
        + (f"## The user's rough notes\n{notes}\n\n" if notes.strip() else "")
        + f"## Transcript\n{transcript}"
    )
    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=user,
            config=genai.types.GenerateContentConfig(
                system_instruction=sys,
                temperature=0.15,
                max_output_tokens=1600,
                thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
            ),
        )
        return (response.text or "").strip()
    except Exception:
        logger.exception("note enhancement failed")
        return ""


async def generate_tts(text: str, mode: str = "general") -> bytes | None:
    """Standalone TTS — generate audio from text. Used as background supplement.

    Runs independently so the text response can be sent to the client first.
    """
    speech_text = _clean_for_speech(text)
    if not speech_text:
        return None

    voice_name = _MODE_VOICES.get(mode, _DEFAULT_VOICE)

    return await _tts_with_retry(speech_text, voice_name, mode)
