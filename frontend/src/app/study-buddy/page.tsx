'use client';

import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { WS_BASE } from '@/lib/api';
import {
  Mic,
  MicOff,
  Brain,
  BookOpen,
  Zap,
  Globe,
  Target,
  MessageCircle,
  Square,
  Volume2,
  VolumeX,
  Pause,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RefreshCw,
  AlertTriangle,
  XCircle,
  X,
  Clock,
  Network,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  PanelRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSpeechRecognition } from '@/lib/useSpeechRecognition';
import { useAudioPlayback } from '@/lib/useAudioPlayback';
import { MermaidExport } from '@/components/MermaidExport';
import { SessionHistory } from '@/components/SessionHistory';
import { useIsMobile } from '@/lib/useIsMobile';
import type {
  StudyMode,
  StudyClass,
  TranscriptEntry,
  WebSocketIncoming,
  FactCheckNotification,
  SessionDetail,
} from '@/lib/types';

interface ModeConfig {
  mode: StudyMode;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  hint: string;
}

const modes: ModeConfig[] = [
  {
    mode: 'quiz',
    label: 'Quiz',
    icon: Brain,
    color: 'mode-quiz',
    hint: 'AI will ask you questions and evaluate your answers.',
  },
  {
    mode: 'guided_study',
    label: 'Guided Study',
    icon: BookOpen,
    color: 'mode-guided_study',
    hint: 'AI will walk you through concepts step by step.',
  },
  {
    mode: 'cram',
    label: 'Cram',
    icon: Zap,
    color: 'mode-cram',
    hint: 'Fast-paced review of key concepts before your exam.',
  },
  {
    mode: 'language',
    label: 'Language',
    icon: Globe,
    color: 'mode-language',
    hint: 'Practice speaking and comprehension in your target language.',
  },
  {
    mode: 'strategy',
    label: 'Strategy',
    icon: Target,
    color: 'mode-strategy',
    hint: 'Get exam strategies, study tips, and time management advice.',
  },
  {
    mode: 'general',
    label: 'General',
    icon: MessageCircle,
    color: 'mode-general',
    hint: 'Open-ended conversation about any topic.',
  },
];

type AIStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

export default function StudyBuddyPage() {
  return (
    <Suspense fallback={<StudyBuddyLoading />}>
      <StudyBuddyInner />
    </Suspense>
  );
}

function StudyBuddyLoading() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div style={{ color: 'var(--text-muted)' }}>Loading Study Buddy...</div>
    </div>
  );
}

function StudyBuddyInner() {
  const searchParams = useSearchParams();
  const initialMode = (searchParams.get('mode') as StudyMode) || 'general';
  const initialClassId = searchParams.get('class_id') || '';
  const isMobile = useIsMobile();

  const [selectedMode, setSelectedMode] = useState<StudyMode>(initialMode);
  const [selectedClassId, setSelectedClassId] = useState(initialClassId);
  const [topic, setTopic] = useState('');
  const [classes, setClasses] = useState<StudyClass[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIStatus>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interimText, setInterimText] = useState('');
  const [sessionActive, setSessionActive] = useState(false);

  // Session history sidebar
  const [showHistory, setShowHistory] = useState(false);

  // Fact-check notifications (async background results)
  const [factChecks, setFactChecks] = useState<FactCheckNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showFactPanel, setShowFactPanel] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Concept Map (mermaid diagram from plotter agent)
  const [mermaidCode, setMermaidCode] = useState('');
  const [rightPanel, setRightPanel] = useState<'transcript' | 'map'>('transcript');
  const [zoom, setZoom] = useState(1);
  const [diagramFullscreen, setDiagramFullscreen] = useState(false);
  const mermaidContainerRef = useRef<HTMLDivElement>(null);
  const mermaidFullscreenRef = useRef<HTMLDivElement>(null);
  const mermaidInitRef = useRef(false);

  // Mobile
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [showClassTopic, setShowClassTopic] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Stable refs so callbacks always see the latest value
  const selectedModeRef = useRef(selectedMode);
  selectedModeRef.current = selectedMode;
  const selectedClassIdRef = useRef(selectedClassId);
  selectedClassIdRef.current = selectedClassId;
  const topicRef = useRef(topic);
  topicRef.current = topic;
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const aiSpeakingRef = useRef(false);
  aiSpeakingRef.current = aiStatus === 'speaking';

  // Audio playback hook (Gemini TTS)
  const { playPcmAudio, stopAudio } = useAudioPlayback();
  const pendingTtsTextRef = useRef('');
  const ttsRecoveryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Speech result handler — sends final text to WebSocket
  const handleSpeechResult = useCallback(
    (finalText: string) => {
      // INTERRUPT: stop any playing AI audio when user speaks
      stopAudio();

      addTranscriptEntry('user', finalText);
      setAiStatus('thinking');

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'transcript',
            text: finalText,
            mode: selectedModeRef.current,
            tool: 'study_buddy',
            class_id: selectedClassIdRef.current || undefined,
            topic: topicRef.current || undefined,
          })
        );
      }
    },
    [addTranscriptEntry, stopAudio]
  );

  // Reliable speech recognition via shared hook
  const {
    start: startListening,
    stop: stopListening,
    isActive: speechActive,
    error: speechError,
    retryCount,
  } = useSpeechRecognition({
    onResult: handleSpeechResult,
    onInterim: setInterimText,
    aiSpeakingRef,
  });

  // Stable refs for start/stop so WebSocket callback can pause/resume mic
  const startListeningRef = useRef(startListening);
  startListeningRef.current = startListening;
  const stopListeningRef = useRef(stopListening);
  stopListeningRef.current = stopListening;

  // Fetch classes for dropdown
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

  // Initialize mermaid
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
        flowchart: { curve: 'basis', padding: 15 },
      });
    });
  }, []);

  // Render mermaid diagram
  useEffect(() => {
    if (!mermaidCode) return;
    import('mermaid').then(async (m) => {
      try {
        const id = `mermaid-sb-${Date.now()}`;
        const { svg } = await m.default.render(id, mermaidCode);
        if (mermaidContainerRef.current) {
          mermaidContainerRef.current.innerHTML = svg;
        }
        if (mermaidFullscreenRef.current) {
          const id2 = `mermaid-sb-fs-${Date.now()}`;
          const { svg: svg2 } = await m.default.render(id2, mermaidCode);
          mermaidFullscreenRef.current.innerHTML = svg2;
        }
      } catch { /* diagram parse error */ }
    });
  }, [mermaidCode, rightPanel, diagramFullscreen]);

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_BASE}/ws/study-session`);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data: WebSocketIncoming = JSON.parse(event.data);

        if (data.type === 'ai_response') {
          // Stop any currently playing audio — new response preempts old
          stopAudio();
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }

          setAiStatus('speaking');
          addTranscriptEntry('ai', data.text);

          const onDone = () => {
            if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }
            if (isRecordingRef.current) startListeningRef.current();
            setAiStatus(isRecordingRef.current ? 'listening' : 'idle');
          };

          pendingTtsTextRef.current = data.text || '';

          if (data.should_speak && data.audio_data && voiceEnabledRef.current) {
            stopListeningRef.current();
            pendingTtsTextRef.current = '';
            playPcmAudio(data.audio_data, data.audio_sample_rate || 24000, onDone);
          } else if (data.should_speak && voiceEnabledRef.current) {
            stopListeningRef.current();
            // Wait for ai_audio supplement; if it never arrives, resume after timeout
            ttsRecoveryRef.current = setTimeout(() => {
              pendingTtsTextRef.current = '';
              onDone();
            }, 15000);
          } else {
            setTimeout(onDone, 300);
          }
        } else if (data.type === 'ai_audio') {
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }
          pendingTtsTextRef.current = '';
          if (!voiceEnabledRef.current) return;
          stopListeningRef.current();
          playPcmAudio(
            data.audio_data,
            data.audio_sample_rate || 24000,
            () => {
              if (isRecordingRef.current) startListeningRef.current();
              setAiStatus(isRecordingRef.current ? 'listening' : 'idle');
            }
          );
        } else if (data.type === 'tts_failed') {
          // TTS failed — just resume listening, text is already displayed
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }
          pendingTtsTextRef.current = '';
          if (isRecordingRef.current) startListeningRef.current();
          setAiStatus(isRecordingRef.current ? 'listening' : 'idle');
        } else if (data.type === 'plot_update' && data.graph?.mermaid_code) {
          setMermaidCode(data.graph.mermaid_code);
          // Auto-switch to map view on first diagram
          if (!mermaidCode) setRightPanel('map');
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
      console.log('WebSocket disconnected');
    };

    ws.onerror = () => {
      console.log('WebSocket error');
    };

    wsRef.current = ws;
  }, [addTranscriptEntry, playPcmAudio, playNotificationSound]);

  function handleStartSession() {
    setSessionActive(true);
    setTranscript([]);
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
      stopListening();
    }
  }

  function handleEndSession() {
    setSessionActive(false);
    setIsRecording(false);
    setIsPaused(false);
    setAiStatus('idle');
    setInterimText('');
    stopListening();
    stopAudio();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
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
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [stopListening, stopAudio]);

  const currentModeConfig = modes.find((m) => m.mode === selectedMode)!;

  function getStatusLabel(status: AIStatus) {
    switch (status) {
      case 'listening':
        return 'Listening...';
      case 'thinking':
        return 'Thinking...';
      case 'speaking':
        return 'Speaking...';
      default:
        return 'Ready';
    }
  }

  // ── Right panel content (shared between desktop inline and mobile overlay) ──
  const rightPanelContent = (
    <>
      {/* Panel toggle header */}
      <div className="flex" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => setRightPanel('transcript')}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
          style={{
            color: rightPanel === 'transcript' ? 'var(--accent)' : 'var(--text-faint)',
            borderBottom: rightPanel === 'transcript' ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >
          <Volume2 size={12} />
          Transcript
          {transcript.length > 0 && (
            <span className="text-[9px] opacity-60">({transcript.length})</span>
          )}
        </button>
        <button
          onClick={() => setRightPanel('map')}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
          style={{
            color: rightPanel === 'map' ? 'var(--blue)' : 'var(--text-faint)',
            borderBottom: rightPanel === 'map' ? '2px solid var(--blue)' : '2px solid transparent',
          }}
        >
          <Network size={12} />
          Map
          {mermaidCode && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--blue)' }} />}
        </button>
        {isMobile && (
          <button
            onClick={() => setShowRightPanel(false)}
            className="px-3 flex items-center justify-center cursor-pointer"
            style={{ color: 'var(--text-faint)' }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Transcript view */}
      {rightPanel === 'transcript' && (
        <div className="flex-1 overflow-y-auto p-3">
          {transcript.length === 0 && !interimText ? (
            <div className="text-center py-12">
              <Volume2 size={32} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
                Start speaking to see the transcript here.
              </p>
            </div>
          ) : (
            <>
              {transcript.map((entry) => (
                <div
                  key={entry.id}
                  className="mb-2 p-2 rounded-lg text-xs"
                  style={{
                    background: entry.speaker === 'user' ? 'var(--accent-muted)' : 'var(--bg)',
                    border: `1px solid ${entry.speaker === 'user' ? 'rgba(212, 166, 74, 0.15)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <span className="text-[10px] font-medium opacity-60 block mb-0.5">
                    {entry.speaker === 'user' ? 'You' : 'AI'}
                  </span>
                  <span style={{ color: 'var(--text-primary)' }}>{entry.text}</span>
                </div>
              ))}
              {interimText && (
                <div className="mb-2 p-2 rounded-lg text-xs opacity-50"
                  style={{ background: 'var(--accent-muted)', border: '1px solid rgba(212, 166, 74, 0.1)' }}>
                  <span className="text-[10px] font-medium opacity-60 block mb-0.5">You</span>
                  <span className="italic" style={{ color: 'var(--text-faint)' }}>{interimText}...</span>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </>
          )}
        </div>
      )}

      {/* Concept Map view */}
      {rightPanel === 'map' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {mermaidCode ? (
            <>
              <div className="flex items-center justify-between px-3 py-2"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Live Concept Map
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setZoom((z) => Math.min(z + 0.2, 3))} className="p-1 rounded cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}><ZoomIn size={13} /></button>
                  <button onClick={() => setZoom((z) => Math.max(z - 0.2, 0.3))} className="p-1 rounded cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}><ZoomOut size={13} /></button>
                  <button onClick={() => setZoom(1)} className="p-1 rounded cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}><RotateCcw size={13} /></button>
                  {!isMobile && (
                    <button onClick={() => setDiagramFullscreen(true)} className="p-1 rounded cursor-pointer"
                      style={{ color: 'var(--text-muted)' }} title="Fullscreen"><Maximize2 size={13} /></button>
                  )}
                  <MermaidExport mermaidCode={mermaidCode} containerRef={mermaidContainerRef} />
                </div>
              </div>
              <div className="flex-1 overflow-auto p-2">
                <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} className="transition-transform duration-200">
                  <div ref={mermaidContainerRef} className="mermaid-render" />
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center py-8 px-4">
              <Network size={32} className="mb-3" style={{ color: 'var(--text-faint)' }} />
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                Concept map builds as you study. Start a quiz, guided study, or general session to see connections.
              </p>
            </div>
          )}
        </div>
      )}

      {showHistory && (
        <div className="absolute inset-0 z-30" style={{ background: 'var(--surface)' }}>
          <SessionHistory
            tool="study_buddy"
            onSelectSession={(detail: SessionDetail) => {
              setShowHistory(false);
            }}
            onClose={() => setShowHistory(false)}
          />
        </div>
      )}
    </>
  );

  // ── Fact-check panel content ──
  const factCheckContent = (
    <>
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Fact Checks
        </span>
        <button
          onClick={() => setShowFactPanel(false)}
          className="p-1 rounded transition-colors cursor-pointer"
          style={{ color: 'var(--text-faint)' }}
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {factChecks.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>
            No fact checks yet.
          </p>
        ) : (
          factChecks.map((fc) => (
            <div
              key={fc.id}
              className="p-3 rounded-lg"
              style={{
                background: fc.status === 'incorrect' ? 'var(--red-muted)' : 'var(--amber-muted)',
                border: `1px solid ${
                  fc.status === 'incorrect'
                    ? 'rgba(204, 80, 64, 0.2)'
                    : 'rgba(212, 166, 74, 0.2)'
                }`,
              }}
            >
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
                    <span className="ml-2 opacity-60">
                      {Math.round(fc.confidence * 100)}%
                    </span>
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
        <div className={isMobile ? 'flex flex-col gap-1.5' : 'flex items-center gap-2 flex-wrap'}>
          {/* Mode pills — horizontally scrollable on mobile */}
          <div className={isMobile ? 'flex gap-1.5 overflow-x-auto no-scrollbar' : 'flex items-center gap-2 flex-wrap'}>
            {modes.map(({ mode, label, icon: Icon, color }) => (
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

          {/* Action buttons row */}
          <div className={isMobile ? 'flex items-center gap-2' : 'ml-auto flex items-center gap-2'}>
            {/* Class/Topic toggle (mobile only) */}
            {isMobile && (
              <button
                onClick={() => setShowClassTopic(!showClassTopic)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
                style={{
                  background: showClassTopic ? 'rgba(212, 166, 74, 0.15)' : 'transparent',
                  border: `1px solid ${showClassTopic ? 'rgba(212, 166, 74, 0.3)' : 'var(--border-subtle)'}`,
                  color: showClassTopic ? 'var(--amber)' : 'var(--text-muted)',
                }}
              >
                {showClassTopic ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {selectedClassId ? 'Class' : 'Setup'}
              </button>
            )}
            {isMobile && (
              <button
                onClick={() => setShowRightPanel(!showRightPanel)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
                style={{
                  background: showRightPanel ? 'rgba(212, 166, 74, 0.15)' : 'transparent',
                  border: `1px solid ${showRightPanel ? 'rgba(212, 166, 74, 0.3)' : 'var(--border-subtle)'}`,
                  color: showRightPanel ? 'var(--amber)' : 'var(--text-muted)',
                }}
              >
                <PanelRight size={12} />
                Panel
              </button>
            )}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="p-2 rounded-lg transition-colors cursor-pointer"
              style={{
                background: showHistory ? 'rgba(212, 166, 74, 0.15)' : 'transparent',
                border: `1px solid ${showHistory ? 'rgba(212, 166, 74, 0.3)' : 'var(--border-subtle)'}`,
                color: showHistory ? 'var(--amber)' : 'var(--text-muted)',
                minWidth: '36px',
                minHeight: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Session history"
            >
              <Clock size={16} />
            </button>
          </div>

          {/* Collapsible class/topic section (mobile) */}
          {isMobile && showClassTopic && (
            <div className="flex gap-2 animate-slide-up">
              <div className="flex-1 relative">
                <select
                  className="form-select text-xs w-full"
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  style={{ minHeight: '36px' }}
                >
                  <option value="">No class</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                className="form-input text-xs flex-1"
                placeholder="Topic..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                style={{ minHeight: '36px' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: class & topic (desktop only) */}
        {!isMobile && (
          <div
            className="w-56 p-3 flex flex-col gap-3 flex-shrink-0"
            style={{
              borderRight: '1px solid var(--border-subtle)',
              background: 'var(--surface)',
            }}
          >
            <div>
              <label
                className="block text-xs font-medium mb-1.5 uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                Class
              </label>
              <div className="relative">
                <select
                  className="form-select text-sm"
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                >
                  <option value="">No class selected</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--text-faint)' }}
                />
              </div>
            </div>

            <div>
              <label
                className="block text-xs font-medium mb-1.5 uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                Topic
              </label>
              <input
                type="text"
                className="form-input text-sm"
                placeholder="e.g. Photosynthesis"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>

            {/* Mode hint */}
            <div className="mt-auto">
              <div
                className="p-3 rounded-lg"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {currentModeConfig.hint}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Center: Mic & Status */}
        <div
          className="flex-1 flex flex-col items-center justify-center px-4 relative"
          style={{ background: 'var(--bg)' }}
        >
          {/* Speech error banner */}
          {speechError && (
            <div
              className={`absolute top-4 ${isMobile ? 'left-2 right-2' : 'left-4 right-4'} flex items-center gap-2 p-3 rounded-lg text-sm`}
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
              className={`absolute top-4 ${isMobile ? 'left-2 right-2' : 'left-4 right-4'} flex items-center gap-2 p-3 rounded-lg text-sm`}
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

          {/* Status */}
          <div className="flex items-center gap-2 mb-4">
            <span className={`status-dot ${aiStatus}`} />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {getStatusLabel(aiStatus)}
            </span>
          </div>

          {/* Mic button */}
          <div className="relative mb-4">
            <button
              onClick={handleToggleMic}
              className={`mic-btn ${isRecording ? 'recording' : ''}`}
              style={isMobile ? { width: '80px', height: '80px' } : undefined}
            >
              {isRecording ? <MicOff size={isMobile ? 36 : 32} /> : <Mic size={isMobile ? 36 : 32} />}
              {isRecording && <span className="mic-ring" />}
            </button>
          </div>

          {/* Start/Stop label */}
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            {isRecording
              ? 'Tap to stop recording'
              : sessionActive
              ? 'Tap to resume recording'
              : 'Tap to start session'}
          </p>

          {/* Interim text */}
          {interimText && (
            <div className={`${isMobile ? 'max-w-[90%]' : 'max-w-md'} text-center`}>
              <p className="text-sm italic" style={{ color: 'var(--text-faint)' }}>
                {interimText}
              </p>
            </div>
          )}

          {/* Fact-check badge */}
          {factChecks.length > 0 && (
            <button
              onClick={() => {
                setShowFactPanel(!showFactPanel);
                setUnreadCount(0);
                setFactChecks((prev) => prev.map((fc) => ({ ...fc, read: true })));
              }}
              className={`absolute top-4 ${isMobile ? 'right-2' : 'right-4'} z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer`}
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
              className={`absolute bottom-20 ${isMobile ? 'left-2 right-2' : 'left-4'} z-20 ${isMobile ? '' : 'max-w-sm'} animate-slide-up cursor-pointer`}
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

          {/* Session controls */}
          {sessionActive && (
            <div className={`absolute ${isMobile ? 'bottom-4' : 'bottom-6'} flex items-center gap-3`}>
              {isRecording && (
                <button
                  onClick={handlePauseResume}
                  className="rounded-lg transition-colors cursor-pointer"
                  style={{
                    padding: isMobile ? '12px' : '10px',
                    background: isPaused ? 'rgba(212, 166, 74, 0.15)' : 'var(--surface)',
                    border: `1px solid ${isPaused ? 'rgba(212, 166, 74, 0.3)' : 'var(--border-subtle)'}`,
                    color: isPaused ? 'var(--amber)' : 'var(--text-muted)',
                    minWidth: '44px',
                    minHeight: '44px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title={isPaused ? 'Resume recording' : 'Pause recording'}
                >
                  {isPaused ? <Mic size={16} /> : <Pause size={16} />}
                </button>
              )}
              <button
                onClick={handleVoiceToggle}
                className="rounded-lg transition-colors cursor-pointer"
                style={{
                  padding: isMobile ? '12px' : '10px',
                  background: voiceEnabled ? 'transparent' : 'rgba(204, 80, 64, 0.15)',
                  border: `1px solid ${voiceEnabled ? 'var(--border-subtle)' : 'rgba(204, 80, 64, 0.3)'}`,
                  color: voiceEnabled ? 'var(--text-muted)' : 'var(--red)',
                  minWidth: '44px',
                  minHeight: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={voiceEnabled ? 'Mute AI voice' : 'Unmute AI voice'}
              >
                {voiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <button onClick={handleEndSession} className="btn-danger text-sm" style={isMobile ? { minHeight: '44px' } : undefined}>
                <Square size={14} />
                End
              </button>
            </div>
          )}
        </div>

        {/* Fact-check detail panel — desktop inline, mobile overlay */}
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

        {/* Right: Transcript / Concept Map Panel — desktop only */}
        {!isMobile && (
          <div className="w-80 flex-shrink-0 flex flex-col relative"
            style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border-subtle)' }}>
            {rightPanelContent}
          </div>
        )}
      </div>

      {/* Mobile: Right panel overlay */}
      {isMobile && showRightPanel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setShowRightPanel(false)} />
          <div
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col animate-slide-up"
            style={{ background: 'var(--surface)', height: '70vh', borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}
          >
            {rightPanelContent}
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
              tool="study_buddy"
              onSelectSession={(detail: SessionDetail) => {
                setShowHistory(false);
              }}
              onClose={() => setShowHistory(false)}
            />
          </div>
        </>
      )}

      {/* Fullscreen diagram overlay */}
      {diagramFullscreen && mermaidCode && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: 'var(--bg)' }}
        >
          <div className="flex items-center justify-between px-6 py-3"
            style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Concept Map
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setZoom((z) => Math.min(z + 0.2, 3))} className="p-2 rounded cursor-pointer"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}><ZoomIn size={16} /></button>
              <button onClick={() => setZoom((z) => Math.max(z - 0.2, 0.3))} className="p-2 rounded cursor-pointer"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}><ZoomOut size={16} /></button>
              <button onClick={() => setZoom(1)} className="p-2 rounded cursor-pointer"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}><RotateCcw size={16} /></button>
              <button onClick={() => setDiagramFullscreen(false)} className="p-2 rounded cursor-pointer"
                style={{ color: 'var(--red)', border: '1px solid rgba(204, 80, 64, 0.3)', background: 'var(--red-muted)' }}
                title="Exit fullscreen">
                <Minimize2 size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-6">
            <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} className="transition-transform duration-200">
              <div ref={mermaidFullscreenRef} className="mermaid-render" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
