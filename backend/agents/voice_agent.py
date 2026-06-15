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


async def generate_tts(text: str, mode: str = "general") -> bytes | None:
    """Standalone TTS — generate audio from text. Used as background supplement.

    Runs independently so the text response can be sent to the client first.
    """
    speech_text = _clean_for_speech(text)
    if not speech_text:
        return None

    voice_name = _MODE_VOICES.get(mode, _DEFAULT_VOICE)

    return await _tts_with_retry(speech_text, voice_name, mode)
