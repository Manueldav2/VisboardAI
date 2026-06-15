'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { WS_BASE } from '@/lib/api';
import {
  Mic,
  MicOff,
  Scale,
  AlertTriangle,
  Shield,
  ShieldAlert,
  X,
  Volume2,
  VolumeX,
  Pause,
  Flame,
  Trophy,
  Activity,
  Clock,
  Network,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Gavel,
  Swords,
  XCircle,
  FileSearch,
  Send,
  GitBranch,
  Sparkles,
  GraduationCap,
  Target,
  ArrowRight,
  CheckCircle2,
  XOctagon,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useSpeechRecognition } from '@/lib/useSpeechRecognition';
import { useAudioPlayback } from '@/lib/useAudioPlayback';
import { useIsMobile } from '@/lib/useIsMobile';
import { MermaidExport } from '@/components/MermaidExport';
import { SessionHistory } from '@/components/SessionHistory';
import type {
  TranscriptEntry,
  WebSocketIncoming,
  FallacyCall,
  SessionDetail,
  FactCheckNotification,
  DebateAnalysis,
  TechniqueDetection,
  Contention,
} from '@/lib/types';

type AIStatus = 'idle' | 'listening' | 'analyzing' | 'speaking';

interface TranscriptItem {
  id: string;
  type: 'speech' | 'fallacy' | 'technique';
  speaker?: 'user' | 'ai';
  text?: string;
  fallacy?: FallacyCall;
  technique?: TechniqueDetection;
  timestamp: number;
}

const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  high: { bg: 'rgba(220, 38, 38, 0.15)', border: '#dc2626', text: '#fca5a5' },
  medium: { bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b', text: '#fde68a' },
  low: { bg: 'rgba(107, 114, 128, 0.15)', border: '#6b7280', text: '#d1d5db' },
};

const TECHNIQUE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  effective: { bg: 'rgba(74, 222, 128, 0.15)', border: '#4ade80', text: '#86efac' },
  weak: { bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b', text: '#fde68a' },
  misapplied: { bg: 'rgba(220, 38, 38, 0.15)', border: '#dc2626', text: '#fca5a5' },
};

const STRENGTH_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  strong: { bg: 'rgba(74, 222, 128, 0.15)', border: '#4ade80', label: 'Strong' },
  moderate: { bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b', label: 'Moderate' },
  weak: { bg: 'rgba(220, 38, 38, 0.15)', border: '#dc2626', label: 'Weak' },
};

const EVIDENCE_COLORS: Record<string, string> = {
  strong: '#4ade80',
  moderate: '#f59e0b',
  weak: '#f87171',
  missing: '#6b7280',
};

const CATEGORY_ICONS: Record<string, string> = {
  Formal: '\u2227',
  Relevance: '\u2192',
  Presumption: '\u26a0',
  Ambiguity: '\u2248',
  'Bad Faith': '\ud83c\udfad',
  'Factual Error': '\u2716',
};

type ArgMode = 'referee' | 'harvey' | 'analyze';
type ScoreTab = 'score' | 'structure' | 'techniques' | 'coach' | 'plot';

const TAB_CONFIG: { id: ScoreTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'score', label: 'SCORE', icon: Trophy },
  { id: 'structure', label: 'STRUCT', icon: GitBranch },
  { id: 'techniques', label: 'TECH', icon: Sparkles },
  { id: 'coach', label: 'COACH', icon: GraduationCap },
  { id: 'plot', label: 'MAP', icon: Network },
];

export default function ArgumentRefPage() {
  const isMobile = useIsMobile();
  const [showPanel, setShowPanel] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIStatus>('idle');
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [fallacies, setFallacies] = useState<FallacyCall[]>([]);
  const [techniques, setTechniques] = useState<TechniqueDetection[]>([]);
  const [contentions, setContentions] = useState<Contention[]>([]);
  const [interimText, setInterimText] = useState('');
  const [sessionActive, setSessionActive] = useState(false);
  const [selectedFallacy, setSelectedFallacy] = useState<FallacyCall | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Mode: Referee (passive) vs Harvey Specter (active debate) vs Analyze (paste)
  const [argMode, setArgMode] = useState<ArgMode>('referee');
  const argModeRef = useRef<ArgMode>(argMode);
  argModeRef.current = argMode;

  // Prevent mic feedback loop + instant interrupt when AI speaking
  const aiSpeakingRef = useRef(false);
  aiSpeakingRef.current = aiStatus === 'speaking';

  // Fact-check notifications
  const [factChecks, setFactChecks] = useState<FactCheckNotification[]>([]);
  const [unreadFcCount, setUnreadFcCount] = useState(0);
  const [showFactPanel, setShowFactPanel] = useState(false);
  const fcToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debate diagram
  const [mermaidCode, setMermaidCode] = useState('');
  const [scoreTab, setScoreTab] = useState<ScoreTab>('score');
  const [zoom, setZoom] = useState(1);
  const mermaidContainerRef = useRef<HTMLDivElement>(null);
  const mermaidInitRef = useRef(false);

  // Analyze mode state
  const [analyzeText, setAnalyzeText] = useState('');
  const [analyzeContext, setAnalyzeContext] = useState('');
  const [debateAnalysis, setDebateAnalysis] = useState<DebateAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    strongest: true,
    weakest: true,
    rewrites: false,
    attacks: false,
    evidence: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;

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

  // Computed scoreboard — enhanced with techniques
  const scoreboard = useMemo(() => {
    const fallacyTotal = fallacies.length;
    const byType: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let severityScore = 0;

    for (const f of fallacies) {
      byType[f.name] = (byType[f.name] || 0) + 1;
      byCategory[f.category] = (byCategory[f.category] || 0) + 1;
      severityScore += f.severity === 'high' ? 15 : f.severity === 'medium' ? 8 : 3;
    }

    // Technique scoring (positive)
    const techniqueTotal = techniques.length;
    let techniqueScore = 0;
    const byTechnique: Record<string, { count: number; effective: number }> = {};

    for (const t of techniques) {
      if (!byTechnique[t.name]) byTechnique[t.name] = { count: 0, effective: 0 };
      byTechnique[t.name].count++;
      if (t.quality === 'effective') {
        byTechnique[t.name].effective++;
        techniqueScore += 10;
      } else if (t.quality === 'weak') {
        techniqueScore += 3;
      }
    }

    // Combined health: base 50, fallacies subtract, techniques add
    const health = Math.max(0, Math.min(100, 50 - severityScore + techniqueScore));
    const grade =
      health >= 90 ? 'A' : health >= 75 ? 'B' : health >= 55 ? 'C' : health >= 30 ? 'D' : 'F';

    return { fallacyTotal, byType, byCategory, health, grade, techniqueTotal, byTechnique, techniqueScore };
  }, [fallacies, techniques]);

  const addItem = useCallback(
    (type: 'speech' | 'fallacy' | 'technique', data: Partial<TranscriptItem>) => {
      const item: TranscriptItem = {
        id: crypto.randomUUID(),
        type,
        timestamp: Date.now(),
        ...data,
      };
      setItems((prev) => [...prev, item]);
    },
    []
  );

  // Whistle sound for fallacy detection
  const playWhistleSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      // Short sharp whistle (two-tone)
      osc.type = 'square';
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.setValueAtTime(800, ctx.currentTime + 0.08);
      osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.16);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      // AudioContext not available
    }
  }, []);

  // Speech handler
  const handleSpeechResult = useCallback(
    (finalText: string) => {
      // INTERRUPT: stop any playing AI audio
      stopAudio();

      addItem('speech', { speaker: 'user', text: finalText });
      setAiStatus('analyzing');

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'transcript',
            text: finalText,
            mode: argModeRef.current,
            tool: 'argument_ref',
          })
        );
      }
    },
    [addItem, stopAudio]
  );

  const {
    start: startListening,
    stop: stopListening,
    isActive: speechActive,
    error: speechError,
  } = useSpeechRecognition({
    onResult: handleSpeechResult,
    onInterim: setInterimText,
    aiSpeakingRef,
  });

  // Stable refs for start/stop so the WebSocket callback can use them
  const startListeningRef = useRef(startListening);
  startListeningRef.current = startListening;
  const stopListeningRef = useRef(stopListening);
  stopListeningRef.current = stopListening;

  // Auto-scroll
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items, interimText]);

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
    if (!mermaidCode || !mermaidContainerRef.current) return;
    import('mermaid').then(async (m) => {
      try {
        const id = `mermaid-arg-${Date.now()}`;
        const { svg } = await m.default.render(id, mermaidCode);
        if (mermaidContainerRef.current) {
          mermaidContainerRef.current.innerHTML = svg;
        }
      } catch { /* diagram parse error */ }
    });
  }, [mermaidCode, scoreTab]);

  // WebSocket
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_BASE}/ws/study-session`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'ai_response') {
          // Stop any currently playing audio — new response preempts old
          stopAudio();
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }

          setAiStatus('speaking');
          addItem('speech', { speaker: 'ai', text: data.text });

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
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }
          pendingTtsTextRef.current = '';
          if (isRecordingRef.current) startListeningRef.current();
          setAiStatus(isRecordingRef.current ? 'listening' : 'idle');
        } else if (data.type === 'plot_update' && data.graph?.mermaid_code) {
          setMermaidCode(data.graph.mermaid_code);
          if (!mermaidCode) setScoreTab('plot');
        } else if (data.type === 'fallacy_call') {
          const fallacy = data.fallacy;
          setFallacies((prev) => [...prev, fallacy]);
          addItem('fallacy', { fallacy });
          playWhistleSound();
        } else if (data.type === 'technique_detected') {
          const technique = data.technique as TechniqueDetection;
          setTechniques((prev) => [...prev, technique]);
          addItem('technique', { technique });
        } else if (data.type === 'debate_analysis') {
          setDebateAnalysis(data.analysis as DebateAnalysis);
          setIsAnalyzing(false);
          setScoreTab('structure');
        } else if (data.type === 'contention_update') {
          setContentions(data.contentions || []);
        } else if (data.type === 'fact_check') {
          const notification: FactCheckNotification = {
            ...data,
            timestamp: Date.now(),
            read: false,
          };
          setFactChecks((prev) => [notification, ...prev]);
          setUnreadFcCount((prev) => prev + 1);
        }
      } catch {
        // Invalid message
      }
    };

    ws.onclose = () => console.log('ArgumentRef WS disconnected');
    ws.onerror = () => console.log('ArgumentRef WS error');

    wsRef.current = ws;
  }, [addItem, playPcmAudio, playWhistleSound]);

  const handleStartSession = useCallback(() => {
    setSessionActive(true);
    setItems([]);
    setFallacies([]);
    setTechniques([]);
    setSelectedFallacy(null);
    setDebateAnalysis(null);
    connectWebSocket();
  }, [connectWebSocket]);

  const handleToggleRecording = useCallback(() => {
    if (!sessionActive) handleStartSession();

    if (isRecording) {
      stopListening();
      stopAudio();
      setIsRecording(false);
      setIsPaused(false);
      setAiStatus('idle');
    } else {
      setIsRecording(true);
      setIsPaused(false);
      setAiStatus('listening');
      startListening();
    }
  }, [
    isRecording,
    sessionActive,
    handleStartSession,
    startListening,
    stopListening,
    stopAudio,
  ]);

  const handlePauseResume = useCallback(() => {
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
  }, [isPaused, startListening, stopListening]);

  // Analyze mode: send argument for analysis
  const handleAnalyze = useCallback(() => {
    if (!analyzeText.trim() || isAnalyzing) return;
    if (!sessionActive) handleStartSession();

    setIsAnalyzing(true);
    setDebateAnalysis(null);

    // Small delay to ensure WS is connected
    setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'analyze_argument',
            text: analyzeText,
            context: analyzeContext,
            tool: 'argument_ref',
          })
        );
      }
    }, 300);
  }, [analyzeText, analyzeContext, isAnalyzing, sessionActive, handleStartSession]);

  // Cleanup
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      stopListening();
    };
  }, [stopListening]);

  // Auto-dismiss fact-check toast after 8 seconds
  useEffect(() => {
    if (factChecks.length > 0 && !factChecks[0].read) {
      if (fcToastTimerRef.current) clearTimeout(fcToastTimerRef.current);
      fcToastTimerRef.current = setTimeout(() => {
        setFactChecks((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          updated[0] = { ...updated[0], read: true };
          return updated;
        });
      }, 8000);
    }
    return () => { if (fcToastTimerRef.current) clearTimeout(fcToastTimerRef.current); };
  }, [factChecks]);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Health bar color
  const healthColor =
    scoreboard.health >= 75
      ? '#4ade80'
      : scoreboard.health >= 45
        ? '#f59e0b'
        : '#ef4444';

  // Grade color for analyze mode
  const gradeColor = (grade: string) => {
    const g = grade.charAt(0);
    if (g === 'A') return '#4ade80';
    if (g === 'B') return '#60a5fa';
    if (g === 'C') return '#f59e0b';
    return '#ef4444';
  };

  const isLiveMode = argMode === 'referee' || argMode === 'harvey';

  return (
    <div className="flex flex-col md:flex-row h-screen" style={{ background: 'var(--base)' }}>
      {/* ==================== LEFT PANEL ==================== */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 md:px-6 h-14 md:h-16 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div
              className="flex items-center justify-center w-8 h-8 md:w-9 md:h-9 rounded-lg flex-shrink-0"
              style={{
                background: argMode === 'harvey' ? 'var(--accent)' : argMode === 'analyze' ? 'rgba(96, 165, 250, 0.2)' : 'var(--red)',
                color: argMode === 'harvey' ? 'var(--bg)' : argMode === 'analyze' ? '#60a5fa' : 'var(--cream)',
              }}
            >
              {argMode === 'harvey' ? <Swords size={16} /> : argMode === 'analyze' ? <FileSearch size={16} /> : <Scale size={16} />}
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm md:text-base truncate" style={{ color: 'var(--text-primary)' }}>
                {argMode === 'harvey' ? 'Harvey Specter' : argMode === 'analyze' ? 'Debate Coach' : 'Argument Ref'}
              </h1>
              <p className="text-[10px] md:text-xs truncate" style={{ color: 'var(--text-faint)' }}>
                {argMode === 'harvey'
                  ? sessionActive
                    ? 'Cross-examining your argument...'
                    : 'The best closer in NYC is waiting'
                  : argMode === 'analyze'
                    ? isAnalyzing
                      ? 'Analyzing your argument...'
                      : debateAnalysis
                        ? `Grade: ${debateAnalysis.overall_grade}`
                        : 'Paste an argument to analyze'
                    : sessionActive
                      ? isRecording
                        ? 'Listening for fallacies...'
                        : 'Session active'
                      : 'Start recording to begin'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            {/* Mode toggle: Referee vs Harvey vs Analyze */}
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
              <button
                onClick={() => setArgMode('referee')}
                className="flex items-center gap-1 px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                style={{
                  background: argMode === 'referee' ? 'rgba(204, 80, 64, 0.15)' : 'transparent',
                  color: argMode === 'referee' ? 'var(--red)' : 'var(--text-faint)',
                  borderRight: '1px solid var(--border-subtle)',
                }}
              >
                <Gavel size={11} />
                <span className="hidden sm:inline">Referee</span>
              </button>
              <button
                onClick={() => setArgMode('harvey')}
                className="flex items-center gap-1 px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                style={{
                  background: argMode === 'harvey' ? 'rgba(212, 166, 74, 0.2)' : 'transparent',
                  color: argMode === 'harvey' ? 'var(--accent)' : 'var(--text-faint)',
                  borderRight: '1px solid var(--border-subtle)',
                }}
              >
                <Swords size={11} />
                <span className="hidden sm:inline">Harvey</span>
              </button>
              <button
                onClick={() => setArgMode('analyze')}
                className="flex items-center gap-1 px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                style={{
                  background: argMode === 'analyze' ? 'rgba(96, 165, 250, 0.15)' : 'transparent',
                  color: argMode === 'analyze' ? '#60a5fa' : 'var(--text-faint)',
                }}
              >
                <FileSearch size={11} />
                <span className="hidden sm:inline">Analyze</span>
              </button>
            </div>

            {sessionActive && argMode === 'referee' && !isMobile && (
              <div
                className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-full"
                style={{
                  background: scoreboard.fallacyTotal > 0 ? 'rgba(220, 38, 38, 0.15)' : 'rgba(74, 222, 128, 0.15)',
                  color: scoreboard.fallacyTotal > 0 ? '#fca5a5' : '#4ade80',
                }}
              >
                <Shield size={14} />
                {scoreboard.fallacyTotal} fallac{scoreboard.fallacyTotal === 1 ? 'y' : 'ies'}
              </div>
            )}

            {/* Mobile: panel toggle */}
            {isMobile && (
              <button
                onClick={() => setShowPanel(!showPanel)}
                className="p-2 rounded-lg transition-colors cursor-pointer"
                style={{
                  background: showPanel ? 'rgba(96, 165, 250, 0.15)' : 'var(--surface)',
                  border: `1px solid ${showPanel ? 'rgba(96, 165, 250, 0.3)' : 'var(--border-subtle)'}`,
                  color: showPanel ? '#60a5fa' : 'var(--text-muted)',
                }}
                title="Toggle Panel"
              >
                <Activity size={16} />
              </button>
            )}

            <button
              onClick={() => setShowHistory(true)}
              className="p-2 rounded-lg transition-colors cursor-pointer"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-muted)',
              }}
              title="Session History"
            >
              <Clock size={16} />
            </button>
          </div>
        </div>

        {/* ====== ANALYZE MODE LEFT PANEL ====== */}
        {argMode === 'analyze' ? (
          <div className="flex-1 overflow-y-auto px-3 md:px-6 py-3 md:py-4">
            {!debateAnalysis ? (
              /* Input form */
              <div className="max-w-2xl mx-auto">
                <div className="mb-4">
                  <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: 'var(--text-muted)' }}>
                    Your Argument
                  </label>
                  <textarea
                    value={analyzeText}
                    onChange={(e) => setAnalyzeText(e.target.value)}
                    placeholder="Paste your argument, debate transcript, or written position here...

Example: 'I believe renewable energy is the only viable solution because fossil fuels are running out, solar costs have dropped 89% since 2010, and countries like Germany have proven it works at scale...'"
                    className="w-full rounded-xl px-4 py-3 text-sm leading-relaxed resize-none"
                    style={{
                      background: 'var(--elevated)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      minHeight: '240px',
                    }}
                    disabled={isAnalyzing}
                  />
                </div>
                <div className="mb-4">
                  <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: 'var(--text-muted)' }}>
                    Context <span style={{ color: 'var(--text-faint)' }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={analyzeContext}
                    onChange={(e) => setAnalyzeContext(e.target.value)}
                    placeholder="What's the debate about? Who's the opponent? e.g. 'Debate on climate policy with a free market advocate'"
                    className="w-full rounded-lg px-4 py-2.5 text-sm"
                    style={{
                      background: 'var(--elevated)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }}
                    disabled={isAnalyzing}
                  />
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={!analyzeText.trim() || isAnalyzing}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer"
                  style={{
                    background: isAnalyzing ? 'var(--elevated)' : '#60a5fa',
                    color: isAnalyzing ? 'var(--text-faint)' : '#0c0b09',
                    opacity: !analyzeText.trim() ? 0.4 : 1,
                  }}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Analyzing with web research...
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      Analyze Argument
                    </>
                  )}
                </button>
              </div>
            ) : (
              /* Analysis results */
              <div className="max-w-2xl mx-auto space-y-4">
                {/* Grade header */}
                <div className="flex items-center gap-4 p-4 rounded-xl" style={{ background: 'var(--elevated)' }}>
                  <div
                    className="flex items-center justify-center w-16 h-16 rounded-xl text-2xl font-black"
                    style={{
                      background: `${gradeColor(debateAnalysis.overall_grade)}20`,
                      color: gradeColor(debateAnalysis.overall_grade),
                      border: `2px solid ${gradeColor(debateAnalysis.overall_grade)}`,
                    }}
                  >
                    {debateAnalysis.overall_grade}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Score: {debateAnalysis.overall_score}/100
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {debateAnalysis.summary}
                    </p>
                  </div>
                </div>

                {/* How to Win */}
                <div className="rounded-xl" style={{ background: 'var(--elevated)', border: '1px solid var(--border-subtle)' }}>
                  <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center gap-2">
                      <Target size={14} style={{ color: '#60a5fa' }} />
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                        How to Win
                      </span>
                    </div>
                  </div>

                  {/* Strongest Points */}
                  <button onClick={() => toggleSection('strongest')} className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <span className="flex items-center gap-2 text-xs font-medium" style={{ color: '#4ade80' }}>
                      <CheckCircle2 size={12} /> Lead With ({debateAnalysis.how_to_win.strongest_points.length})
                    </span>
                    {expandedSections.strongest ? <ChevronDown size={12} style={{ color: 'var(--text-faint)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-faint)' }} />}
                  </button>
                  {expandedSections.strongest && debateAnalysis.how_to_win.strongest_points.length > 0 && (
                    <div className="px-4 py-2 space-y-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {debateAnalysis.how_to_win.strongest_points.map((pt, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <ArrowRight size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#4ade80' }} />
                          {pt}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Weakest Links */}
                  <button onClick={() => toggleSection('weakest')} className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <span className="flex items-center gap-2 text-xs font-medium" style={{ color: '#f87171' }}>
                      <XOctagon size={12} /> Opponent Will Attack ({debateAnalysis.how_to_win.weakest_links.length})
                    </span>
                    {expandedSections.weakest ? <ChevronDown size={12} style={{ color: 'var(--text-faint)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-faint)' }} />}
                  </button>
                  {expandedSections.weakest && debateAnalysis.how_to_win.weakest_links.length > 0 && (
                    <div className="px-4 py-2 space-y-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {debateAnalysis.how_to_win.weakest_links.map((pt, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <ArrowRight size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#f87171' }} />
                          {pt}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Missing Evidence */}
                  <button onClick={() => toggleSection('evidence')} className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <span className="flex items-center gap-2 text-xs font-medium" style={{ color: '#f59e0b' }}>
                      <Lightbulb size={12} /> Research These ({debateAnalysis.how_to_win.missing_evidence.length})
                    </span>
                    {expandedSections.evidence ? <ChevronDown size={12} style={{ color: 'var(--text-faint)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-faint)' }} />}
                  </button>
                  {expandedSections.evidence && debateAnalysis.how_to_win.missing_evidence.length > 0 && (
                    <div className="px-4 py-2 space-y-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {debateAnalysis.how_to_win.missing_evidence.map((pt, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <ArrowRight size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
                          {pt}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Rewrite Suggestions */}
                  <button onClick={() => toggleSection('rewrites')} className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <span className="flex items-center gap-2 text-xs font-medium" style={{ color: '#60a5fa' }}>
                      <Sparkles size={12} /> Rewrite Suggestions ({debateAnalysis.how_to_win.rewrite_suggestions.length})
                    </span>
                    {expandedSections.rewrites ? <ChevronDown size={12} style={{ color: 'var(--text-faint)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-faint)' }} />}
                  </button>
                  {expandedSections.rewrites && debateAnalysis.how_to_win.rewrite_suggestions.length > 0 && (
                    <div className="px-4 py-2 space-y-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {debateAnalysis.how_to_win.rewrite_suggestions.map((rw, i) => (
                        <div key={i} className="space-y-1">
                          <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(220, 38, 38, 0.08)', borderLeft: '2px solid #f87171', color: 'var(--text-muted)' }}>
                            <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#f87171' }}>Original: </span>
                            {rw.original}
                          </div>
                          <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(74, 222, 128, 0.08)', borderLeft: '2px solid #4ade80', color: 'var(--text-secondary)' }}>
                            <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#4ade80' }}>Improved: </span>
                            {rw.improved}
                          </div>
                          <p className="text-[10px] px-3 italic" style={{ color: 'var(--text-faint)' }}>{rw.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Opponent Counter-Predictions */}
                  <button onClick={() => toggleSection('attacks')} className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer">
                    <span className="flex items-center gap-2 text-xs font-medium" style={{ color: '#c084fc' }}>
                      <Swords size={12} /> Opponent Counters ({debateAnalysis.how_to_win.opponent_likely_attacks.length})
                    </span>
                    {expandedSections.attacks ? <ChevronDown size={12} style={{ color: 'var(--text-faint)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-faint)' }} />}
                  </button>
                  {expandedSections.attacks && debateAnalysis.how_to_win.opponent_likely_attacks.length > 0 && (
                    <div className="px-4 py-2 space-y-2">
                      {debateAnalysis.how_to_win.opponent_likely_attacks.map((atk, i) => (
                        <div key={i} className="space-y-1">
                          <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                            <Swords size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#c084fc' }} />
                            <span><b>Attack:</b> {atk.attack}</span>
                          </div>
                          <div className="flex items-start gap-2 text-xs ml-4" style={{ color: 'var(--text-secondary)' }}>
                            <Shield size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#4ade80' }} />
                            <span><b>Counter:</b> {atk.counter}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Analyze again button */}
                <button
                  onClick={() => { setDebateAnalysis(null); setAnalyzeText(''); setAnalyzeContext(''); }}
                  className="w-full py-2.5 rounded-xl text-xs font-medium transition-colors cursor-pointer"
                  style={{ background: 'var(--elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  Analyze Another Argument
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ====== LIVE MODE LEFT PANEL (Referee/Harvey) ====== */
          <>
            {/* Transcript stream */}
            <div className="flex-1 overflow-y-auto px-2.5 md:px-4 py-2 md:py-3 space-y-2">
              {!sessionActive && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div
                    className="flex items-center justify-center w-16 h-16 rounded-xl mb-4"
                    style={{
                      background: argMode === 'harvey' ? 'rgba(212, 166, 74, 0.1)' : 'rgba(204, 80, 64, 0.1)',
                    }}
                  >
                    {argMode === 'harvey'
                      ? <Swords size={40} style={{ color: 'var(--accent)' }} />
                      : <Scale size={40} style={{ color: 'var(--red)' }} />
                    }
                  </div>
                  <h2
                    className="text-xl font-semibold mb-2"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {argMode === 'harvey' ? 'Harvey Specter Mode' : 'Real-Time Debate Referee'}
                  </h2>
                  <p
                    className="max-w-md mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {argMode === 'harvey'
                      ? 'The best argumentative lawyer in NYC. Make your case — Harvey will poke holes through every weak argument, validate what\'s backed by evidence, and dismantle the rest.'
                      : 'Start recording and speak naturally. The referee will interrupt when it detects logical fallacies, bad-faith arguments, or factual errors.'}
                  </p>
                  <p className="text-sm max-w-sm" style={{ color: 'var(--text-faint)' }}>
                    {argMode === 'harvey'
                      ? 'Uses live research to find counter-evidence. Acknowledges strong points but never lets weak ones slide.'
                      : 'Monitors for 30+ fallacy types including straw man, ad hominem, red herring, false cause, slippery slope, and more.'}
                  </p>
                </div>
              )}

              {items.map((item) =>
                item.type === 'speech' ? (
                  <div
                    key={item.id}
                    className={`flex ${item.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className="max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                      style={{
                        background:
                          item.speaker === 'user'
                            ? 'var(--elevated)'
                            : argMode === 'harvey'
                              ? 'rgba(212, 166, 74, 0.1)'
                              : 'rgba(204, 80, 64, 0.1)',
                        color: 'var(--text-primary)',
                        borderBottomRightRadius: item.speaker === 'user' ? '4px' : undefined,
                        borderBottomLeftRadius: item.speaker === 'ai' ? '4px' : undefined,
                      }}
                    >
                      <div
                        className="text-[10px] font-medium uppercase tracking-wider mb-1"
                        style={{
                          color:
                            item.speaker === 'user'
                              ? 'var(--text-faint)'
                              : argMode === 'harvey' ? 'var(--accent)' : 'var(--red)',
                        }}
                      >
                        {item.speaker === 'user' ? 'You' : argMode === 'harvey' ? 'Harvey' : 'Referee'}
                      </div>
                      {item.text}
                    </div>
                  </div>
                ) : item.type === 'fallacy' && item.fallacy ? (
                  <div key={item.id} className="mx-auto max-w-[90%]">
                    <button
                      onClick={() => setSelectedFallacy(item.fallacy!)}
                      className="w-full text-left transition-transform hover:scale-[1.01]"
                    >
                      <div
                        className="rounded-xl px-4 py-3"
                        style={{
                          background: SEVERITY_COLORS[item.fallacy.severity]?.bg,
                          border: `1px solid ${SEVERITY_COLORS[item.fallacy.severity]?.border}`,
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <ShieldAlert
                            size={16}
                            style={{ color: SEVERITY_COLORS[item.fallacy.severity]?.border }}
                          />
                          <span
                            className="font-semibold text-sm"
                            style={{ color: SEVERITY_COLORS[item.fallacy.severity]?.text }}
                          >
                            {item.fallacy.name}
                          </span>
                          <span
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{
                              background: SEVERITY_COLORS[item.fallacy.severity]?.border,
                              color: 'var(--bg)',
                            }}
                          >
                            {item.fallacy.severity}
                          </span>
                          <span
                            className="text-[10px] ml-auto"
                            style={{ color: 'var(--text-faint)' }}
                          >
                            {CATEGORY_ICONS[item.fallacy.category] || ''}{' '}
                            {item.fallacy.category}
                          </span>
                        </div>
                        <p
                          className="text-xs leading-relaxed"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          &ldquo;{item.fallacy.what_was_said}&rdquo;
                        </p>
                      </div>
                    </button>
                  </div>
                ) : item.type === 'technique' && item.technique ? (
                  <div key={item.id} className="mx-auto max-w-[90%]">
                    <div
                      className="rounded-xl px-4 py-3"
                      style={{
                        background: TECHNIQUE_COLORS[item.technique.quality]?.bg,
                        border: `1px solid ${TECHNIQUE_COLORS[item.technique.quality]?.border}`,
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Sparkles
                          size={14}
                          style={{ color: TECHNIQUE_COLORS[item.technique.quality]?.border }}
                        />
                        <span
                          className="font-semibold text-sm"
                          style={{ color: TECHNIQUE_COLORS[item.technique.quality]?.text }}
                        >
                          {item.technique.name}
                        </span>
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{
                            background: TECHNIQUE_COLORS[item.technique.quality]?.border,
                            color: 'var(--bg)',
                          }}
                        >
                          {item.technique.quality}
                        </span>
                      </div>
                      <p
                        className="text-xs leading-relaxed"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {item.technique.feedback}
                      </p>
                    </div>
                  </div>
                ) : null
              )}

              {interimText && isRecording && (
                <div className="flex justify-end">
                  <div
                    className="max-w-[75%] px-4 py-2.5 rounded-2xl text-sm italic"
                    style={{
                      background: 'var(--elevated)',
                      color: 'var(--text-faint)',
                      borderBottomRightRadius: '4px',
                    }}
                  >
                    {interimText}...
                  </div>
                </div>
              )}

              <div ref={transcriptEndRef} />
            </div>

            {/* Controls */}
            <div
              className="flex flex-col items-center gap-2 md:gap-3 px-3 md:px-6 py-3 md:py-4"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              {/* Fact-check toast */}
              {factChecks.length > 0 && !factChecks[0].read && (
                <div
                  className="w-full flex items-start gap-2 p-3 rounded-lg text-sm cursor-pointer"
                  style={{
                    background: factChecks[0].status === 'incorrect' ? 'var(--red-muted)' : 'var(--amber-muted)',
                    border: `1px solid ${factChecks[0].status === 'incorrect' ? 'rgba(204, 80, 64, 0.3)' : 'rgba(212, 166, 74, 0.3)'}`,
                  }}
                  onClick={() => {
                    setShowFactPanel(!showFactPanel);
                    setUnreadFcCount(0);
                    setFactChecks((prev) => prev.map((fc) => ({ ...fc, read: true })));
                  }}
                >
                  {factChecks[0].status === 'incorrect' ? (
                    <XCircle size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--red)' }} />
                  ) : (
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--amber)' }} />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium" style={{
                      color: factChecks[0].status === 'incorrect' ? 'var(--red)' : 'var(--amber)',
                    }}>
                      {factChecks[0].status === 'incorrect' ? 'Factual Error' : 'Unverified Claim'}
                    </p>
                    <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                      {factChecks[0].correction || factChecks[0].claim}
                    </p>
                  </div>
                </div>
              )}

              {/* Fact-check badge */}
              {factChecks.length > 0 && (
                <button
                  onClick={() => {
                    setShowFactPanel(!showFactPanel);
                    setUnreadFcCount(0);
                    setFactChecks((prev) => prev.map((fc) => ({ ...fc, read: true })));
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  style={{
                    background: unreadFcCount > 0 ? 'var(--red-muted)' : 'var(--surface)',
                    border: `1px solid ${unreadFcCount > 0 ? 'rgba(204, 80, 64, 0.3)' : 'var(--border-subtle)'}`,
                    color: unreadFcCount > 0 ? 'var(--red)' : 'var(--text-muted)',
                  }}
                >
                  <AlertTriangle size={12} />
                  {factChecks.length} fact check{factChecks.length !== 1 ? 's' : ''}
                  {unreadFcCount > 0 && (
                    <span className="ml-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{ background: 'var(--red)', color: 'var(--cream)' }}>
                      {unreadFcCount}
                    </span>
                  )}
                </button>
              )}

              <div className="flex items-center gap-4">
              {speechError && (
                <div
                  className="text-xs px-3 py-1 rounded-full mr-2"
                  style={{ background: 'rgba(220, 38, 38, 0.15)', color: '#fca5a5' }}
                >
                  <AlertTriangle size={12} className="inline mr-1" />
                  {speechError}
                </div>
              )}

              <button
                onClick={handleToggleRecording}
                className="relative flex items-center justify-center w-16 h-16 rounded-full transition-all"
                style={{
                  background: isRecording ? '#dc2626' : argMode === 'harvey' ? 'var(--accent)' : 'var(--red)',
                  color: argMode === 'harvey' && !isRecording ? 'var(--bg)' : 'var(--cream)',
                  boxShadow: isRecording
                    ? '0 0 0 4px rgba(220, 38, 38, 0.3), 0 0 20px rgba(220, 38, 38, 0.2)'
                    : argMode === 'harvey'
                      ? '0 0 0 4px rgba(212, 166, 74, 0.2), 0 4px 12px rgba(0,0,0,0.3)'
                      : '0 4px 12px rgba(0,0,0,0.3)',
                }}
              >
                {isRecording ? <MicOff size={24} /> : <Mic size={24} />}
                {isRecording && (
                  <span
                    className="absolute inset-0 rounded-full animate-ping"
                    style={{ background: 'rgba(220, 38, 38, 0.3)' }}
                  />
                )}
              </button>

              {sessionActive && (
                <div className="flex items-center gap-2 mt-2">
                  {isRecording && (
                    <button
                      onClick={handlePauseResume}
                      className="p-2.5 rounded-lg transition-colors cursor-pointer"
                      style={{
                        background: isPaused ? 'rgba(212, 166, 74, 0.15)' : 'var(--surface)',
                        border: `1px solid ${isPaused ? 'rgba(212, 166, 74, 0.3)' : 'var(--border-subtle)'}`,
                        color: isPaused ? 'var(--amber)' : 'var(--text-muted)',
                      }}
                      title={isPaused ? 'Resume' : 'Pause'}
                    >
                      {isPaused ? <Mic size={16} /> : <Pause size={16} />}
                    </button>
                  )}
                  <button
                    onClick={handleVoiceToggle}
                    className="p-2.5 rounded-lg transition-colors cursor-pointer"
                    style={{
                      background: voiceEnabled ? 'transparent' : 'rgba(204, 80, 64, 0.15)',
                      border: `1px solid ${voiceEnabled ? 'var(--border-subtle)' : 'rgba(204, 80, 64, 0.3)'}`,
                      color: voiceEnabled ? 'var(--text-muted)' : 'var(--red)',
                    }}
                    title={voiceEnabled ? 'Mute AI voice' : 'Unmute AI voice'}
                  >
                    {voiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </button>
                </div>
              )}
              <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {aiStatus === 'listening' && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    Monitoring
                  </span>
                )}
                {aiStatus === 'analyzing' && 'Checking...'}
                {aiStatus === 'speaking' && (
                  <span className="flex items-center gap-1">
                    <Volume2 size={12} /> Referee speaking
                  </span>
                )}
                {aiStatus === 'idle' && sessionActive && (isPaused ? 'Paused' : 'Ready')}
              </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ==================== RIGHT PANEL: 5-Tab System ==================== */}
      {/* Mobile: bottom sheet overlay. Desktop: fixed sidebar. */}
      {(isMobile ? showPanel : true) && (
      <div
        className={
          isMobile
            ? 'fixed inset-0 z-40 flex flex-col'
            : 'w-80 flex-shrink-0 flex flex-col'
        }
        style={
          isMobile
            ? { background: 'var(--base)' }
            : { borderLeft: '1px solid var(--border-subtle)', background: 'var(--surface)' }
        }
      >
        {/* Mobile: drag handle + close */}
        {isMobile && (
          <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Analysis Panel
            </span>
            <button onClick={() => setShowPanel(false)} className="p-1.5 rounded-lg cursor-pointer"
              style={{ color: 'var(--text-faint)' }}>
              <X size={16} />
            </button>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex overflow-x-auto" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
          {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setScoreTab(id)}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
              style={{
                color: scoreTab === id
                  ? id === 'plot' ? 'var(--blue)' : argMode === 'harvey' ? 'var(--accent)' : argMode === 'analyze' ? '#60a5fa' : 'var(--red)'
                  : 'var(--text-faint)',
                borderBottom: scoreTab === id
                  ? `2px solid ${id === 'plot' ? 'var(--blue)' : argMode === 'harvey' ? 'var(--accent)' : argMode === 'analyze' ? '#60a5fa' : 'var(--red)'}`
                  : '2px solid transparent',
              }}
            >
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>

        {/* ====== MAP TAB ====== */}
        {scoreTab === 'plot' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {mermaidCode ? (
              <>
                <div className="flex items-center justify-between px-3 py-2"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {argMode === 'harvey' ? 'Cross-Examination Map' : argMode === 'analyze' ? 'Argument Structure' : 'Debate Map'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setZoom((z) => Math.min(z + 0.2, 3))} className="p-1 rounded cursor-pointer"
                      style={{ color: 'var(--text-muted)' }}><ZoomIn size={13} /></button>
                    <button onClick={() => setZoom((z) => Math.max(z - 0.2, 0.3))} className="p-1 rounded cursor-pointer"
                      style={{ color: 'var(--text-muted)' }}><ZoomOut size={13} /></button>
                    <button onClick={() => setZoom(1)} className="p-1 rounded cursor-pointer"
                      style={{ color: 'var(--text-muted)' }}><RotateCcw size={13} /></button>
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
                  {argMode === 'analyze'
                    ? 'Analyze an argument to see its structure mapped.'
                    : argMode === 'harvey'
                      ? 'Start debating to see your argument mapped against Harvey\'s attacks.'
                      : 'Debate map builds as arguments are made. Start speaking to see claims and fallacies visualized.'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ====== SCORE TAB ====== */}
        {scoreTab === 'score' && (
        <div className="flex-1 overflow-y-auto">
        {/* Scoreboard header */}
        <div
          className="px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={16} style={{ color: argMode === 'harvey' ? 'var(--accent)' : argMode === 'analyze' ? '#60a5fa' : 'var(--red)' }} />
            <h2
              className="text-sm font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-primary)' }}
            >
              {argMode === 'analyze' && debateAnalysis ? 'Analysis Score' : argMode === 'harvey' ? 'Your Argument Strength' : 'Scoreboard'}
            </h2>
          </div>

          {/* Debate Health — or analysis grade */}
          {argMode === 'analyze' && debateAnalysis ? (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Overall Grade
                </span>
                <span className="text-2xl font-bold" style={{ color: gradeColor(debateAnalysis.overall_grade) }}>
                  {debateAnalysis.overall_grade}
                </span>
              </div>
              <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'var(--elevated)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${debateAnalysis.overall_score}%`, background: gradeColor(debateAnalysis.overall_grade) }} />
              </div>
              <div className="text-[10px] mt-1 text-right" style={{ color: 'var(--text-faint)' }}>
                {debateAnalysis.overall_score}/100
              </div>
            </div>
          ) : (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Debate Health</span>
                <span className="text-2xl font-bold" style={{ color: healthColor }}>{scoreboard.grade}</span>
              </div>
              <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'var(--elevated)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${scoreboard.health}%`, background: healthColor }} />
              </div>
              <div className="text-[10px] mt-1 text-right" style={{ color: 'var(--text-faint)' }}>
                {scoreboard.health}/100
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg px-2 py-2 text-center" style={{ background: 'var(--elevated)' }}>
              <div className="text-lg font-bold" style={{ color: scoreboard.fallacyTotal > 0 ? '#f87171' : '#4ade80' }}>
                {argMode === 'analyze' && debateAnalysis ? debateAnalysis.fallacies.length : scoreboard.fallacyTotal}
              </div>
              <div className="text-[9px]" style={{ color: 'var(--text-faint)' }}>Fallacies</div>
            </div>
            <div className="rounded-lg px-2 py-2 text-center" style={{ background: 'var(--elevated)' }}>
              <div className="text-lg font-bold" style={{ color: '#4ade80' }}>
                {argMode === 'analyze' && debateAnalysis ? debateAnalysis.techniques_used.filter(t => t.quality === 'effective').length : scoreboard.techniqueTotal}
              </div>
              <div className="text-[9px]" style={{ color: 'var(--text-faint)' }}>Techniques</div>
            </div>
            <div className="rounded-lg px-2 py-2 text-center" style={{ background: 'var(--elevated)' }}>
              <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {argMode === 'analyze' && debateAnalysis ? debateAnalysis.argument_structure.contentions.length : Object.keys(scoreboard.byType).length}
              </div>
              <div className="text-[9px]" style={{ color: 'var(--text-faint)' }}>
                {argMode === 'analyze' ? 'Contentions' : 'Types'}
              </div>
            </div>
          </div>
        </div>

        {/* By Category (live mode) */}
        {isLiveMode && (
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} style={{ color: 'var(--text-muted)' }} />
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              By Category
            </h3>
          </div>

          {Object.keys(scoreboard.byCategory).length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              No fallacies detected yet. Clean debate!
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(scoreboard.byCategory)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, count]) => (
                  <div key={cat}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {CATEGORY_ICONS[cat] || ''} {cat}
                      </span>
                      <span style={{ color: 'var(--text-primary)' }}>{count}</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--elevated)' }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${Math.min((count / Math.max(scoreboard.fallacyTotal, 1)) * 100, 100)}%`, background: 'var(--red)' }} />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
        )}

        {/* Recent fallacies timeline */}
        <div className="px-5 py-4 flex-1">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert size={14} style={{ color: 'var(--text-muted)' }} />
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              {argMode === 'analyze' ? 'Detected Fallacies' : 'Recent Calls'}
            </h3>
          </div>

          {((argMode === 'analyze' && debateAnalysis) ? debateAnalysis.fallacies : fallacies).length === 0 ? (
            <div className="text-center py-8">
              <Shield size={32} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {argMode === 'analyze' ? 'No fallacies found' : 'Debate is clean so far'}
              </p>
            </div>
          ) : argMode === 'analyze' && debateAnalysis ? (
            <div className="space-y-2">
              {debateAnalysis.fallacies.map((f, i) => (
                <div key={i} className="rounded-lg px-3 py-2" style={{ background: SEVERITY_COLORS[f.severity]?.bg, border: `1px solid ${SEVERITY_COLORS[f.severity]?.border}` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldAlert size={12} style={{ color: SEVERITY_COLORS[f.severity]?.border }} />
                    <span className="text-xs font-medium" style={{ color: SEVERITY_COLORS[f.severity]?.text }}>{f.name}</span>
                    <span className="text-[9px] uppercase px-1 py-0.5 rounded" style={{ background: SEVERITY_COLORS[f.severity]?.border, color: 'var(--bg)' }}>{f.severity}</span>
                  </div>
                  <p className="text-[11px] italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{f.what_was_said}&rdquo;</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {[...fallacies].reverse().slice(0, 10).map((f) => (
                <button key={f.id} onClick={() => setSelectedFallacy(f)}
                  className="w-full text-left rounded-lg px-3 py-2 transition-colors" style={{ background: 'var(--elevated)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--border-subtle)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--elevated)')}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SEVERITY_COLORS[f.severity]?.border || '#6b7280' }} />
                    <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                    <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                      {new Date(f.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
        )}

        {/* ====== STRUCT TAB ====== */}
        {scoreTab === 'structure' && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2 mb-3">
                <GitBranch size={14} style={{ color: 'var(--text-muted)' }} />
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Argument Structure
                </h3>
              </div>

              {debateAnalysis?.argument_structure ? (
                <div className="space-y-3">
                  {/* Thesis */}
                  <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--elevated)', borderLeft: '3px solid #60a5fa' }}>
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#60a5fa' }}>Thesis</span>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-primary)' }}>
                      {debateAnalysis.argument_structure.thesis}
                    </p>
                  </div>

                  {/* Contentions */}
                  {debateAnalysis.argument_structure.contentions.map((c) => (
                    <div key={c.id} className="rounded-lg px-3 py-2.5"
                      style={{
                        background: STRENGTH_COLORS[c.strength]?.bg || 'var(--elevated)',
                        borderLeft: `3px solid ${STRENGTH_COLORS[c.strength]?.border || 'var(--border-subtle)'}`,
                      }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: STRENGTH_COLORS[c.strength]?.border }}>{STRENGTH_COLORS[c.strength]?.label}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded"
                          style={{ background: `${EVIDENCE_COLORS[c.evidence_quality]}20`, color: EVIDENCE_COLORS[c.evidence_quality] }}>
                          Evidence: {c.evidence_quality}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{c.text}</p>
                      {c.evidence_cited && (
                        <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                          <b>Cited:</b> {c.evidence_cited}
                        </p>
                      )}
                      {c.evidence_needed && (
                        <p className="text-[10px] mt-0.5 italic" style={{ color: '#f59e0b' }}>
                          <b>Needs:</b> {c.evidence_needed}
                        </p>
                      )}
                      {c.logical_connection && (
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                          {c.logical_connection}
                        </p>
                      )}
                    </div>
                  ))}

                  {/* Missing rebuttals */}
                  {(debateAnalysis.argument_structure.rebuttals_missing?.length ?? 0) > 0 && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#f87171' }}>Missing Rebuttals</span>
                      <div className="space-y-1 mt-1">
                        {debateAnalysis.argument_structure.rebuttals_missing!.map((r, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs rounded-lg px-2.5 py-1.5"
                            style={{ background: 'rgba(220, 38, 38, 0.08)', color: 'var(--text-muted)' }}>
                            <XOctagon size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#f87171' }} />
                            {r}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Addressed rebuttals */}
                  {(debateAnalysis.argument_structure.rebuttals_addressed?.length ?? 0) > 0 && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#4ade80' }}>Addressed</span>
                      <div className="space-y-1 mt-1">
                        {debateAnalysis.argument_structure.rebuttals_addressed!.map((r, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs rounded-lg px-2.5 py-1.5"
                            style={{ background: 'rgba(74, 222, 128, 0.08)', color: 'var(--text-muted)' }}>
                            <CheckCircle2 size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#4ade80' }} />
                            {r}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <GitBranch size={32} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {argMode === 'analyze'
                      ? 'Paste and analyze an argument to see its structure.'
                      : 'Structure analysis appears after analyzing an argument.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ====== TECH TAB ====== */}
        {scoreTab === 'techniques' && (
          <div className="flex-1 overflow-y-auto">
            {/* Techniques Used */}
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={14} style={{ color: '#4ade80' }} />
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Techniques Used
                </h3>
              </div>

              {((argMode === 'analyze' && debateAnalysis) ? debateAnalysis.techniques_used : techniques.map(t => ({ name: t.name, quality: t.quality, where: '', feedback: t.feedback }))).length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {argMode === 'analyze' ? 'No techniques detected.' : 'Techniques will appear as you argue.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {(argMode === 'analyze' && debateAnalysis ? debateAnalysis.techniques_used : techniques.map(t => ({ name: t.name, quality: t.quality, where: '', feedback: t.feedback }))).map((t, i) => (
                    <div key={i} className="rounded-lg px-3 py-2"
                      style={{
                        background: TECHNIQUE_COLORS[t.quality]?.bg,
                        border: `1px solid ${TECHNIQUE_COLORS[t.quality]?.border}`,
                      }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium" style={{ color: TECHNIQUE_COLORS[t.quality]?.text }}>
                          {t.name}
                        </span>
                        <span className="text-[9px] uppercase px-1 py-0.5 rounded"
                          style={{ background: TECHNIQUE_COLORS[t.quality]?.border, color: 'var(--bg)' }}>
                          {t.quality}
                        </span>
                      </div>
                      {t.where && (
                        <p className="text-[10px] italic mb-1" style={{ color: 'var(--text-muted)' }}>
                          &ldquo;{t.where}&rdquo;
                        </p>
                      )}
                      <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t.feedback}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Techniques Missing (analyze mode) */}
            {debateAnalysis && debateAnalysis.techniques_missing.length > 0 && (
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb size={14} style={{ color: '#f59e0b' }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Techniques to Add
                  </h3>
                </div>
                <div className="space-y-2">
                  {debateAnalysis.techniques_missing.map((t, i) => (
                    <div key={i} className="rounded-lg px-3 py-2.5" style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                      <span className="text-xs font-medium" style={{ color: '#fde68a' }}>{t.name}</span>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>{t.why_needed}</p>
                      <p className="text-[10px] mt-1.5 italic px-2 py-1.5 rounded" style={{ background: 'rgba(245, 158, 11, 0.05)', color: 'var(--text-muted)', borderLeft: '2px solid #f59e0b' }}>
                        Example: {t.example}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====== COACH TAB ====== */}
        {scoreTab === 'coach' && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <GraduationCap size={14} style={{ color: argMode === 'analyze' ? '#60a5fa' : 'var(--text-muted)' }} />
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Debate Coaching
                </h3>
              </div>

              {debateAnalysis ? (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--elevated)' }}>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {debateAnalysis.summary}
                    </p>
                  </div>

                  {/* Rewrite suggestions */}
                  {debateAnalysis.how_to_win.rewrite_suggestions.length > 0 && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#60a5fa' }}>
                        Rewrite Suggestions
                      </span>
                      <div className="space-y-2.5 mt-2">
                        {debateAnalysis.how_to_win.rewrite_suggestions.map((rw, i) => (
                          <div key={i} className="space-y-1">
                            <div className="text-[11px] px-2.5 py-1.5 rounded" style={{ background: 'rgba(220, 38, 38, 0.06)', borderLeft: '2px solid #f87171', color: 'var(--text-muted)' }}>
                              {rw.original}
                            </div>
                            <div className="text-[11px] px-2.5 py-1.5 rounded" style={{ background: 'rgba(74, 222, 128, 0.06)', borderLeft: '2px solid #4ade80', color: 'var(--text-secondary)' }}>
                              {rw.improved}
                            </div>
                            <p className="text-[9px] px-2.5" style={{ color: 'var(--text-faint)' }}>{rw.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Opponent attacks & counters */}
                  {debateAnalysis.how_to_win.opponent_likely_attacks.length > 0 && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#c084fc' }}>
                        Opponent Attacks & Your Counters
                      </span>
                      <div className="space-y-2 mt-2">
                        {debateAnalysis.how_to_win.opponent_likely_attacks.map((atk, i) => (
                          <div key={i} className="rounded-lg px-3 py-2" style={{ background: 'var(--elevated)' }}>
                            <div className="flex items-start gap-2 text-[11px] mb-1.5" style={{ color: 'var(--text-muted)' }}>
                              <Swords size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#c084fc' }} />
                              {atk.attack}
                            </div>
                            <div className="flex items-start gap-2 text-[11px] ml-3" style={{ color: 'var(--text-secondary)' }}>
                              <Shield size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#4ade80' }} />
                              {atk.counter}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <GraduationCap size={32} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {argMode === 'analyze'
                      ? 'Analyze an argument to get coaching tips.'
                      : 'Switch to Analyze mode and paste an argument for detailed coaching.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Mobile: floating panel toggle button */}
      {isMobile && !showPanel && (
        <button
          onClick={() => setShowPanel(true)}
          className="fixed bottom-6 right-4 z-30 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all cursor-pointer"
          style={{
            background: argMode === 'harvey' ? 'var(--accent)' : argMode === 'analyze' ? '#60a5fa' : 'var(--red)',
            color: argMode === 'harvey' ? 'var(--bg)' : '#0c0b09',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
        >
          <Activity size={16} />
          <span className="text-xs font-bold uppercase tracking-wider">Panel</span>
        </button>
      )}

      {/* ==================== SESSION HISTORY OVERLAY ==================== */}
      {showHistory && (
        <div className="absolute inset-0 z-30" style={{ background: 'var(--surface)' }}>
          <SessionHistory
            tool="argument_ref"
            onSelectSession={(detail: SessionDetail) => {
              setShowHistory(false);
            }}
            onClose={() => setShowHistory(false)}
          />
        </div>
      )}

      {/* ==================== FALLACY DETAIL MODAL ==================== */}
      {selectedFallacy && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setSelectedFallacy(null)}
        >
          <div
            className="rounded-2xl p-6 max-w-lg w-full mx-4"
            style={{ background: 'var(--surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex items-center justify-center w-10 h-10 rounded-xl"
                  style={{
                    background: SEVERITY_COLORS[selectedFallacy.severity]?.bg,
                  }}
                >
                  <ShieldAlert
                    size={20}
                    style={{
                      color: SEVERITY_COLORS[selectedFallacy.severity]?.border,
                    }}
                  />
                </div>
                <div>
                  <h3
                    className="font-semibold text-lg"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {selectedFallacy.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{
                        background:
                          SEVERITY_COLORS[selectedFallacy.severity]?.border,
                        color: 'var(--bg)',
                      }}
                    >
                      {selectedFallacy.severity} severity
                    </span>
                    <span
                      className="text-[10px]"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      {selectedFallacy.category}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedFallacy(null)}
                className="p-1 rounded-lg transition-colors"
                style={{ color: 'var(--text-faint)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* What was said */}
            <div className="mb-4">
              <h4
                className="text-xs font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-faint)' }}
              >
                What was said
              </h4>
              <div
                className="rounded-lg px-4 py-3 text-sm italic"
                style={{
                  background: SEVERITY_COLORS[selectedFallacy.severity]?.bg,
                  borderLeft: `3px solid ${SEVERITY_COLORS[selectedFallacy.severity]?.border}`,
                  color: 'var(--text-secondary)',
                }}
              >
                &ldquo;{selectedFallacy.what_was_said}&rdquo;
              </div>
            </div>

            {/* Why it's wrong */}
            <div className="mb-4">
              <h4
                className="text-xs font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-faint)' }}
              >
                Why this is a fallacy
              </h4>
              <p
                className="text-sm leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                {selectedFallacy.why_its_wrong}
              </p>
            </div>

            {/* Correct form */}
            <div>
              <h4
                className="text-xs font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-faint)' }}
              >
                Correct form of the argument
              </h4>
              <div
                className="rounded-lg px-4 py-3 text-sm"
                style={{
                  background: 'rgba(74, 222, 128, 0.1)',
                  borderLeft: '3px solid #4ade80',
                  color: 'var(--text-secondary)',
                }}
              >
                {selectedFallacy.correct_form}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fact-check detail panel (slides in from right) */}
      {showFactPanel && (
        <div className="fixed right-0 top-0 bottom-0 w-80 z-40 flex flex-col"
          style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border-subtle)', boxShadow: '-4px 0 20px rgba(0,0,0,0.3)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Fact Checks</span>
            <button onClick={() => setShowFactPanel(false)} className="p-1 rounded transition-colors cursor-pointer" style={{ color: 'var(--text-faint)' }}><X size={14} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {factChecks.length === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>No fact checks yet.</p>
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
                      <p className="text-xs font-medium" style={{ color: fc.status === 'incorrect' ? 'var(--red)' : 'var(--amber)' }}>
                        {fc.status === 'incorrect' ? 'Incorrect' : 'Unverified'}
                        <span className="ml-2 opacity-60">{Math.round(fc.confidence * 100)}%</span>
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>&ldquo;{fc.claim}&rdquo;</p>
                      {fc.correction && <p className="text-xs mt-1.5 font-medium" style={{ color: 'var(--text-primary)' }}>{fc.correction}</p>}
                      {fc.explanation && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>{fc.explanation}</p>}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
