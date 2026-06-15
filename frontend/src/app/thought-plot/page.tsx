'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_BASE } from '@/lib/api';
import {
  Mic,
  MicOff,
  Network,
  Lock,
  GraduationCap,
  BookOpen,
  Brain,
  MessageCircle,
  Square,
  Volume2,
  VolumeX,
  Pause,
  Send,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronDown,
  AlertCircle,
  RefreshCw,
  XCircle,
  AlertTriangle,
  X,
  Clock,
  PanelRight,
} from 'lucide-react';
import { SessionHistory } from '@/components/SessionHistory';
import type { SessionDetail } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { useSpeechRecognition } from '@/lib/useSpeechRecognition';
import { useAudioPlayback } from '@/lib/useAudioPlayback';
import { MermaidExport } from '@/components/MermaidExport';
import { useIsMobile } from '@/lib/useIsMobile';
import type {
  ThoughtPlotMode,
  StudyClass,
  TranscriptEntry,
  WebSocketIncoming,
  FactCheckNotification,
} from '@/lib/types';

interface PlotModeConfig {
  mode: ThoughtPlotMode;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  hint: string;
}

const plotModes: PlotModeConfig[] = [
  {
    mode: 'general',
    label: 'General',
    icon: MessageCircle,
    color: 'mode-general',
    hint: 'Freely discuss any topic. The diagram grows with each idea.',
  },
  {
    mode: 'topic_locked',
    label: 'Topic Locked',
    icon: Lock,
    color: 'mode-topic_locked',
    hint: 'Diagram stays focused on a single topic you define.',
  },
  {
    mode: 'class_mode',
    label: 'Class Mode',
    icon: GraduationCap,
    color: 'mode-class_mode',
    hint: 'Diagram built using your class materials as context.',
  },
  {
    mode: 'study',
    label: 'Study',
    icon: BookOpen,
    color: 'mode-study',
    hint: 'Study concepts and see their relationships visualized.',
  },
  {
    mode: 'quiz',
    label: 'Quiz',
    icon: Brain,
    color: 'mode-quiz',
    hint: 'Test yourself and watch the diagram reveal correct answers.',
  },
];

type AIStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

// How often to send interim text to the backend for fact-check evaluation (ms)
const INTERIM_SEND_INTERVAL = 6000;
// Minimum words in interim text before sending (avoid noise)
const INTERIM_MIN_WORDS = 6;

export default function ThoughtPlotPage() {
  const isMobile = useIsMobile();
  const [selectedMode, setSelectedMode] = useState<ThoughtPlotMode>('general');
  const [topicInput, setTopicInput] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [classes, setClasses] = useState<StudyClass[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIStatus>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interimText, setInterimText] = useState('');
  const [sessionActive, setSessionActive] = useState(false);
  const [textInput, setTextInput] = useState('');

  const [mermaidCode, setMermaidCode] = useState('');
  const [diagramError, setDiagramError] = useState('');
  const [zoom, setZoom] = useState(1);

  // Whether the AI is currently speaking (for interrupt indicator)
  const [aiSpeaking, setAiSpeaking] = useState(false);

  // Fact-check notifications (async background results)
  const [factChecks, setFactChecks] = useState<FactCheckNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showFactPanel, setShowFactPanel] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const mermaidContainerRef = useRef<HTMLDivElement>(null);
  const mermaidInitRef = useRef(false);

  // Stable refs for latest values inside callbacks
  const selectedModeRef = useRef(selectedMode);
  selectedModeRef.current = selectedMode;
  const selectedClassIdRef = useRef(selectedClassId);
  selectedClassIdRef.current = selectedClassId;
  const topicInputRef = useRef(topicInput);
  topicInputRef.current = topicInput;
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const aiSpeakingRef = useRef(false);
  aiSpeakingRef.current = aiStatus === 'speaking';

  // Interim text tracking for periodic fact-check sends
  const interimTextRef = useRef('');
  const lastInterimSentRef = useRef('');
  const interimTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Audio playback hook (Gemini TTS)
  const { playPcmAudio, stopAudio } = useAudioPlayback();
  const ttsRecoveryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInterruptRef = useRef(false);
  const pendingTtsTextRef = useRef('');

  // Voice toggle (persisted)
  const [voiceEnabled, setVoiceEnabled] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('tp-voice-enabled') !== 'false' : true
  );
  const voiceEnabledRef = useRef(voiceEnabled);
  voiceEnabledRef.current = voiceEnabled;

  const handleVoiceToggle = useCallback(() => {
    setVoiceEnabled((prev) => {
      const next = !prev;
      localStorage.setItem('tp-voice-enabled', String(next));
      if (!next) stopAudio();
      return next;
    });
  }, [stopAudio]);

  // Pause/resume recording
  const [isPaused, setIsPaused] = useState(false);

  // Fetch classes
  useEffect(() => {
    async function fetchClasses() {
      try {
        const { data } = await supabase
          .from('classes')
          .select('*')
          .order('name', { ascending: true });
        setClasses(data || []);
      } catch {
        setClasses([]);
      }
    }
    fetchClasses();
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, interimText]);

  // Initialize mermaid with Anthropic theme
  useEffect(() => {
    if (mermaidInitRef.current) return;
    mermaidInitRef.current = true;

    import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: '#0c0b09',
          primaryColor: '#d4a64a',
          primaryTextColor: '#f5f3ed',
          primaryBorderColor: '#332f2a',
          lineColor: '#716d65',
          secondaryColor: '#5a9fd4',
          tertiaryColor: '#161514',
        },
        flowchart: {
          curve: 'basis',
          padding: 15,
        },
      });
    });
  }, []);

  // Render mermaid diagram when code changes
  useEffect(() => {
    if (!mermaidCode || !mermaidContainerRef.current) return;

    setDiagramError('');

    import('mermaid').then(async (m) => {
      try {
        const id = `mermaid-${Date.now()}`;
        const { svg } = await m.default.render(id, mermaidCode);
        if (mermaidContainerRef.current) {
          mermaidContainerRef.current.innerHTML = svg;
        }
      } catch (err) {
        setDiagramError(
          err instanceof Error ? err.message : 'Failed to render diagram'
        );
      }
    });
  }, [mermaidCode]);

  const addTranscriptEntry = useCallback(
    (speaker: 'user' | 'ai', text: string) => {
      const entry: TranscriptEntry = {
        id: crypto.randomUUID(),
        session_id: '',
        speaker,
        text,
        timestamp_ms: Date.now(),
      };
      setTranscript((prev) => [...prev, entry]);
    },
    []
  );

  // Send text to WebSocket (full transcript chunk)
  const sendToWebSocket = useCallback(
    (text: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'transcript',
            text,
            mode: selectedModeRef.current,
            tool: 'thought_plot',
            class_id: selectedClassIdRef.current || undefined,
            topic: topicInputRef.current || undefined,
          })
        );
      }
    },
    []
  );

  // Send interim text for fast router-only fact-check
  const sendInterimToWebSocket = useCallback(
    (text: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'interim',
            text,
            mode: selectedModeRef.current,
            tool: 'thought_plot',
            class_id: selectedClassIdRef.current || undefined,
            topic: topicInputRef.current || undefined,
          })
        );
      }
    },
    []
  );

  // Speech result handler — final text → full 3-agent pipeline
  const handleSpeechResult = useCallback(
    (finalText: string) => {
      // INTERRUPT: stop any playing AI audio when user speaks
      stopAudio();

      addTranscriptEntry('user', finalText);
      setAiStatus('thinking');
      sendToWebSocket(finalText);
      // Reset interim tracking since this chunk was finalized
      lastInterimSentRef.current = '';
    },
    [addTranscriptEntry, sendToWebSocket, stopAudio]
  );

  // Interim text handler — updates state + ref for periodic sending
  const handleInterim = useCallback((text: string) => {
    setInterimText(text);
    interimTextRef.current = text;
  }, []);

  // Reliable speech recognition via shared hook
  const {
    start: startListening,
    stop: stopListening,
    isActive: speechActive,
    error: speechError,
    retryCount,
  } = useSpeechRecognition({
    onResult: handleSpeechResult,
    onInterim: handleInterim,
    aiSpeakingRef,
  });

  const startListeningRef = useRef(startListening);
  startListeningRef.current = startListening;
  const stopListeningRef = useRef(stopListening);
  stopListeningRef.current = stopListening;

  // Periodic interim sending for mid-speech fact-check interruption
  useEffect(() => {
    if (isRecording && sessionActive) {
      interimTimerRef.current = setInterval(() => {
        const text = interimTextRef.current;
        if (
          text &&
          text !== lastInterimSentRef.current &&
          text.split(/\s+/).length >= INTERIM_MIN_WORDS
        ) {
          sendInterimToWebSocket(text);
          lastInterimSentRef.current = text;
        }
      }, INTERIM_SEND_INTERVAL);
    }

    return () => {
      if (interimTimerRef.current) {
        clearInterval(interimTimerRef.current);
        interimTimerRef.current = null;
      }
      lastInterimSentRef.current = '';
    };
  }, [isRecording, sessionActive, sendInterimToWebSocket]);

  // Notification sound for fact-checks (Web Audio API — no file needed)
  const playNotificationSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      // AudioContext not available
    }
  }, []);

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_BASE}/ws/study-session`);

    ws.onopen = () => {
      console.log('Visboard WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data: WebSocketIncoming = JSON.parse(event.data);

        if (data.type === 'ai_response') {
          // Stop any currently playing audio — new response preempts old
          stopAudio();
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }

          addTranscriptEntry('ai', data.text);

          const isInterrupt = !!(data.is_interrupt && isRecordingRef.current);
          pendingInterruptRef.current = isInterrupt;

          if (!isInterrupt) {
            setAiStatus('speaking');
          }

          if (isInterrupt) {
            setAiSpeaking(true);
          }

          if (data.should_speak) {
            pendingTtsTextRef.current = data.text || '';
            const onSpeechEnd = () => {
              if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }
              setAiSpeaking(false);
              if (!isRecordingRef.current) {
                setAiStatus('idle');
              }
            };

            if (data.audio_data && voiceEnabledRef.current) {
              pendingTtsTextRef.current = '';
              if (!isInterrupt) stopListeningRef.current();
              playPcmAudio(
                data.audio_data,
                data.audio_sample_rate || 24000,
                () => {
                  onSpeechEnd();
                  if (!isInterrupt && isRecordingRef.current) startListeningRef.current();
                }
              );
            } else if (voiceEnabledRef.current) {
              if (!isInterrupt) stopListeningRef.current();
              ttsRecoveryRef.current = setTimeout(() => {
                pendingTtsTextRef.current = '';
                onSpeechEnd();
              }, 15000);
            } else {
              setTimeout(onSpeechEnd, 300);
            }
          } else if (!isInterrupt) {
            setTimeout(() => {
              setAiStatus(isRecordingRef.current ? 'listening' : 'idle');
            }, 500);
          }
        } else if (data.type === 'ai_audio') {
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }
          pendingTtsTextRef.current = '';
          if (!voiceEnabledRef.current) return;
          const wasInterrupt = pendingInterruptRef.current;
          pendingInterruptRef.current = false;
          setAiSpeaking(true);
          if (!wasInterrupt) stopListeningRef.current();
          playPcmAudio(
            data.audio_data,
            data.audio_sample_rate || 24000,
            () => {
              setAiSpeaking(false);
              if (!wasInterrupt && isRecordingRef.current) startListeningRef.current();
              if (!isRecordingRef.current) setAiStatus('idle');
            }
          );
        } else if (data.type === 'tts_failed') {
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }
          pendingInterruptRef.current = false;
          pendingTtsTextRef.current = '';
          setAiSpeaking(false);
          if (isRecordingRef.current) startListeningRef.current();
          if (!isRecordingRef.current) setAiStatus('idle');
        } else if (data.type === 'plot_update') {
          if (data.graph?.mermaid_code) {
            setMermaidCode(data.graph.mermaid_code);
          }
        } else if (data.type === 'fact_check') {
          const notification: FactCheckNotification = {
            ...data,
            timestamp: Date.now(),
            read: false,
          };
          setFactChecks((prev) => [notification, ...prev]);
          setUnreadCount((prev) => prev + 1);

          if (data.status === 'incorrect') {
            playNotificationSound();
          }
        }
      } catch {
        // Invalid message
      }
    };

    ws.onclose = () => {
      console.log('Visboard WebSocket disconnected');
    };

    ws.onerror = () => {
      console.log('Visboard WebSocket error');
    };

    wsRef.current = ws;
  }, [addTranscriptEntry, playPcmAudio, playNotificationSound]);

  function handleStartSession() {
    setSessionActive(true);
    setTranscript([]);
    setMermaidCode('');
    setDiagramError('');
    setFactChecks([]);
    setUnreadCount(0);
    setShowFactPanel(false);
    connectWebSocket();
  }

  function handleToggleMic() {
    if (isRecording) {
      setIsRecording(false);
      setIsPaused(false);
      setAiStatus('idle');
      setInterimText('');
      interimTextRef.current = '';
      stopListening();
    } else {
      if (!sessionActive) {
        handleStartSession();
      }
      setIsRecording(true);
      setIsPaused(false);
      setAiStatus('listening');
      startListening();
    }
  }

  function handlePauseResume() {
    if (isPaused) {
      setIsPaused(false);
      setAiStatus('listening');
      startListening();
    } else {
      setIsPaused(true);
      setAiStatus('idle');
      setInterimText('');
      interimTextRef.current = '';
      stopListening();
    }
  }

  function handleEndSession() {
    setSessionActive(false);
    setIsRecording(false);
    setIsPaused(false);
    setAiStatus('idle');
    setAiSpeaking(false);
    setInterimText('');
    interimTextRef.current = '';
    stopListening();
    stopAudio();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim()) return;

    if (!sessionActive) {
      handleStartSession();
    }

    addTranscriptEntry('user', textInput.trim());
    setAiStatus('thinking');
    sendToWebSocket(textInput.trim());
    setTextInput('');
  }

  // Auto-dismiss toast notification after 8 seconds
  useEffect(() => {
    if (factChecks.length > 0 && !factChecks[0].read) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        setFactChecks((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          updated[0] = { ...updated[0], read: true };
          return updated;
        });
      }, 8000);
    }
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [factChecks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
      stopAudio();
      if (wsRef.current) wsRef.current.close();
    };
  }, [stopListening, stopAudio]);

  const currentModeConfig = plotModes.find((m) => m.mode === selectedMode)!;

  // ── Transcript panel content ──
  const transcriptContent = (
    <>
      <div className="flex items-center justify-between px-3 py-2.5"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Transcript
        </span>
        <div className="flex items-center gap-2">
          {transcript.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {transcript.length}
            </span>
          )}
          {isMobile && (
            <button onClick={() => setShowTranscript(false)} className="p-1 cursor-pointer" style={{ color: 'var(--text-faint)' }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {transcript.length === 0 && !interimText ? (
          <div className="text-center py-12">
            <Volume2 size={28} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Speak or type to start.
            </p>
          </div>
        ) : (
          <>
            {transcript.map((entry) => (
              <div
                key={entry.id}
                className={`transcript-msg ${entry.speaker}`}
              >
                <span className="text-xs font-medium opacity-60 block mb-0.5">
                  {entry.speaker === 'user' ? 'You' : 'AI'}
                </span>
                {entry.text}
              </div>
            ))}
            {interimText && (
              <div className="transcript-msg user opacity-50">
                <span className="text-xs font-medium opacity-60 block mb-0.5">
                  You
                </span>
                {interimText}...
              </div>
            )}
            <div ref={transcriptEndRef} />
          </>
        )}
      </div>
    </>
  );

  // ── Fact-check panel content ──
  const factCheckContent = (
    <>
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Fact Checks
        </span>
        <button onClick={() => setShowFactPanel(false)} className="p-1 rounded transition-colors cursor-pointer"
          style={{ color: 'var(--text-faint)' }}><X size={14} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {factChecks.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>
            No fact checks yet.
          </p>
        ) : (
          factChecks.map((fc) => (
            <div key={fc.id} className="p-3 rounded-lg" style={{
              background: fc.status === 'incorrect' ? 'var(--red-muted)' : 'var(--amber-muted)',
              border: `1px solid ${fc.status === 'incorrect' ? 'rgba(204, 80, 64, 0.2)' : 'rgba(212, 166, 74, 0.2)'}`,
            }}>
              <div className="flex items-start gap-2">
                {fc.status === 'incorrect' ? (
                  <XCircle size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--red)' }} />
                ) : (
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--amber)' }} />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium" style={{
                    color: fc.status === 'incorrect' ? 'var(--red)' : 'var(--amber)',
                  }}>
                    {fc.status === 'incorrect' ? 'Incorrect' : 'Unverified'}
                    <span className="ml-2 opacity-60">{Math.round(fc.confidence * 100)}%</span>
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    &ldquo;{fc.claim}&rdquo;
                  </p>
                  {fc.correction && (
                    <p className="text-xs mt-1.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {fc.correction}
                    </p>
                  )}
                  {fc.explanation && (
                    <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>
                      {fc.explanation}
                    </p>
                  )}
                  {fc.source_excerpt && (
                    <p className="text-xs mt-1.5 p-2 rounded" style={{
                      background: 'rgba(0,0,0,0.2)',
                      color: 'var(--text-faint)',
                      borderLeft: '2px solid var(--accent)',
                    }}>
                      {fc.source_excerpt}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );

  return (
    <div className="flex flex-col h-screen">
      {/* Mode Selector Bar */}
      <div
        className={isMobile ? 'px-2 py-1.5' : 'px-4 py-2'}
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--surface)',
        }}
      >
        <div className={isMobile ? 'flex flex-col gap-1.5' : 'flex items-center gap-1.5 flex-wrap'}>
          <div className={isMobile ? 'flex gap-1.5 overflow-x-auto no-scrollbar' : 'flex items-center gap-1.5 flex-wrap'}>
            {plotModes.map(({ mode, label, icon: Icon, color }) => (
              <button
                key={mode}
                onClick={() => setSelectedMode(mode)}
                className={`mode-btn flex-shrink-0 ${selectedMode === mode ? `active ${color}` : ''}`}
                style={isMobile ? { minHeight: '36px', fontSize: '12px' } : undefined}
              >
                <Icon size={isMobile ? 14 : 16} />
                {label}
              </button>
            ))}
          </div>

          {/* Conditional inputs + mobile actions */}
          <div className={isMobile ? 'flex items-center gap-2' : 'flex items-center gap-2'}>
            {/* Topic locked input */}
            {selectedMode === 'topic_locked' && (
              <div className="flex items-center gap-1.5 flex-1">
                <Lock size={14} style={{ color: '#a86e7e' }} />
                <input
                  type="text"
                  className={`form-input text-sm ${isMobile ? 'flex-1' : 'w-48'}`}
                  placeholder="Enter topic..."
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  style={isMobile ? { minHeight: '36px' } : undefined}
                />
              </div>
            )}

            {/* Class mode selector */}
            {selectedMode === 'class_mode' && (
              <div className="flex items-center gap-1.5 relative flex-1">
                <GraduationCap size={14} style={{ color: '#5b9b9b' }} />
                <select
                  className={`form-select text-sm ${isMobile ? 'flex-1' : 'w-48'}`}
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  style={isMobile ? { minHeight: '36px' } : undefined}
                >
                  <option value="">Select class...</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Mobile transcript toggle */}
            {isMobile && (
              <button
                onClick={() => setShowTranscript(!showTranscript)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs cursor-pointer flex-shrink-0"
                style={{
                  background: showTranscript ? 'rgba(212, 166, 74, 0.15)' : 'transparent',
                  border: `1px solid ${showTranscript ? 'rgba(212, 166, 74, 0.3)' : 'var(--border-subtle)'}`,
                  color: showTranscript ? 'var(--amber)' : 'var(--text-muted)',
                  minHeight: '36px',
                }}
              >
                <PanelRight size={12} />
                {transcript.length > 0 && <span>{transcript.length}</span>}
              </button>
            )}

            {/* History */}
            {isMobile && (
              <button
                onClick={() => setShowHistory(true)}
                className="p-2 rounded-lg cursor-pointer flex-shrink-0"
                style={{
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)',
                  minWidth: '36px',
                  minHeight: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Clock size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Center: Diagram area */}
        <div className="flex-1 flex flex-col" style={{ background: 'var(--bg)' }}>
          {/* Speech error banner */}
          {speechError && (
            <div
              className={`${isMobile ? 'mx-2 mt-2' : 'mx-4 mt-3'} flex items-center gap-2 p-3 rounded-lg text-sm`}
              style={{
                background: 'var(--red-muted)',
                border: '1px solid rgba(204, 80, 64, 0.2)',
                color: 'var(--red)',
              }}
            >
              <AlertCircle size={16} />
              {speechError}
            </div>
          )}

          {/* Reconnection banner */}
          {retryCount > 0 && !speechError && (
            <div
              className={`${isMobile ? 'mx-2 mt-2' : 'mx-4 mt-3'} flex items-center gap-2 p-3 rounded-lg text-sm`}
              style={{
                background: 'var(--amber-muted)',
                border: '1px solid rgba(212, 166, 74, 0.2)',
                color: 'var(--amber)',
              }}
            >
              <RefreshCw size={14} className="animate-spin" />
              Reconnecting... (attempt {retryCount}/5)
            </div>
          )}

          {/* Diagram */}
          <div className="flex-1 relative overflow-hidden">
            {mermaidCode ? (
              <>
                {/* Zoom controls */}
                <div className={`absolute ${isMobile ? 'top-2 right-2' : 'top-4 right-4'} z-10 flex items-center gap-1`}>
                  <button
                    onClick={() => setZoom((z) => Math.min(z + 0.2, 3))}
                    className="p-2 rounded-lg transition-colors"
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      minWidth: '36px',
                      minHeight: '36px',
                    }}
                    title="Zoom in"
                  >
                    <ZoomIn size={16} />
                  </button>
                  <button
                    onClick={() => setZoom((z) => Math.max(z - 0.2, 0.3))}
                    className="p-2 rounded-lg transition-colors"
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      minWidth: '36px',
                      minHeight: '36px',
                    }}
                    title="Zoom out"
                  >
                    <ZoomOut size={16} />
                  </button>
                  <button
                    onClick={() => setZoom(1)}
                    className="p-2 rounded-lg transition-colors"
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      minWidth: '36px',
                      minHeight: '36px',
                    }}
                    title="Reset zoom"
                  >
                    <RotateCcw size={16} />
                  </button>
                  <MermaidExport mermaidCode={mermaidCode} containerRef={mermaidContainerRef} />
                </div>

                {/* Fact-check badge */}
                {factChecks.length > 0 && (
                  <button
                    onClick={() => {
                      setShowFactPanel(!showFactPanel);
                      setUnreadCount(0);
                      setFactChecks((prev) => prev.map((fc) => ({ ...fc, read: true })));
                    }}
                    className={`absolute ${isMobile ? 'top-2 left-2' : 'top-4 left-4'} z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer`}
                    style={{
                      background: unreadCount > 0 ? 'var(--red-muted)' : 'var(--surface)',
                      border: `1px solid ${unreadCount > 0 ? 'rgba(204, 80, 64, 0.3)' : 'var(--border-subtle)'}`,
                      color: unreadCount > 0 ? 'var(--red)' : 'var(--text-muted)',
                      minHeight: '36px',
                    }}
                  >
                    <AlertTriangle size={14} />
                    {!isMobile && <>{factChecks.length} fact check{factChecks.length !== 1 ? 's' : ''}</>}
                    {unreadCount > 0 && (
                      <span
                        className="ml-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ background: 'var(--red)', color: 'var(--cream)' }}
                      >
                        {unreadCount}
                      </span>
                    )}
                  </button>
                )}

                {/* Fact-check toast notification */}
                {factChecks.length > 0 && !factChecks[0].read && (
                  <div
                    className={`absolute bottom-20 ${isMobile ? 'left-2 right-2' : 'left-4 max-w-sm'} z-20 animate-slide-up cursor-pointer`}
                    style={{
                      background: factChecks[0].status === 'incorrect'
                        ? 'var(--red-muted)'
                        : 'var(--amber-muted)',
                      border: `1px solid ${
                        factChecks[0].status === 'incorrect'
                          ? 'rgba(204, 80, 64, 0.3)'
                          : 'rgba(212, 166, 74, 0.3)'
                      }`,
                      borderRadius: '10px',
                      padding: '0.75rem 1rem',
                    }}
                    onClick={() => {
                      setShowFactPanel(true);
                      setUnreadCount(0);
                      setFactChecks((prev) => prev.map((fc) => ({ ...fc, read: true })));
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {factChecks[0].status === 'incorrect' ? (
                        <XCircle size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--red)' }} />
                      ) : (
                        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--amber)' }} />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-medium" style={{
                          color: factChecks[0].status === 'incorrect' ? 'var(--red)' : 'var(--amber)',
                        }}>
                          {factChecks[0].status === 'incorrect' ? 'Correction' : 'Unverified Claim'}
                        </p>
                        <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                          {factChecks[0].correction || factChecks[0].claim}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* AI speaking indicator (shows during interrupt while recording) */}
                {aiSpeaking && isRecording && !isMobile && (
                  <div
                    className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
                    style={{
                      background: 'var(--blue-muted)',
                      border: '1px solid rgba(106, 155, 204, 0.25)',
                      color: 'var(--blue)',
                    }}
                  >
                    <span className="status-dot speaking" />
                    AI speaking...
                  </div>
                )}

                <div className="w-full h-full overflow-auto p-3">
                  <div
                    style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                    className="transition-transform duration-200"
                  >
                    <div ref={mermaidContainerRef} className="mermaid-render" />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div
                  className="w-16 h-16 rounded-xl flex items-center justify-center mb-4"
                  style={{
                    background: 'var(--accent-muted)',
                    border: '1px solid rgba(212, 166, 74, 0.15)',
                  }}
                >
                  <Network size={36} style={{ color: 'var(--accent)' }} />
                </div>
                <h2 className="heading-section text-lg mb-1.5">
                  Your Thought Plot
                </h2>
                <p className={`${isMobile ? 'max-w-[90%]' : 'max-w-md'} mb-4 text-sm`} style={{ color: 'var(--text-secondary)' }}>
                  {currentModeConfig.hint}
                </p>

                {/* Status & mic */}
                <div className="flex items-center gap-2 mb-4">
                  <span className={`status-dot ${aiStatus}`} />
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {aiStatus === 'idle'
                      ? 'Ready'
                      : aiStatus === 'listening'
                      ? 'Listening...'
                      : aiStatus === 'thinking'
                      ? 'Thinking...'
                      : 'Speaking...'}
                  </span>
                  {aiSpeaking && isRecording && (
                    <span className="text-xs ml-2" style={{ color: 'var(--blue)' }}>
                      (AI speaking)
                    </span>
                  )}
                </div>

                <button
                  onClick={handleToggleMic}
                  className={`mic-btn ${isRecording ? 'recording' : ''}`}
                  style={isMobile ? { width: '80px', height: '80px' } : undefined}
                >
                  {isRecording ? <MicOff size={isMobile ? 32 : 28} /> : <Mic size={isMobile ? 32 : 28} />}
                  {isRecording && <span className="mic-ring" />}
                </button>

                <p className="text-xs mt-3" style={{ color: 'var(--text-faint)' }}>
                  {isRecording ? 'Tap to stop' : 'Tap to start speaking'}
                </p>
              </div>
            )}

            {/* Diagram error */}
            {diagramError && (
              <div
                className={`absolute bottom-4 ${isMobile ? 'left-2 right-2' : 'left-4 right-4'} p-3 rounded-lg text-sm`}
                style={{
                  background: 'var(--red-muted)',
                  border: '1px solid rgba(204, 80, 64, 0.2)',
                  color: 'var(--red)',
                }}
              >
                Diagram error: {diagramError}
              </div>
            )}

            {/* Session history overlay */}
            {showHistory && !isMobile && (
              <div className="absolute inset-0 z-30" style={{ background: 'var(--surface)' }}>
                <SessionHistory
                  tool="thought_plot"
                  onSelectSession={(detail: SessionDetail) => {
                    setShowHistory(false);
                  }}
                  onClose={() => setShowHistory(false)}
                />
              </div>
            )}
          </div>

          {/* Bottom: Text input + controls */}
          <div
            className={isMobile ? 'px-2 py-2' : 'px-6 py-3'}
            style={{
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--surface)',
            }}
          >
            <div className="flex items-center gap-2">
              {/* Mic toggle (small) when diagram is showing */}
              {mermaidCode && (
                <button
                  onClick={handleToggleMic}
                  className="rounded-lg transition-colors relative flex items-center justify-center"
                  style={{
                    background: isRecording ? 'var(--red-muted)' : 'transparent',
                    border: `1px solid ${isRecording ? 'rgba(204, 80, 64, 0.3)' : 'var(--border-subtle)'}`,
                    color: isRecording ? 'var(--red)' : 'var(--text-muted)',
                    minWidth: '44px',
                    minHeight: '44px',
                  }}
                  title={isRecording ? 'Stop recording' : 'Start recording'}
                >
                  {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              )}

              {/* Text input */}
              <form onSubmit={handleTextSubmit} className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  className="form-input text-sm"
                  placeholder={isMobile ? 'Type here...' : 'Type to add to the diagram...'}
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  style={isMobile ? { minHeight: '44px' } : undefined}
                />
                <button
                  type="submit"
                  disabled={!textInput.trim()}
                  className="btn-primary flex items-center justify-center"
                  style={{ minWidth: '44px', minHeight: '44px' }}
                >
                  <Send size={16} />
                </button>
              </form>

              {/* Status indicators */}
              {mermaidCode && !isMobile && (
                <div className="flex items-center gap-2">
                  <span className={`status-dot ${isRecording ? 'listening' : aiStatus}`} />
                  {aiSpeaking && isRecording && (
                    <span className="status-dot speaking" />
                  )}
                </div>
              )}

              {/* History (desktop) */}
              {!isMobile && (
                <button
                  onClick={() => setShowHistory(true)}
                  className="p-2 rounded-lg transition-colors cursor-pointer flex items-center justify-center"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    minWidth: '44px',
                    minHeight: '44px',
                  }}
                  title="Session history"
                >
                  <Clock size={14} />
                </button>
              )}

              {/* Pause / Voice toggle / End */}
              {sessionActive && (
                <div className="flex items-center gap-1.5">
                  {isRecording && !isMobile && (
                    <button
                      onClick={handlePauseResume}
                      className="p-2 rounded-lg transition-colors cursor-pointer flex items-center justify-center"
                      style={{
                        background: isPaused ? 'rgba(212, 166, 74, 0.15)' : 'var(--surface)',
                        border: `1px solid ${isPaused ? 'rgba(212, 166, 74, 0.3)' : 'var(--border-subtle)'}`,
                        color: isPaused ? 'var(--amber)' : 'var(--text-muted)',
                        minWidth: '44px',
                        minHeight: '44px',
                      }}
                      title={isPaused ? 'Resume' : 'Pause'}
                    >
                      {isPaused ? <Mic size={14} /> : <Pause size={14} />}
                    </button>
                  )}
                  <button
                    onClick={handleVoiceToggle}
                    className="p-2 rounded-lg transition-colors cursor-pointer flex items-center justify-center"
                    style={{
                      background: voiceEnabled ? 'transparent' : 'rgba(204, 80, 64, 0.15)',
                      border: `1px solid ${voiceEnabled ? 'var(--border-subtle)' : 'rgba(204, 80, 64, 0.3)'}`,
                      color: voiceEnabled ? 'var(--text-muted)' : 'var(--red)',
                      minWidth: '44px',
                      minHeight: '44px',
                    }}
                    title={voiceEnabled ? 'Mute AI voice' : 'Unmute AI voice'}
                  >
                    {voiceEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  </button>
                  <button onClick={handleEndSession} className="btn-danger text-sm" style={{ minHeight: '44px' }}>
                    <Square size={14} />
                    {!isMobile && 'End'}
                  </button>
                </div>
              )}
            </div>

            {/* Interim text */}
            {interimText && (
              <p className={`text-xs italic mt-2 ${isMobile ? '' : 'ml-12'}`} style={{ color: 'var(--text-faint)' }}>
                {interimText}...
              </p>
            )}
          </div>
        </div>

        {/* Fact-check detail panel — desktop only */}
        {showFactPanel && !isMobile && (
          <div
            className="w-80 flex-shrink-0 flex flex-col animate-slide-up"
            style={{
              background: 'var(--surface)',
              borderLeft: '1px solid var(--border-subtle)',
            }}
          >
            {factCheckContent}
          </div>
        )}

        {/* Right: Transcript panel — desktop only */}
        {!isMobile && (
          <div className="w-72 flex-shrink-0 flex flex-col"
            style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border-subtle)' }}>
            {transcriptContent}
          </div>
        )}
      </div>

      {/* Mobile: Transcript overlay */}
      {isMobile && showTranscript && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setShowTranscript(false)} />
          <div
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col animate-slide-up"
            style={{ background: 'var(--surface)', height: '60vh', borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}
          >
            {transcriptContent}
          </div>
        </>
      )}

      {/* Mobile: Fact-check panel overlay */}
      {isMobile && showFactPanel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setShowFactPanel(false)} />
          <div
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col animate-slide-up"
            style={{ background: 'var(--surface)', height: '60vh', borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}
          >
            {factCheckContent}
          </div>
        </>
      )}

      {/* Mobile: Session history overlay */}
      {isMobile && showHistory && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setShowHistory(false)} />
          <div
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col animate-slide-up"
            style={{ background: 'var(--surface)', height: '80vh', borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}
          >
            <SessionHistory
              tool="thought_plot"
              onSelectSession={(detail: SessionDetail) => {
                setShowHistory(false);
              }}
              onClose={() => setShowHistory(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}
