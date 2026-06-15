/**
 * Voice Recorder with VAD — streams PCM to Gemini Live
 * and optionally records chunks for Whisper fallback.
 */

export interface RecorderCallbacks {
  onPCMData: (base64Pcm: string) => void;
  onSpeechSegment: (blob: Blob) => void;
  onVolume: (rms: number) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
}

export interface RecorderOptions {
  /** Skip MediaRecorder when Gemini Live handles transcription */
  skipMediaRecorder?: boolean;
}

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private callbacks: RecorderCallbacks;
  private opts: RecorderOptions;
  private active = false;

  // VAD
  private isSpeaking = false;
  private silenceStart = 0;
  private speechStart = 0;
  private vadThreshold = 0.012;
  private silenceTimeout = 1800;
  private minSpeechDuration = 300;
  private maxSegmentDuration = 30000;

  constructor(callbacks: RecorderCallbacks, opts: RecorderOptions = {}) {
    this.callbacks = callbacks;
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: 16000 });
    // Resume suspended AudioContext (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => this.processAudio(e);
    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    // MediaRecorder for Whisper fallback (optional)
    if (!this.opts.skipMediaRecorder) {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';

      if (mimeType) {
        this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.chunks.push(e.data);
        };
        this.mediaRecorder.onstop = () => {
          if (this.chunks.length > 0) {
            const blob = new Blob(this.chunks, { type: mimeType });
            this.chunks = [];
            if (blob.size > 1000) this.callbacks.onSpeechSegment(blob);
          }
        };
      }
    }

    this.active = true;
  }

  private processAudio(e: AudioProcessingEvent): void {
    if (!this.active) return;
    const input = e.inputBuffer.getChannelData(0);

    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    this.callbacks.onVolume(rms);

    // Float32 → Int16 PCM → base64
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const bytes = new Uint8Array(pcm.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    this.callbacks.onPCMData(btoa(binary));

    // VAD
    const now = Date.now();
    if (rms > this.vadThreshold) {
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.speechStart = now;
        this.silenceStart = 0;
        this.callbacks.onSpeechStart();
        this.startRecording();
      } else {
        this.silenceStart = 0;
      }
      if (now - this.speechStart > this.maxSegmentDuration) {
        this.flushSegment();
        this.speechStart = now;
        this.startRecording();
      }
    } else if (this.isSpeaking) {
      if (this.silenceStart === 0) {
        this.silenceStart = now;
      } else if (now - this.silenceStart > this.silenceTimeout) {
        if (now - this.speechStart > this.minSpeechDuration) {
          this.flushSegment();
        } else {
          this.discardSegment();
        }
        this.isSpeaking = false;
        this.callbacks.onSpeechEnd();
      }
    }
  }

  private startRecording(): void {
    if (this.mediaRecorder?.state === 'inactive') {
      this.chunks = [];
      this.mediaRecorder.start(100);
    }
  }

  private flushSegment(): void {
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
  }

  private discardSegment(): void {
    if (this.mediaRecorder?.state === 'recording') {
      const handler = this.mediaRecorder.ondataavailable;
      this.mediaRecorder.ondataavailable = null;
      this.mediaRecorder.stop();
      this.chunks = [];
      this.mediaRecorder.ondataavailable = handler;
    }
  }

  stop(): void {
    this.active = false;
    this.processor?.disconnect();
    this.processor = null;
    if (this.mediaRecorder?.state === 'recording') {
      try { this.mediaRecorder.stop(); } catch { /* */ }
    }
    this.mediaRecorder = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.audioContext?.close();
    this.audioContext = null;
    this.isSpeaking = false;
    this.chunks = [];
  }

  get isActive(): boolean { return this.active; }
}
