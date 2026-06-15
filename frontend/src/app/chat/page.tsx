'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_BASE } from '@/lib/api';
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Square,
  MessageSquare,
  X,
  Network,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  Wrench,
  BookOpen,
  Scale,
  Cpu,
  Map,
} from 'lucide-react';
import { useSpeechRecognition } from '@/lib/useSpeechRecognition';
import { useAudioPlayback } from '@/lib/useAudioPlayback';
import { useIsMobile } from '@/lib/useIsMobile';
import type {
  FallacyCall,
  TechniqueDetection,
  FactCheckNotification,
  StackTool,
  Contention,
} from '@/lib/types';

type AIStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

// Inline items in the chat — union of speech messages and specialized cards
interface ChatItem {
  id: string;
  type: 'speech' | 'fallacy' | 'technique' | 'fact_check' | 'system' | 'arch_update' | 'contention';
  speaker?: 'user' | 'ai';
  text?: string;
  fallacy?: FallacyCall;
  technique?: TechniqueDetection;
  factCheck?: FactCheckNotification;
  archStack?: StackTool[];
  archChangelog?: string;
  contentions?: Contention[];
  timestamp: number;
}

const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  high: { bg: 'rgba(220, 38, 38, 0.15)', border: '#dc2626', text: '#fca5a5' },
  medium: { bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b', text: '#fde68a' },
  low: { bg: 'rgba(107, 114, 128, 0.15)', border: '#6b7280', text: '#d1d5db' },
};

const TECHNIQUE_COLORS: Record<string, { bg: string; border: string }> = {
  effective: { bg: 'rgba(74, 222, 128, 0.15)', border: '#4ade80' },
  weak: { bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b' },
  misapplied: { bg: 'rgba(220, 38, 38, 0.15)', border: '#dc2626' },
};

const TOOL_LABELS: Record<string, string> = {
  study_buddy: 'Study Buddy',
  thought_plot: 'Thought Plot',
  architect: 'Architect',
  argument_ref: 'Argument Ref',
};

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  study_buddy: BookOpen,
  thought_plot: Map,
  architect: Cpu,
  argument_ref: Scale,
};

const TOOL_COLORS: Record<string, string> = {
  study_buddy: '#60a5fa',
  thought_plot: '#c084fc',
  architect: '#4ade80',
  argument_ref: '#f87171',
};

export default function ChatPage() {
  const isMobile = useIsMobile();

  // Chat state
  const [items, setItems] = useState<ChatItem[]>([]);
  const [textInput, setTextInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIStatus>('idle');
  const [interimText, setInterimText] = useState('');
  const [sessionActive, setSessionActive] = useState(false);

  // Active tool routing
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState('general');
  const activeModeRef = useRef(activeMode);
  activeModeRef.current = activeMode;

  // Diagram panel (desktop)
  const [mermaidCode, setMermaidCode] = useState('');
  const [showDiagram, setShowDiagram] = useState(false);
  const [zoom, setZoom] = useState(1);
  const mermaidContainerRef = useRef<HTMLDivElement>(null);
  const mermaidInitRef = useRef(false);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const aiSpeakingRef = useRef(false);
  aiSpeakingRef.current = aiStatus === 'speaking';

  const { playPcmAudio, stopAudio } = useAudioPlayback();
  const ttsRecoveryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTtsTextRef = useRef('');

  // Voice toggle
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

  // Render mermaid
  useEffect(() => {
    if (!mermaidCode) return;
    import('mermaid').then(async (m) => {
      try {
        const id = `mermaid-chat-${Date.now()}`;
        const { svg } = await m.default.render(id, mermaidCode);
        if (mermaidContainerRef.current) {
          mermaidContainerRef.current.innerHTML = svg;
        }
      } catch { /* diagram parse error */ }
    });
  }, [mermaidCode, showDiagram]);

  const addItem = useCallback(
    (type: ChatItem['type'], data: Partial<ChatItem>) => {
      setItems((prev) => [
        ...prev,
        { id: crypto.randomUUID(), type, timestamp: Date.now(), ...data },
      ]);
    },
    []
  );

  // Shared TTS completion handler
  const onTtsDone = useCallback(() => {
    if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }
    if (isRecordingRef.current) startListeningRef.current();
    setAiStatus(isRecordingRef.current ? 'listening' : 'idle');
  }, []);

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(`${WS_BASE}/ws/study-session`);

    ws.onopen = () => console.log('Chat WebSocket connected');

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // --- AI Response (all modes) ---
        if (data.type === 'ai_response') {
          // Stop any currently playing audio — new response preempts old
          stopAudio();
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }

          setAiStatus('speaking');
          addItem('speech', { speaker: 'ai', text: data.text });

          pendingTtsTextRef.current = data.text || '';

          if (data.should_speak && data.audio_data && voiceEnabledRef.current) {
            stopListeningRef.current();
            pendingTtsTextRef.current = '';
            playPcmAudio(data.audio_data, data.audio_sample_rate || 24000, onTtsDone);
          } else if (data.should_speak && voiceEnabledRef.current) {
            stopListeningRef.current();
            ttsRecoveryRef.current = setTimeout(() => {
              pendingTtsTextRef.current = '';
              onTtsDone();
            }, 15000);
          } else {
            setTimeout(onTtsDone, 300);
          }
        }
        // --- Streaming TTS audio ---
        else if (data.type === 'ai_audio') {
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }
          pendingTtsTextRef.current = '';
          if (!voiceEnabledRef.current) return;
          stopListeningRef.current();
          playPcmAudio(data.audio_data, data.audio_sample_rate || 24000, onTtsDone);
        }
        // --- TTS failed — just resume, text is already displayed ---
        else if (data.type === 'tts_failed') {
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }
          pendingTtsTextRef.current = '';
          onTtsDone();
        }
        // --- Tool activated (routing) ---
        else if (data.type === 'tool_activated') {
          setActiveTool(data.tool);
          setActiveMode(data.mode || 'general');
          addItem('system', {
            text: `Switched to ${TOOL_LABELS[data.tool] || data.tool}${data.mode && data.mode !== 'general' && data.mode !== 'default' ? ` (${data.mode})` : ''} — ${data.reason}`,
          });
        }
        // --- Tool deactivated ---
        else if (data.type === 'tool_deactivated') {
          setActiveTool(null);
          setActiveMode('general');
          addItem('system', { text: 'Back to general chat' });
        }
        // --- Fallacy detection (argument_ref) ---
        else if (data.type === 'fallacy_call') {
          addItem('fallacy', { fallacy: data.fallacy });
        }
        // --- Technique detection (argument_ref) ---
        else if (data.type === 'technique_detected') {
          addItem('technique', { technique: data.technique });
        }
        // --- Fact check (study modes) ---
        else if (data.type === 'fact_check') {
          const notification: FactCheckNotification = { ...data, timestamp: Date.now(), read: false };
          addItem('fact_check', { factCheck: notification });
        }
        // --- Contention update (argument_ref) ---
        else if (data.type === 'contention_update') {
          if (data.contentions?.length) {
            addItem('contention', { contentions: data.contentions });
          }
        }
        // --- Architecture state update ---
        else if (data.type === 'architecture_state') {
          const panel = data.panel;
          if (panel) {
            addItem('arch_update', {
              archStack: panel.stack,
              archChangelog: panel.changelog_entry,
            });
          }
        }
        // --- Debate analysis ---
        else if (data.type === 'debate_analysis') {
          const a = data.analysis;
          if (a) {
            addItem('system', {
              text: `Debate Analysis: Grade ${a.overall_grade} (${a.overall_score}/100) — ${a.summary}`,
            });
          }
        }
        // --- Plot update ---
        else if (data.type === 'plot_update' && data.graph?.mermaid_code) {
          setMermaidCode(data.graph.mermaid_code);
          if (!isMobile) setShowDiagram(true);
        }
        // --- Tool suggestion (old style, still supported) ---
        else if (data.type === 'tool_suggestion') {
          // Ignore — backend now auto-routes
        }
      } catch { /* invalid message */ }
    };

    ws.onclose = () => console.log('Chat WebSocket disconnected');
    ws.onerror = () => console.log('Chat WebSocket error');
    wsRef.current = ws;
  }, [addItem, playPcmAudio, onTtsDone, isMobile]);

  // Send message
  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    if (!sessionActive) {
      setSessionActive(true);
      connectWebSocket();
    }

    addItem('speech', { speaker: 'user', text });
    setAiStatus('thinking');

    const send = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'transcript',
          text,
          mode: activeModeRef.current,
          tool: 'general_chat',
        }));
      } else {
        setTimeout(send, 200);
      }
    };
    send();
  }, [sessionActive, addItem, connectWebSocket]);

  // Deactivate active tool
  const handleDeactivateTool = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'transcript',
        text: 'switch back to general chat',
        mode: 'general',
        tool: 'general_chat',
      }));
    }
  }, []);

  // Speech
  const handleSpeechResult = useCallback((finalText: string) => {
    stopAudio();
    sendMessage(finalText);
  }, [sendMessage, stopAudio]);

  const handleInterim = useCallback((text: string) => {
    setInterimText(text);
    // Send interim to backend for quiz interruptions
    if (wsRef.current?.readyState === WebSocket.OPEN && text.trim()) {
      wsRef.current.send(JSON.stringify({
        type: 'interim',
        text,
        mode: activeModeRef.current,
        tool: 'general_chat',
      }));
    }
  }, []);

  const { start: startListening, stop: stopListening, error: speechError, retryCount } = useSpeechRecognition({
    onResult: handleSpeechResult,
    onInterim: handleInterim,
    aiSpeakingRef,
  });

  const startListeningRef = useRef(startListening);
  startListeningRef.current = startListening;
  const stopListeningRef = useRef(stopListening);
  stopListeningRef.current = stopListening;

  function handleToggleMic() {
    if (isRecording) {
      setIsRecording(false);
      setAiStatus('idle');
      setInterimText('');
      stopListening();
    } else {
      if (!sessionActive) {
        setSessionActive(true);
        connectWebSocket();
      }
      setIsRecording(true);
      setAiStatus('listening');
      startListening();
    }
  }

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim()) return;
    sendMessage(textInput.trim());
    setTextInput('');
  }

  function handleEndSession() {
    setSessionActive(false);
    setIsRecording(false);
    setAiStatus('idle');
    setInterimText('');
    setActiveTool(null);
    setActiveMode('general');
    stopListening();
    stopAudio();
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
  }

  useEffect(() => {
    return () => {
      stopListening();
      stopAudio();
      if (wsRef.current) wsRef.current.close();
    };
  }, [stopListening, stopAudio]);

  // Render a single chat item
  const renderItem = (item: ChatItem) => {
    // Speech bubble
    if (item.type === 'speech') {
      const isUser = item.speaker === 'user';
      return (
        <div key={item.id} className={`mb-3 ${isUser ? 'flex justify-end' : ''}`}>
          <div
            className={`${isMobile ? 'max-w-[85%]' : 'max-w-2xl'} rounded-xl px-4 py-3`}
            style={{
              background: isUser ? 'var(--accent-muted)' : 'var(--surface)',
              border: `1px solid ${isUser ? 'rgba(212, 166, 74, 0.15)' : 'var(--border-subtle)'}`,
            }}
          >
            <span className="text-[10px] font-medium uppercase tracking-wider opacity-50 block mb-1">
              {isUser ? 'You' : activeTool ? (TOOL_LABELS[activeTool] || 'AI') : 'AI'}
            </span>
            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
              {item.text}
            </div>
          </div>
        </div>
      );
    }

    // System message
    if (item.type === 'system') {
      return (
        <div key={item.id} className="flex justify-center mb-3">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
          >
            {item.text}
          </div>
        </div>
      );
    }

    // Fallacy card
    if (item.type === 'fallacy' && item.fallacy) {
      const f = item.fallacy;
      const colors = SEVERITY_COLORS[f.severity] || SEVERITY_COLORS.low;
      return (
        <div key={item.id} className="mx-auto max-w-[90%] mb-3">
          <div className="rounded-xl px-4 py-3" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <ShieldAlert size={16} style={{ color: colors.border }} />
              <span className="font-semibold text-sm" style={{ color: colors.text }}>{f.name}</span>
              <span
                className="ml-auto text-[9px] px-2 py-0.5 rounded-full font-bold uppercase"
                style={{ background: `${colors.border}30`, color: colors.text }}
              >
                {f.severity}
              </span>
            </div>
            <p className="text-xs leading-relaxed mb-1" style={{ color: 'var(--text-secondary)' }}>
              &ldquo;{f.what_was_said}&rdquo;
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {f.why_its_wrong}
            </p>
            {f.correct_form && (
              <p className="text-xs mt-1 italic" style={{ color: 'var(--text-faint)' }}>
                Better: {f.correct_form}
              </p>
            )}
          </div>
        </div>
      );
    }

    // Technique badge
    if (item.type === 'technique' && item.technique) {
      const t = item.technique;
      const colors = TECHNIQUE_COLORS[t.quality] || TECHNIQUE_COLORS.weak;
      return (
        <div key={item.id} className="mx-auto max-w-[90%] mb-3">
          <div className="rounded-xl px-4 py-3" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={14} style={{ color: colors.border }} />
              <span className="font-semibold text-sm" style={{ color: colors.border }}>{t.name}</span>
              <span
                className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase"
                style={{ background: `${colors.border}30`, color: colors.border }}
              >
                {t.quality}
              </span>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.feedback}</p>
          </div>
        </div>
      );
    }

    // Fact check card
    if (item.type === 'fact_check' && item.factCheck) {
      const fc = item.factCheck;
      const isIncorrect = fc.status === 'incorrect';
      return (
        <div key={item.id} className="mx-auto max-w-[90%] mb-3">
          <div
            className="rounded-xl px-4 py-3"
            style={{
              background: isIncorrect ? 'rgba(220, 38, 38, 0.12)' : 'rgba(245, 158, 11, 0.12)',
              border: `1px solid ${isIncorrect ? '#dc2626' : '#f59e0b'}`,
            }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              {isIncorrect ? (
                <AlertTriangle size={16} style={{ color: '#dc2626' }} />
              ) : (
                <AlertCircle size={16} style={{ color: '#f59e0b' }} />
              )}
              <span className="font-semibold text-xs uppercase" style={{ color: isIncorrect ? '#fca5a5' : '#fde68a' }}>
                {isIncorrect ? 'Incorrect' : 'Assumption'}
              </span>
            </div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
              &ldquo;{fc.claim}&rdquo;
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {fc.correction}
            </p>
          </div>
        </div>
      );
    }

    // Architecture update card
    if (item.type === 'arch_update') {
      const stackCount = item.archStack?.length || 0;
      const totalCost = item.archStack?.reduce((sum, t) => sum + (t.monthly_cost || 0), 0) || 0;
      return (
        <div key={item.id} className="mx-auto max-w-[90%] mb-3">
          <div
            className="rounded-xl px-4 py-3"
            style={{ background: 'rgba(74, 222, 128, 0.1)', border: '1px solid rgba(74, 222, 128, 0.3)' }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Wrench size={16} style={{ color: '#4ade80' }} />
              <span className="font-semibold text-sm" style={{ color: '#4ade80' }}>Architecture Update</span>
            </div>
            <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span>{stackCount} tool{stackCount !== 1 ? 's' : ''} in stack</span>
              <span>${totalCost}/mo estimated</span>
            </div>
            {item.archChangelog && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{item.archChangelog}</p>
            )}
          </div>
        </div>
      );
    }

    // Contention card
    if (item.type === 'contention' && item.contentions?.length) {
      const strengthColors: Record<string, { bg: string; border: string }> = {
        strong: { bg: 'rgba(74, 222, 128, 0.12)', border: '#4ade80' },
        moderate: { bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b' },
        weak: { bg: 'rgba(220, 38, 38, 0.12)', border: '#dc2626' },
      };
      return (
        <div key={item.id} className="mx-auto max-w-[90%] mb-3">
          <div className="rounded-xl px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Scale size={14} style={{ color: 'var(--accent)' }} />
              <span className="font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                Contentions ({item.contentions.length})
              </span>
            </div>
            <div className="space-y-2">
              {item.contentions.map((c) => {
                const sc = strengthColors[c.strength] || strengthColors.moderate;
                return (
                  <div key={c.id} className="rounded-lg px-3 py-2" style={{ background: sc.bg, borderLeft: `3px solid ${sc.border}` }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-bold uppercase" style={{ color: sc.border }}>{c.id}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${sc.border}20`, color: sc.border }}>
                        {c.strength}
                      </span>
                      <span className="text-[9px] ml-auto" style={{ color: 'var(--text-faint)' }}>
                        Evidence: {c.evidence_status}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{c.text}</p>
                    {c.vulnerability && (
                      <p className="text-[10px] mt-0.5 italic" style={{ color: 'var(--text-faint)' }}>
                        Vulnerability: {c.vulnerability}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  // Active tool badge
  const ToolBadge = activeTool ? (() => {
    const Icon = TOOL_ICONS[activeTool] || Wrench;
    const color = TOOL_COLORS[activeTool] || 'var(--accent)';
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mr-2"
        style={{ background: `${color}20`, border: `1px solid ${color}40`, color }}
      >
        <Icon size={12} />
        <span>{TOOL_LABELS[activeTool] || activeTool}</span>
        {activeMode !== 'general' && activeMode !== 'default' && (
          <span className="opacity-60">· {activeMode}</span>
        )}
        <button
          onClick={handleDeactivateTool}
          className="ml-1 p-0.5 rounded-full transition-colors hover:opacity-80 cursor-pointer"
          style={{ color }}
        >
          <X size={10} />
        </button>
      </div>
    );
  })() : null;

  return (
    <div className="flex flex-col h-screen">
      <div className="flex flex-1 overflow-hidden">
        {/* Main chat area */}
        <div className="flex-1 flex flex-col" style={{ background: 'var(--bg)' }}>
          {/* Speech error */}
          {speechError && (
            <div className="mx-3 sm:mx-4 mt-3 flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ background: 'var(--red-muted)', border: '1px solid rgba(204, 80, 64, 0.2)', color: 'var(--red)' }}>
              <AlertCircle size={16} />{speechError}
            </div>
          )}
          {retryCount > 0 && !speechError && (
            <div className="mx-3 sm:mx-4 mt-3 flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ background: 'var(--amber-muted)', border: '1px solid rgba(212, 166, 74, 0.2)', color: 'var(--amber)' }}>
              <RefreshCw size={14} className="animate-spin" />Reconnecting... (attempt {retryCount}/5)
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: 'var(--accent-muted)', border: '1px solid rgba(212, 166, 74, 0.15)' }}>
                  <MessageSquare size={28} style={{ color: 'var(--accent)' }} />
                </div>
                <h2 className="heading-section text-lg mb-2">Chat</h2>
                <p className="text-sm max-w-md mb-4" style={{ color: 'var(--text-secondary)' }}>
                  Start a conversation and I&apos;ll automatically switch to the right tool.
                  Quiz, debate, architecture, concept mapping — just say what you need.
                </p>
                <div className="flex items-center gap-2 mb-4">
                  <span className={`status-dot ${aiStatus}`} />
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {aiStatus === 'idle' ? 'Ready' : aiStatus === 'listening' ? 'Listening...'
                      : aiStatus === 'thinking' ? 'Thinking...' : 'Speaking...'}
                  </span>
                </div>
                <button onClick={handleToggleMic}
                  className={`mic-btn ${isRecording ? 'recording' : ''}`}
                  style={isMobile ? { width: 80, height: 80 } : undefined}>
                  {isRecording ? <MicOff size={isMobile ? 32 : 24} /> : <Mic size={isMobile ? 32 : 24} />}
                  {isRecording && <span className="mic-ring" />}
                </button>
                <p className="text-xs mt-3" style={{ color: 'var(--text-faint)' }}>
                  {isRecording ? 'Tap to stop' : 'Tap to start speaking'}
                </p>

                {/* Quick action chips */}
                <div className="flex flex-wrap justify-center gap-2 mt-6 max-w-lg">
                  {[
                    'Quiz me on something',
                    'Help me plan an app',
                    'Practice my debate skills',
                    'Map out a concept',
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      className="px-4 py-2 rounded-full text-xs transition-colors cursor-pointer"
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        minHeight: '44px',
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {items.map(renderItem)}

                {/* AI status */}
                {aiStatus === 'thinking' && (
                  <div className="flex items-center gap-2 mb-3">
                    <span className="status-dot thinking" />
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      {activeTool ? `${TOOL_LABELS[activeTool] || 'AI'} is thinking...` : 'Thinking...'}
                    </span>
                  </div>
                )}

                {interimText && (
                  <div className="flex justify-end mb-3">
                    <div className={`${isMobile ? 'max-w-[85%]' : 'max-w-2xl'} rounded-xl px-4 py-3 opacity-50`}
                      style={{ background: 'var(--accent-muted)', border: '1px solid rgba(212, 166, 74, 0.1)' }}>
                      <span className="text-[10px] font-medium opacity-50 block mb-1">YOU</span>
                      <p className="text-sm italic" style={{ color: 'var(--text-faint)' }}>{interimText}...</p>
                    </div>
                  </div>
                )}

                <div ref={transcriptEndRef} />
              </>
            )}
          </div>

          {/* Bottom input */}
          <div className="px-3 sm:px-4 py-2" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
            {/* Active tool badge row */}
            {ToolBadge && (
              <div className="flex items-center mb-2">
                {ToolBadge}
              </div>
            )}
            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={handleToggleMic}
                className="p-2.5 rounded-lg transition-colors relative flex-shrink-0"
                style={{
                  background: isRecording ? 'var(--red-muted)' : 'transparent',
                  border: `1px solid ${isRecording ? 'rgba(204, 80, 64, 0.3)' : 'var(--border-subtle)'}`,
                  color: isRecording ? 'var(--red)' : 'var(--text-muted)',
                  minHeight: '44px', minWidth: '44px',
                }}
              >
                {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
              </button>

              <form onSubmit={handleTextSubmit} className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  className="form-input text-sm"
                  placeholder={activeTool ? `Chat with ${TOOL_LABELS[activeTool] || 'AI'}...` : 'Ask anything...'}
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                />
                <button type="submit" disabled={!textInput.trim()} className="btn-primary px-3 py-2" style={{ minHeight: '44px' }}>
                  <Send size={16} />
                </button>
              </form>

              {sessionActive && (
                <div className="flex items-center gap-1 sm:gap-2">
                  <button
                    onClick={handleVoiceToggle}
                    className="p-2 rounded-lg transition-colors cursor-pointer"
                    style={{
                      background: voiceEnabled ? 'transparent' : 'rgba(204, 80, 64, 0.15)',
                      border: `1px solid ${voiceEnabled ? 'var(--border-subtle)' : 'rgba(204, 80, 64, 0.3)'}`,
                      color: voiceEnabled ? 'var(--text-muted)' : 'var(--red)',
                      minHeight: '44px', minWidth: '44px',
                    }}
                    title={voiceEnabled ? 'Mute AI voice' : 'Unmute AI voice'}
                  >
                    {voiceEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  </button>
                  <button onClick={handleEndSession} className="btn-danger text-sm" style={{ minHeight: '44px' }}>
                    <Square size={14} />{!isMobile && ' End'}
                  </button>
                </div>
              )}

              {!isMobile && mermaidCode && (
                <button
                  onClick={() => setShowDiagram(!showDiagram)}
                  className="p-2 rounded-lg transition-colors cursor-pointer"
                  style={{
                    background: showDiagram ? 'var(--accent-muted)' : 'transparent',
                    border: `1px solid ${showDiagram ? 'rgba(212, 166, 74, 0.2)' : 'var(--border-subtle)'}`,
                    color: showDiagram ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                  title="Toggle conversation map"
                >
                  <Network size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Desktop diagram panel */}
        {!isMobile && showDiagram && mermaidCode && (
          <div className="w-80 flex-shrink-0 flex flex-col" style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Conversation Map
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setZoom((z) => Math.min(z + 0.2, 3))} className="p-1.5 rounded cursor-pointer"
                  style={{ color: 'var(--text-muted)' }}><ZoomIn size={14} /></button>
                <button onClick={() => setZoom((z) => Math.max(z - 0.2, 0.3))} className="p-1.5 rounded cursor-pointer"
                  style={{ color: 'var(--text-muted)' }}><ZoomOut size={14} /></button>
                <button onClick={() => setZoom(1)} className="p-1.5 rounded cursor-pointer"
                  style={{ color: 'var(--text-muted)' }}><RotateCcw size={14} /></button>
                <button onClick={() => setShowDiagram(false)} className="p-1.5 rounded cursor-pointer"
                  style={{ color: 'var(--text-faint)' }}><X size={14} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} className="transition-transform duration-200">
                <div ref={mermaidContainerRef} className="mermaid-render" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
