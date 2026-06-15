/**
 * OpenAI Whisper — fallback transcription when Gemini Live transcription unavailable.
 */

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || '';

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

  const formData = new FormData();
  const mimeType = audioBlob.type || '';
  let ext = 'webm';
  if (mimeType.includes('mp4')) ext = 'mp4';
  else if (mimeType.includes('ogg')) ext = 'ogg';
  else if (mimeType.includes('wav')) ext = 'wav';
  else if (mimeType.includes('webm')) ext = 'webm';
  else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) ext = 'mp3';
  formData.append('file', audioBlob, `recording.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');
  formData.append('response_format', 'text');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  if (!res.ok) throw new Error(`Whisper error: ${await res.text()}`);
  return (await res.text()).trim();
}
