'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

const MAX_RETRIES = 8;
const BASE_DELAY_MS = 200;
const MAX_DELAY_MS = 8_000;
// If recognition is active but produces zero results for this long, force-restart
const WATCHDOG_MS = 12_000;

interface UseSpeechRecognitionOptions {
  lang?: string;
  onResult: (finalText: string) => void;
  onInterim?: (interimText: string) => void;
  /** When true, skip debounce and flush immediately (user is interrupting AI). */
  aiSpeakingRef?: React.RefObject<boolean>;
}

interface UseSpeechRecognitionReturn {
  start: () => void;
  stop: () => void;
  isActive: boolean;
  error: string | null;
  retryCount: number;
}

function classifyError(errorCode: string): string {
  switch (errorCode) {
    case 'not-allowed':
      return 'Microphone permission denied. Please allow mic access.';
    case 'audio-capture':
      return 'No microphone found. Please connect a microphone.';
    case 'network':
      return 'Network error. Check your connection.';
    case 'service-not-available':
      return 'Speech service unavailable. Try restarting.';
    default:
      return `Speech recognition error: ${errorCode}`;
  }
}

export function useSpeechRecognition({
  lang = 'en-US',
  onResult,
  onInterim,
  aiSpeakingRef,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionReturn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const activeRef = useRef(false);
  const retryCountRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Keep callbacks stable via refs
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onInterimRef = useRef(onInterim);
  onInterimRef.current = onInterim;

  // Debounce: accumulate final results and flush after silence
  const SILENCE_DEBOUNCE_MS = 2500;
  const pendingTextRef = useRef('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const flushPendingText = useCallback(() => {
    clearDebounceTimer();
    const text = pendingTextRef.current.trim();
    if (text) {
      pendingTextRef.current = '';
      if (onInterimRef.current) onInterimRef.current('');
      onResultRef.current(text);
    }
  }, [clearDebounceTimer]);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const resetWatchdog = useCallback(() => {
    clearWatchdog();
    lastActivityRef.current = Date.now();
    if (!activeRef.current) return;

    watchdogRef.current = setTimeout(() => {
      if (!activeRef.current || !recognitionRef.current) return;
      // Recognition silently died — force restart
      console.warn('Speech recognition watchdog triggered — force restarting');
      try {
        recognitionRef.current.abort();
      } catch { /* noop */ }
      // onend handler will restart it
    }, WATCHDOG_MS);
  }, [clearWatchdog]);

  const restartRecognition = useCallback((delayMs: number) => {
    clearRestartTimer();
    restartTimerRef.current = setTimeout(() => {
      if (activeRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start();
          resetWatchdog();
        } catch {
          // Already started — will fire onend again
        }
      }
    }, delayMs);
  }, [clearRestartTimer, resetWatchdog]);

  const createRecognition = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition not supported. Use Chrome or Edge.');
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = lang;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      // Any result = recognition is alive — reset watchdog + retry counter
      retryCountRef.current = 0;
      setRetryCount(0);
      setError(null);
      resetWatchdog();

      let interim = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (finalTranscript.trim()) {
        pendingTextRef.current += ' ' + finalTranscript.trim();
        clearDebounceTimer();

        if (aiSpeakingRef?.current) {
          flushPendingText();
        } else {
          if (onInterimRef.current) {
            onInterimRef.current(pendingTextRef.current.trim());
          }
          debounceTimerRef.current = setTimeout(() => {
            flushPendingText();
          }, SILENCE_DEBOUNCE_MS);
        }
      } else if (interim && onInterimRef.current) {
        const preview = pendingTextRef.current
          ? pendingTextRef.current.trim() + ' ' + interim
          : interim;
        onInterimRef.current(preview);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      const code = event.error as string;

      if (code === 'no-speech' || code === 'aborted') {
        return; // onend will handle restart
      }

      if (code === 'not-allowed' || code === 'audio-capture') {
        setError(classifyError(code));
        activeRef.current = false;
        setIsActive(false);
        clearWatchdog();
        recognitionRef.current = null;
        return;
      }

      retryCountRef.current += 1;
      setRetryCount(retryCountRef.current);

      if (retryCountRef.current >= MAX_RETRIES) {
        setError(classifyError(code));
        activeRef.current = false;
        setIsActive(false);
        clearWatchdog();
        recognitionRef.current = null;
      }
    };

    recognition.onend = () => {
      if (!activeRef.current) return;

      if (retryCountRef.current >= MAX_RETRIES) {
        activeRef.current = false;
        setIsActive(false);
        clearWatchdog();
        return;
      }

      // Fast restart for normal stops — keeps recognition seamless
      if (retryCountRef.current === 0) {
        restartRecognition(50);
      } else {
        const delay = Math.min(
          BASE_DELAY_MS * Math.pow(2, retryCountRef.current - 1),
          MAX_DELAY_MS
        );
        restartRecognition(delay);
      }
    };

    // Also listen for audiostart/audioend to track activity even without results
    recognition.onaudiostart = () => {
      resetWatchdog();
    };

    return recognition;
  }, [lang, restartRecognition, resetWatchdog, clearWatchdog]);

  const start = useCallback(() => {
    if (activeRef.current) return;

    clearRestartTimer();
    clearWatchdog();
    setError(null);
    retryCountRef.current = 0;
    setRetryCount(0);

    // On mobile, request mic permission explicitly via getUserMedia first.
    // This ensures the permission prompt appears and the mic stream is ready
    // before SpeechRecognition tries to access it.
    const initRecognition = () => {
      const recognition = createRecognition();
      if (!recognition) return;

      recognitionRef.current = recognition;
      activeRef.current = true;
      setIsActive(true);

      try {
        recognition.start();
        resetWatchdog();
      } catch {
        setError('Failed to start speech recognition.');
        activeRef.current = false;
        setIsActive(false);
      }
    };

    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          // Stop the stream immediately — we only needed it for permission
          stream.getTracks().forEach((t) => t.stop());
          initRecognition();
        })
        .catch(() => {
          // getUserMedia failed, try SpeechRecognition directly anyway
          initRecognition();
        });
    } else {
      initRecognition();
    }
  }, [createRecognition, clearRestartTimer, clearWatchdog, resetWatchdog]);

  const stop = useCallback(() => {
    activeRef.current = false;
    setIsActive(false);
    clearRestartTimer();
    clearWatchdog();
    flushPendingText();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Already stopped
      }
      recognitionRef.current = null;
    }
  }, [clearRestartTimer, clearWatchdog, flushPendingText]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      clearRestartTimer();
      clearWatchdog();
      clearDebounceTimer();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // noop
        }
      }
    };
  }, [clearRestartTimer, clearWatchdog, clearDebounceTimer]);

  return { start, stop, isActive, error, retryCount };
}
