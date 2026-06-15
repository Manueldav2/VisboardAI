/**
 * Gemini Live — pure transcription mode.
 * Streams PCM audio → gets back inputAudioTranscription text.
 * TEXT-only response modality for stability (no audio output).
 */

import { GoogleGenAI, Modality } from '@google/genai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

export interface GeminiLiveCallbacks {
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (error: string) => void;
  onTranscript: (text: string) => void;
}

export class GeminiLiveService {
  private session: any = null;
  private connected = false;
  private intentionalDisconnect = false;
  private callbacks: GeminiLiveCallbacks;

  constructor(callbacks: GeminiLiveCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(): Promise<boolean> {
    if (!API_KEY) {
      this.callbacks.onError('Gemini API key not set');
      return false;
    }

    this.intentionalDisconnect = false;

    try {
      const genAI = new GoogleGenAI({ apiKey: API_KEY });

      this.session = await genAI.live.connect({
        model: 'gemini-2.5-flash-preview-native-audio-dialog',
        config: {
          responseModalities: [Modality.TEXT],
          systemInstruction: { parts: [{ text: 'You are a silent transcription assistant. Do not respond to anything. Just listen.' }] },
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            this.connected = true;
            this.callbacks.onConnected();
          },
          onmessage: (msg: any) => this.handleMessage(msg),
          onerror: (err: any) => {
            console.error('Gemini Live error:', err);
            this.connected = false;
            this.callbacks.onError(String(err?.message || err));
          },
          onclose: () => {
            this.connected = false;
            if (!this.intentionalDisconnect) {
              console.log('Gemini Live session ended');
            }
            this.callbacks.onDisconnected();
          },
        },
      });

      return true;
    } catch (err: any) {
      console.error('Gemini Live connect failed:', err);
      this.callbacks.onError(String(err?.message || err));
      return false;
    }
  }

  private handleMessage(msg: any) {
    // Input audio transcription — the only thing we care about
    const inputTranscript =
      msg.serverContent?.inputTranscript ||
      msg.serverContent?.inputAudioTranscription?.transcript ||
      msg.inputTranscript ||
      msg.inputAudioTranscription?.transcript;

    if (inputTranscript) {
      const text = String(inputTranscript).trim();
      if (text.length > 0) {
        this.callbacks.onTranscript(text);
      }
    }
    // Ignore all model responses — we told it to be silent
  }

  sendAudio(pcmBase64: string): void {
    if (!this.session || !this.connected) return;
    try {
      this.session.sendRealtimeInput({
        media: { data: pcmBase64, mimeType: 'audio/pcm;rate=16000' },
      });
    } catch {
      // connection closed
    }
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.session) {
      try { this.session.close(); } catch { /* ignore */ }
      this.session = null;
    }
    this.connected = false;
  }

  get isConnected(): boolean {
    return this.connected;
  }
}

/** Browser TTS for speaking corrections */
export function speakCorrection(text: string): void {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 0.9;
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.name.includes('Samantha') || v.name.includes('Google') || v.lang.startsWith('en')
  );
  if (preferred) utterance.voice = preferred;
  speechSynthesis.speak(utterance);
}
