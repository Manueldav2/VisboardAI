'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

interface QueuedAudio {
  base64Data: string;
  sampleRate: number;
  onEnded?: () => void;
}

interface UseAudioPlaybackReturn {
  playPcmAudio: (base64Data: string, sampleRate?: number, onEnded?: () => void) => void;
  stopAudio: () => void;
  speakBrowserTTS: (text: string, onEnded?: () => void) => void;
  isPlaying: boolean;
}

/**
 * Robust PCM audio playback hook with sequential queue.
 *
 * - Pre-warms AudioContext on first user gesture to avoid browser blocks
 * - Auto-resumes suspended AudioContext before every play
 * - Queues audio so rapid messages play one after another, not on top of each other
 * - Validates data before attempting decode
 * - stopAudio() clears the queue so nothing else plays
 */
export function useAudioPlayback(): UseAudioPlaybackReturn {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const queueRef = useRef<QueuedAudio[]>([]);
  const isProcessingRef = useRef(false);

  // Pre-warm AudioContext on first user interaction (click/touch/keydown)
  useEffect(() => {
    const warmUp = () => {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        try {
          audioContextRef.current = new AudioContext();
          gainRef.current = audioContextRef.current.createGain();
          gainRef.current.gain.value = 1.0;
          gainRef.current.connect(audioContextRef.current.destination);
        } catch {
          // Will try again on next play
        }
      }
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
      document.removeEventListener('click', warmUp);
      document.removeEventListener('touchstart', warmUp);
      document.removeEventListener('touchend', warmUp);
      document.removeEventListener('keydown', warmUp);
    };

    document.addEventListener('click', warmUp, { once: true });
    document.addEventListener('touchend', warmUp, { once: true });
    document.addEventListener('touchstart', warmUp, { once: true, passive: true } as AddEventListenerOptions);
    document.addEventListener('keydown', warmUp, { once: true });

    return () => {
      document.removeEventListener('click', warmUp);
      document.removeEventListener('touchstart', warmUp);
      document.removeEventListener('touchend', warmUp);
      document.removeEventListener('keydown', warmUp);
    };
  }, []);

  const ensureAudioContext = useCallback(async () => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContext();
      gainRef.current = audioContextRef.current.createGain();
      gainRef.current.gain.value = 1.0;
      gainRef.current.connect(audioContextRef.current.destination);
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const _playNext = useCallback(async () => {
    if (isProcessingRef.current) return;

    const item = queueRef.current.shift();
    if (!item) {
      setIsPlaying(false);
      return;
    }

    isProcessingRef.current = true;
    setIsPlaying(true);

    try {
      const ctx = await ensureAudioContext();

      const binaryString = atob(item.base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const int16 = new Int16Array(bytes.buffer);
      if (int16.length === 0) {
        isProcessingRef.current = false;
        item.onEnded?.();
        _playNext();
        return;
      }

      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, item.sampleRate);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      if (gainRef.current && gainRef.current.context === ctx) {
        source.connect(gainRef.current);
      } else {
        source.connect(ctx.destination);
      }

      source.onended = () => {
        sourceRef.current = null;
        isProcessingRef.current = false;
        item.onEnded?.();
        // Play next item in queue
        _playNext();
      };

      source.start();
      sourceRef.current = source;
    } catch (err) {
      console.error('Audio playback failed:', err);
      sourceRef.current = null;
      isProcessingRef.current = false;
      item.onEnded?.();
      _playNext();
    }
  }, [ensureAudioContext]);

  const stopAudio = useCallback(() => {
    // Clear the queue so nothing else plays
    queueRef.current = [];
    isProcessingRef.current = false;

    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // Already stopped
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    // Also cancel any browser TTS
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
  }, []);

  const playPcmAudio = useCallback(
    (base64Data: string, sampleRate = 24000, onEnded?: () => void) => {
      if (!base64Data || base64Data.length < 100) {
        console.warn('Audio data too short or empty, skipping playback');
        onEnded?.();
        return;
      }

      // Add to queue
      queueRef.current.push({ base64Data, sampleRate, onEnded });

      // Start processing if not already playing
      if (!isProcessingRef.current) {
        _playNext();
      }
    },
    [_playNext]
  );

  const speakBrowserTTS = useCallback(
    (text: string, onEnded?: () => void) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        onEnded?.();
        return;
      }
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.onend = () => {
        setIsPlaying(false);
        onEnded?.();
      };
      utterance.onerror = () => {
        setIsPlaying(false);
        onEnded?.();
      };
      setIsPlaying(true);
      window.speechSynthesis.speak(utterance);
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      queueRef.current = [];
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch { /* noop */ }
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return { playPcmAudio, stopAudio, speakBrowserTTS, isPlaying };
}
