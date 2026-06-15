'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { WS_BASE } from '@/lib/api';
import { useRealtimeVoice } from '@/lib/useRealtimeVoice';
import { buildSystemPrompt } from '@/lib/realtimePrompts';
import { useIsMobile } from '@/lib/useIsMobile';
import { supabase } from '@/lib/supabase';
import {
  Mic, MicOff, Send, Volume2, VolumeX, Square, X,
  Network, ZoomIn, ZoomOut, RotateCcw,
  AlertCircle, AlertTriangle, ShieldAlert, Sparkles,
  BookOpen, Scale, Cpu, Map, MessageCircle, Brain, Swords, Blocks,
  ChevronUp, ChevronDown, Layers, DollarSign,
  Package, CheckSquare, Activity, GitBranch, Clock,
  Crown, TrendingDown, Shield, Server, Zap, Settings,
  FileText, Check, XCircle,
  Globe, Lock, GraduationCap, Target,
  Trophy, Loader2, PanelRight, Wrench, History, PanelLeft, Plus, Download,
} from 'lucide-react';
import { MermaidExport } from '@/components/MermaidExport';
import { SessionHistory } from '@/components/SessionHistory';
import type { SessionDetail } from '@/lib/types';
import type {
  StudyMode, StudyClass, ThoughtPlotMode,
  FallacyCall, TechniqueDetection, FactCheckNotification,
  StackTool, ChecklistItem, HealthScores, ArchDecision, ChangelogEntry,
  Contention, DebateAnalysis,
} from '@/lib/types';

// ─── Types ───

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

type ArchTab = 'architecture' | 'stack' | 'checklist' | 'health' | 'costs' | 'decisions' | 'changelog' | 'plot';
type ScoreTab = 'score' | 'structure' | 'techniques' | 'coach' | 'plot';
type TpTab = 'controls' | 'map' | 'checks';

// ─── Constants ───

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

const STRENGTH_COLORS: Record<string, { bg: string; border: string }> = {
  strong: { bg: 'rgba(74, 222, 128, 0.12)', border: '#4ade80' },
  moderate: { bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b' },
  weak: { bg: 'rgba(220, 38, 38, 0.12)', border: '#dc2626' },
};

const TOOL_LABELS: Record<string, string> = {
  study_buddy: 'Study Buddy', thought_plot: 'Thought Plot',
  architect: 'Architect', argument_ref: 'Argument Ref',
};
const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  study_buddy: BookOpen, thought_plot: Map, architect: Cpu, argument_ref: Scale,
};
const TOOL_COLORS: Record<string, string> = {
  study_buddy: '#60a5fa', thought_plot: '#c084fc', architect: '#4ade80', argument_ref: '#f87171',
};

const QUICK_ACTIONS = [
  { label: 'Quiz me', icon: Brain, prompt: 'Quiz me on something', color: 'var(--blue)' },
  { label: 'Plan an app', icon: Blocks, prompt: 'Help me plan a software project', color: 'var(--teal)' },
  { label: 'Debate practice', icon: Swords, prompt: "Let's practice debate", color: 'var(--red)' },
  { label: 'Map a concept', icon: Network, prompt: 'Help me map out a concept', color: 'var(--accent)' },
];

const STUDY_MODES: { mode: StudyMode; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { mode: 'quiz', label: 'Quiz', icon: Brain },
  { mode: 'guided_study', label: 'Guided', icon: BookOpen },
  { mode: 'cram', label: 'Cram', icon: Zap },
  { mode: 'language', label: 'Language', icon: Globe },
  { mode: 'strategy', label: 'Strategy', icon: Target },
  { mode: 'general', label: 'General', icon: MessageCircle },
];

const ARCH_TABS: { id: ArchTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'architecture', label: 'ARCH', icon: Layers },
  { id: 'stack', label: 'STACK', icon: Package },
  { id: 'checklist', label: 'CHECK', icon: CheckSquare },
  { id: 'health', label: 'HEALTH', icon: Activity },
  { id: 'costs', label: 'COSTS', icon: DollarSign },
  { id: 'decisions', label: 'DECIDE', icon: GitBranch },
  { id: 'changelog', label: 'LOG', icon: Clock },
  { id: 'plot', label: 'PLOT', icon: Network },
];

const SCORE_TABS: { id: ScoreTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'score', label: 'SCORE', icon: Trophy },
  { id: 'structure', label: 'STRUCT', icon: GitBranch },
  { id: 'techniques', label: 'TECH', icon: Sparkles },
  { id: 'coach', label: 'COACH', icon: GraduationCap },
  { id: 'plot', label: 'MAP', icon: Network },
];

const TP_MODES: { mode: ThoughtPlotMode; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { mode: 'general', label: 'General', icon: MessageCircle },
  { mode: 'topic_locked', label: 'Topic', icon: Lock },
  { mode: 'class_mode', label: 'Class', icon: GraduationCap },
  { mode: 'study', label: 'Study', icon: BookOpen },
  { mode: 'quiz', label: 'Quiz', icon: Brain },
];

const TP_TABS: { id: TpTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'controls', label: 'CONTROLS', icon: Settings },
  { id: 'map', label: 'MAP', icon: Network },
  { id: 'checks', label: 'CHECKS', icon: Shield },
];

// ─── Markdown Renderer ───

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let key = 0;

  const inlineFormat = (line: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIndex = 0;
    let match;
    let pk = 0;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) parts.push(line.slice(lastIndex, match.index));
      const m = match[0];
      if (m.startsWith('**')) {
        parts.push(<strong key={pk++} style={{ color: 'var(--accent)' }}>{m.slice(2, -2)}</strong>);
      } else if (m.startsWith('`')) {
        parts.push(
          <code key={pk++} className="px-1 py-0.5 rounded text-[11px]"
            style={{ background: 'rgba(212,166,74,0.12)', color: 'var(--accent)' }}>
            {m.slice(1, -1)}
          </code>
        );
      }
      lastIndex = match.index + m.length;
    }
    if (lastIndex < line.length) parts.push(line.slice(lastIndex));
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++} className="pl-4 my-1 space-y-0.5" style={{ listStyleType: 'disc' }}>
          {listItems}
        </ul>
      );
      listItems = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flushList(); continue; }
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(<p key={key++} className="text-xs font-bold uppercase tracking-wider mt-2 mb-1" style={{ color: 'var(--accent)' }}>{trimmed.slice(3)}</p>);
    } else if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(<p key={key++} className="text-sm font-bold mt-2 mb-1" style={{ color: 'var(--text-primary)' }}>{trimmed.slice(2)}</p>);
    } else if (/^[-*]\s/.test(trimmed)) {
      listItems.push(<li key={key++} className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{inlineFormat(trimmed.replace(/^[-*]\s+/, ''))}</li>);
    } else if (/^\d+\.\s/.test(trimmed)) {
      flushList();
      elements.push(<p key={key++} className="text-sm leading-relaxed pl-2" style={{ color: 'var(--text-primary)' }}>{inlineFormat(trimmed)}</p>);
    } else {
      flushList();
      elements.push(<p key={key++} className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{inlineFormat(trimmed)}</p>);
    }
  }
  flushList();
  return elements;
}

// ─── Component ───

export default function GideonPage() {
  const isMobile = useIsMobile();

  // ── Core State ──
  const [items, setItems] = useState<ChatItem[]>([]);
  const [textInput, setTextInput] = useState('');
  const [sessionActive, setSessionActive] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState('general');
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Tool switching transition
  const [toolSwitching, setToolSwitching] = useState(false);

  // Error banner
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Voice toggle
  const [voiceEnabled, setVoiceEnabled] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('tp-voice-enabled') !== 'false' : true
  );

  // Diagram — per-tool mermaid codes
  const [mermaidCodes, setMermaidCodes] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState(1);
  const mermaidContainerRef = useRef<HTMLDivElement>(null);
  const mermaidInitRef = useRef(false);
  const activeMermaid = mermaidCodes[activeTool || 'general_chat'] || '';

  // ── Export dropdown ──
  const [showExportMenu, setShowExportMenu] = useState(false);

  // ── Architect State ──
  const [archStack, setArchStack] = useState<StackTool[]>([]);
  const [archChecklist, setArchChecklist] = useState<ChecklistItem[]>([]);
  const [archHealth, setArchHealth] = useState<HealthScores>({ scalability: 1, security: 1, cost_efficiency: 1, maintainability: 1, reliability: 1 });
  const [archDecisions, setArchDecisions] = useState<ArchDecision[]>([]);
  const [archChangelog, setArchChangelog] = useState<ChangelogEntry[]>([]);
  const [archTab, setArchTab] = useState<ArchTab>('architecture');
  const [costMode, setCostMode] = useState<'cheapest' | 'best' | 'all'>('all');
  const [promptCopied, setPromptCopied] = useState(false);

  // ── Study Buddy State ──
  const [classId, setClassId] = useState('');
  const [topic, setTopic] = useState('');
  const [classes, setClasses] = useState<StudyClass[]>([]);
  const [studyTab, setStudyTab] = useState<'transcript' | 'map'>('transcript');

  // ── Thought Plot State ──
  const [tpVoiceEnabled, setTpVoiceEnabled] = useState(false);
  const [tpFactCheckEnabled, setTpFactCheckEnabled] = useState(true);
  const [tpTab, setTpTab] = useState<TpTab>('controls');

  // ── Argument Ref State ──
  const [argMode, setArgMode] = useState<'referee' | 'harvey'>('referee');
  const [fallacies, setFallacies] = useState<FallacyCall[]>([]);
  const [techniques, setTechniques] = useState<TechniqueDetection[]>([]);
  const [contentions, setContentions] = useState<Contention[]>([]);
  const [scoreTab, setScoreTab] = useState<ScoreTab>('score');
  const [debateAnalysis, setDebateAnalysis] = useState<DebateAnalysis | null>(null);

  // ── Refs ──
  const wsRef = useRef<WebSocket | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const activeModeRef = useRef(activeMode);
  activeModeRef.current = activeMode;
  const classIdRef = useRef(classId);
  classIdRef.current = classId;
  const topicRef = useRef(topic);
  topicRef.current = topic;
  const tpFactCheckRef = useRef(tpFactCheckEnabled);
  tpFactCheckRef.current = tpFactCheckEnabled;
  const tpVoiceRef = useRef(tpVoiceEnabled);
  tpVoiceRef.current = tpVoiceEnabled;

  // Refs for Realtime hook methods (to avoid circular dependency)
  const updateSessionRef = useRef<(instructions: string, tools?: unknown[]) => void>(() => {});
  const respondToFCRef = useRef<(callId: string, result: string) => void>(() => {});
  const connectRealtimeRef = useRef<(tool?: string | null, mode?: string) => Promise<void>>(async () => {});
  const disconnectRealtimeRef = useRef<() => void>(() => {});
  const getClassInfoRef = useRef<(() => { name: string; subject: string; hasMaterials: boolean } | null)>(() => null);

  // ── Helpers ──
  const addItem = useCallback((type: ChatItem['type'], data: Partial<ChatItem>) => {
    setItems(prev => [...prev, { id: crypto.randomUUID(), type, timestamp: Date.now(), ...data }]);
  }, []);

  const forwardToBackend = useCallback((msgType: string, text: string, extra?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const tool = activeToolRef.current || 'general_chat';
      wsRef.current.send(JSON.stringify({
        type: msgType, text, tool,
        mode: activeModeRef.current,
        class_id: classIdRef.current || undefined,
        topic: topicRef.current || undefined,
        realtime_active: realtimeStatusRef.current === 'connected',
        ...(tool === 'thought_plot' ? {
          fact_check_enabled: tpFactCheckRef.current,
          voice_enabled: tpVoiceRef.current,
        } : {}),
        ...extra,
      }));
    }
  }, []);

  // ── Realtime Voice Hook ──
  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    if (isFinal && text.trim()) {
      addItem('speech', { speaker: 'user', text });
      forwardToBackend('realtime_transcript', text);
    }
  }, [addItem, forwardToBackend]);

  const handleAIResponse = useCallback((text: string) => {
    if (text.trim()) {
      addItem('speech', { speaker: 'ai', text });
      forwardToBackend('realtime_ai_response', text);
    }
  }, [addItem, forwardToBackend]);

  // Send tool_section_end to backend for auto-save
  const sendToolSectionEnd = useCallback((tool: string, mode: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'tool_section_end',
        tool: tool || 'general_chat',
        mode,
        topic: topicRef.current || undefined,
      }));
    }
  }, []);

  const handleFunctionCall = useCallback(async (name: string, args: Record<string, unknown>, callId: string) => {
    if (name === 'activate_tool') {
      const tool = args.tool as string;
      const mode = (args.mode as string) || 'general';
      const reason = (args.reason as string) || '';
      // Auto-save previous tool section before switching
      if (activeToolRef.current) {
        sendToolSectionEnd(activeToolRef.current, activeModeRef.current);
      }

      // Respond to function call BEFORE disconnecting (so Realtime doesn't hang)
      respondToFCRef.current(callId, JSON.stringify({ success: true, tool, mode }));

      // === CONTEXT ISOLATION: disconnect → reset → reconnect ===
      setToolSwitching(true);
      setActiveTool(tool);
      setActiveMode(mode);
      addItem('system', {
        text: `Activated ${TOOL_LABELS[tool] || tool}${mode !== 'general' && mode !== 'default' ? ` (${mode})` : ''} — ${reason}`,
      });
      if ((tool === 'architect' || tool === 'argument_ref') && !isMobile) {
        setShowRightPanel(true);
      }
      if (tool === 'thought_plot' && !isMobile) {
        setShowRightPanel(true); setTpTab('controls');
      }

      // Disconnect current Realtime session (wipes conversation context)
      disconnectRealtimeRef.current();

      // Tell backend to clear histories
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'context_reset', tool, mode }));
      }

      // Reconnect with fresh session — new system prompt, clean slate
      await connectRealtimeRef.current(tool, mode);
      setToolSwitching(false);

    } else if (name === 'deactivate_tool') {
      const reason = (args.reason as string) || '';
      // Auto-save before deactivating
      if (activeToolRef.current) {
        sendToolSectionEnd(activeToolRef.current, activeModeRef.current);
      }

      respondToFCRef.current(callId, JSON.stringify({ success: true }));

      // === CONTEXT ISOLATION: disconnect → reset → reconnect to general ===
      setToolSwitching(true);
      setActiveTool(null);
      setActiveMode('general');
      setShowRightPanel(false);
      addItem('system', { text: `Back to general conversation${reason ? ` — ${reason}` : ''}` });

      disconnectRealtimeRef.current();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'context_reset', tool: 'general_chat', mode: 'general' }));
      }
      await connectRealtimeRef.current(null, 'general');
      setToolSwitching(false);
    }
  }, [addItem, isMobile, sendToolSectionEnd]);

  const {
    connect: connectRealtime,
    disconnect: disconnectRealtime,
    sendText: realtimeSendText,
    updateSession,
    respondToFunctionCall,
    setMuted,
    status: realtimeStatus,
    aiStatus,
  } = useRealtimeVoice({
    voice: 'sage',
    onTranscript: handleTranscript,
    onAIResponse: handleAIResponse,
    onFunctionCall: handleFunctionCall,
    onAIStatusChange: () => {},
    onError: (err) => {
      console.error('Realtime error:', err);
      setErrorBanner(err || 'Voice connection failed. You can still type messages.');
      setTimeout(() => setErrorBanner(null), 8000);
    },
  });

  // Bridge refs
  updateSessionRef.current = updateSession;
  respondToFCRef.current = respondToFunctionCall;
  connectRealtimeRef.current = connectRealtime;
  disconnectRealtimeRef.current = disconnectRealtime;
  const realtimeSendTextRef = useRef(realtimeSendText);
  realtimeSendTextRef.current = realtimeSendText;
  const realtimeStatusRef = useRef(realtimeStatus);
  realtimeStatusRef.current = realtimeStatus;

  // ── Backend WebSocket ──
  const connectBackendWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(`${WS_BASE}/ws/study-session`);
    ws.onopen = () => console.log('Gideon backend WS connected');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Text-only fallback responses (only when Realtime is NOT connected)
        if (data.type === 'ai_response' && realtimeStatusRef.current !== 'connected') {
          addItem('speech', { speaker: 'ai', text: data.text });
        }
        else if (data.type === 'tool_activated' && realtimeStatusRef.current !== 'connected') {
          setActiveTool(data.tool);
          setActiveMode(data.mode || 'general');
          addItem('system', { text: `Activated ${TOOL_LABELS[data.tool] || data.tool} — ${data.reason || ''}` });
          if (data.tool === 'architect' && !isMobile) { setShowRightPanel(true); setArchTab('architecture'); }
          if (data.tool === 'argument_ref' && !isMobile) setShowRightPanel(true);
          if (data.tool === 'thought_plot' && !isMobile) { setShowRightPanel(true); setTpTab('controls'); }
        }
        else if (data.type === 'tool_deactivated' && realtimeStatusRef.current !== 'connected') {
          setActiveTool(null); setActiveMode('general'); setShowRightPanel(false);
          addItem('system', { text: 'Back to general conversation' });
        }

        // Quiz context ready — inject into Realtime system prompt
        else if (data.type === 'quiz_context_ready' && data.context) {
          const sourceLabel = data.source === 'class_materials' ? 'your course materials' : 'web research';
          addItem('system', { text: `Loaded ${sourceLabel} for ${data.topic || 'this topic'}` });
          // Inject quiz material into Realtime prompt via session.update
          if (realtimeStatusRef.current === 'connected') {
            const tpOpts = activeTool === 'thought_plot' ? { voiceEnabled: tpVoiceRef.current } : undefined;
            const currentPrompt = buildSystemPrompt(activeTool, activeMode, getClassInfoRef.current(), tpOpts);
            const quizPrompt = currentPrompt + `\n\n## QUIZ MATERIAL (from ${sourceLabel}) — Use this as your PRIMARY source for questions:\n\n${data.context}\n\nIMPORTANT: Base your questions on the material above. Stay strictly on topic: "${data.topic}". Do NOT ask questions outside this domain.`;
            updateSessionRef.current(quizPrompt);
          }
        }

        // Background agent results — always process
        else if (data.type === 'plot_update' && data.graph?.mermaid_code) {
          const plotTool = data.tool || activeTool || 'general_chat';
          setMermaidCodes(prev => ({ ...prev, [plotTool]: data.graph.mermaid_code }));
          if (activeTool === 'architect') { setArchTab('plot'); }
          if (!isMobile && !activeTool) setShowRightPanel(true);
        }
        else if (data.type === 'fact_check') {
          const fc: FactCheckNotification = { ...data, timestamp: Date.now(), read: false };
          addItem('fact_check', { factCheck: fc });
          if (activeTool === 'thought_plot') { setTpTab('checks'); if (!isMobile) setShowRightPanel(true); }
          // Inject correction into Realtime voice so it speaks it naturally
          if (realtimeStatusRef.current === 'connected' && data.correction && tpVoiceRef.current) {
            realtimeSendTextRef.current(`[Fact-check correction — read this aloud briefly]: ${data.correction}`);
          }
        }
        else if (data.type === 'architecture_state' && data.panel) {
          const p = data.panel;
          if (p.stack?.length) setArchStack(p.stack);
          if (p.checklist?.length) setArchChecklist(p.checklist);
          if (p.health) setArchHealth(p.health);
          if (p.decisions?.length) setArchDecisions(p.decisions);
          if (p.changelog_entry) {
            setArchChangelog(prev => [{ id: crypto.randomUUID(), type: 'message', label: p.changelog_entry, timestamp: Date.now() }, ...prev]);
          }
          if (!isMobile) { setShowRightPanel(true); setArchTab('stack'); }
          addItem('arch_update', { archStack: p.stack, archChangelog: p.changelog_entry });
        }
        else if (data.type === 'fallacy_call') {
          setFallacies(prev => [...prev, data.fallacy]);
          addItem('fallacy', { fallacy: data.fallacy });
        }
        else if (data.type === 'technique_detected') {
          setTechniques(prev => [...prev, data.technique]);
          addItem('technique', { technique: data.technique });
        }
        else if (data.type === 'contention_update' && data.contentions?.length) {
          setContentions(data.contentions);
          addItem('contention', { contentions: data.contentions });
        }
        else if (data.type === 'debate_analysis' && data.analysis) {
          setDebateAnalysis(data.analysis);
          addItem('system', { text: `Debate Analysis: Grade ${data.analysis.overall_grade} (${data.analysis.overall_score}/100) — ${data.analysis.summary}` });
        }
      } catch { /* invalid message */ }
    };
    ws.onclose = () => console.log('Gideon backend WS disconnected');
    ws.onerror = () => console.log('Gideon backend WS error');
    wsRef.current = ws;
  }, [addItem, isMobile, activeTool]);

  // ── Mermaid Init + Render ──
  useEffect(() => {
    if (mermaidInitRef.current) return;
    mermaidInitRef.current = true;
    Promise.all([
      import('mermaid'),
      import('@mermaid-js/layout-elk'),
    ]).then(([m, elkLayouts]) => {
      m.default.registerLayoutLoaders(elkLayouts.default);
      m.default.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
          darkMode: true,
          background: '#0c0b09',
          primaryColor: '#1e1d1a',
          primaryTextColor: '#f5f3ed',
          primaryBorderColor: '#3d3a35',
          lineColor: '#716d65',
          secondaryColor: '#1e1d1a',
          tertiaryColor: '#161514',
          edgeLabelBackground: '#161514',
          clusterBkg: '#161514',
          clusterBorder: '#332f2a',
        },
        flowchart: {
          curve: 'basis',
          padding: 20,
          nodeSpacing: 80,
          rankSpacing: 70,
          diagramPadding: 30,
          defaultRenderer: 'elk',
        },
      });
    });
  }, []);

  useEffect(() => {
    if (!activeMermaid) return;
    import('mermaid').then(async m => {
      try {
        const id = `mermaid-g-${Date.now()}`;
        const { svg } = await m.default.render(id, activeMermaid);
        if (mermaidContainerRef.current) mermaidContainerRef.current.innerHTML = svg;
      } catch { /* parse error */ }
    });
  }, [activeMermaid, showRightPanel, mobileSheetOpen, archTab, scoreTab, studyTab]);

  // Auto-scroll
  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [items]);

  // Fetch classes for study buddy / thought plot
  const [classMaterialCounts, setClassMaterialCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    supabase.from('classes').select('*').order('name', { ascending: true })
      .then(({ data }) => {
        setClasses(data || []);
        // Fetch material counts for each class
        if (data?.length) {
          supabase.from('course_materials').select('class_id').then(({ data: mats }) => {
            const counts: Record<string, number> = {};
            for (const m of (mats || [])) counts[m.class_id] = (counts[m.class_id] || 0) + 1;
            setClassMaterialCounts(counts);
          });
        }
      });
  }, []);

  // Helper to get class info for system prompt
  const getClassInfo = useCallback(() => {
    if (!classId) return null;
    const cls = classes.find(c => c.id === classId);
    if (!cls) return null;
    return { name: cls.name, subject: cls.subject, hasMaterials: (classMaterialCounts[classId] || 0) > 0 };
  }, [classId, classes, classMaterialCounts]);
  getClassInfoRef.current = getClassInfo;

  // Update Realtime prompt when class changes
  useEffect(() => {
    if (realtimeStatus === 'connected') {
      const info = getClassInfo();
      const tpOpts = activeTool === 'thought_plot' ? { voiceEnabled: tpVoiceRef.current } : undefined;
      updateSession(buildSystemPrompt(activeTool, activeMode, info, tpOpts));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  // Cleanup
  useEffect(() => {
    return () => {
      disconnectRealtime();
      wsRef.current?.close();
    };
  }, [disconnectRealtime]);

  // ── Event Handlers ──

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    if (!sessionActive) { setSessionActive(true); connectBackendWS(); }

    addItem('speech', { speaker: 'user', text });

    if (realtimeStatusRef.current === 'connected') {
      realtimeSendText(text);
      forwardToBackend('realtime_transcript', text);
    } else {
      // Text-only fallback via backend
      const send = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'transcript', text,
            mode: activeModeRef.current,
            tool: activeToolRef.current || 'general_chat',
            class_id: classIdRef.current || undefined,
            topic: topicRef.current || undefined,
          }));
        } else setTimeout(send, 200);
      };
      send();
    }
  }, [sessionActive, addItem, connectBackendWS, realtimeSendText, forwardToBackend]);

  const handleToggleMic = useCallback(() => {
    if (realtimeStatus === 'connected') {
      disconnectRealtime();
    } else {
      if (!sessionActive) { setSessionActive(true); connectBackendWS(); }
      connectRealtime(activeTool, activeMode);
    }
  }, [realtimeStatus, sessionActive, connectBackendWS, connectRealtime, disconnectRealtime, activeTool, activeMode]);

  const handleEndSession = useCallback(() => {
    // Auto-save current tool section before ending
    if (activeToolRef.current) {
      sendToolSectionEnd(activeToolRef.current, activeModeRef.current);
    }
    setSessionActive(false);
    disconnectRealtime();
    wsRef.current?.close(); wsRef.current = null;
    setActiveTool(null); setActiveMode('general');
    setShowRightPanel(false);
  }, [disconnectRealtime, sendToolSectionEnd]);

  const handleNewChat = useCallback(() => {
    // End current session if active
    if (activeToolRef.current) {
      sendToolSectionEnd(activeToolRef.current, activeModeRef.current);
    }
    if (realtimeStatusRef.current === 'connected') disconnectRealtime();
    wsRef.current?.close(); wsRef.current = null;
    // Reset all state
    setSessionActive(false);
    setItems([]);
    setActiveTool(null); setActiveMode('general');
    setShowRightPanel(false); setMobileSheetOpen(false);
    setMermaidCodes({}); setZoom(1);
    setArchStack([]); setArchChecklist([]); setArchHealth({ scalability: 1, security: 1, cost_efficiency: 1, maintainability: 1, reliability: 1 });
    setArchDecisions([]); setArchChangelog([]); setArchTab('architecture');
    setFallacies([]); setTechniques([]); setContentions([]); setDebateAnalysis(null); setScoreTab('score');
    setErrorBanner(null);
  }, [disconnectRealtime, sendToolSectionEnd]);

  const handleDeactivateTool = useCallback(async () => {
    if (activeToolRef.current) {
      sendToolSectionEnd(activeToolRef.current, activeModeRef.current);
    }
    setActiveTool(null); setActiveMode('general'); setShowRightPanel(false);
    addItem('system', { text: 'Back to general conversation' });
    if (realtimeStatusRef.current === 'connected') {
      // Context isolation: disconnect → reset → reconnect
      setToolSwitching(true);
      disconnectRealtimeRef.current();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'context_reset', tool: 'general_chat', mode: 'general' }));
      }
      await connectRealtimeRef.current(null, 'general');
      setToolSwitching(false);
    }
  }, [addItem, sendToolSectionEnd]);

  const handleVoiceToggle = useCallback(() => {
    setVoiceEnabled(prev => {
      const next = !prev;
      localStorage.setItem('tp-voice-enabled', String(next));
      setMuted(!next);
      return next;
    });
  }, [setMuted]);

  const handleTextSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    sendMessage(textInput.trim());
    setTextInput('');
  }, [textInput, sendMessage]);

  // Tool-specific mode changes
  const handleStudyModeChange = useCallback((mode: StudyMode) => {
    setActiveMode(mode);
    if (realtimeStatusRef.current === 'connected') {
      updateSession(buildSystemPrompt('study_buddy', mode, getClassInfo()));
    }
  }, [updateSession]);

  const handleArgModeChange = useCallback((mode: 'referee' | 'harvey') => {
    setArgMode(mode);
    setActiveMode(mode);
    if (realtimeStatusRef.current === 'connected') {
      updateSession(buildSystemPrompt('argument_ref', mode, getClassInfo()));
    }
  }, [updateSession]);

  const handleTpModeChange = useCallback((mode: ThoughtPlotMode) => {
    setActiveMode(mode);
    if (realtimeStatusRef.current === 'connected') {
      updateSession(buildSystemPrompt('thought_plot', mode, getClassInfo(), { voiceEnabled: tpVoiceRef.current }));
    }
  }, [updateSession]);

  // Session history restore — loads UI + sends context to backend + Realtime
  const handleRestoreSession = useCallback((detail: SessionDetail) => {
    // 1. Load transcript into chat UI
    const restored: ChatItem[] = detail.transcript.map(t => ({
      id: t.id || crypto.randomUUID(),
      type: 'speech' as const,
      speaker: t.speaker as 'user' | 'ai',
      text: t.text,
      timestamp: new Date(t.timestamp_ms || Date.now()).getTime(),
    }));
    setItems(restored);

    // 2. Restore tool/mode from session
    const restoredTool = (detail.session.tool && detail.session.tool !== 'general_chat') ? detail.session.tool : null;
    if (restoredTool) {
      setActiveTool(restoredTool);
      setActiveMode(detail.session.mode || 'general');
    }

    // 3. Restore diagram if available
    if (detail.thought_plot?.graph_json) {
      const gj = detail.thought_plot.graph_json as Record<string, unknown>;
      if (typeof gj.mermaid_code === 'string') {
        const restoreTool = detail.session.tool || 'general_chat';
        setMermaidCodes(prev => ({ ...prev, [restoreTool]: gj.mermaid_code as string }));
      }
    }

    // 4. Send restored transcript to backend WS so AI has context
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const history = detail.transcript
        .filter(t => t.speaker === 'user' || t.speaker === 'ai')
        .map(t => ({ role: t.speaker, text: t.text }));
      wsRef.current.send(JSON.stringify({
        type: 'restore_session',
        session_id: detail.session.id,
        tool: detail.session.tool || 'general_chat',
        mode: detail.session.mode || 'general',
        history,
        summary: detail.summary?.summary || null,
        topic: detail.session.topic || null,
      }));
    }

    // 5. If Realtime is connected, inject conversation context into system prompt
    if (realtimeStatusRef.current === 'connected') {
      // Build a condensed summary for Realtime
      const lastMessages = detail.transcript
        .filter(t => t.speaker === 'user' || t.speaker === 'ai')
        .slice(-8)
        .map(t => `${t.speaker === 'user' ? 'Student' : 'Gideon'}: ${t.text}`)
        .join('\n');

      const summaryText = detail.summary?.summary || '';
      const contextBlock = summaryText
        ? `\n\nPREVIOUS CONVERSATION CONTEXT:\nSummary: ${summaryText}\n\nRecent messages:\n${lastMessages}\n\nContinue naturally from where you left off. Reference previous topics when relevant.`
        : `\n\nPREVIOUS CONVERSATION CONTEXT:\nRecent messages:\n${lastMessages}\n\nContinue naturally from where you left off.`;

      const tpOpts = restoredTool === 'thought_plot' ? { voiceEnabled: tpVoiceRef.current } : undefined;
      const basePrompt = buildSystemPrompt(restoredTool, detail.session.mode || 'general', getClassInfoRef.current(), tpOpts);
      updateSessionRef.current(basePrompt + contextBlock);

      // Also send a text cue so Realtime acknowledges the restored context
      realtimeSendTextRef.current(
        `[System: The student has loaded a previous conversation. Greet them briefly and ask if they want to continue where they left off. Don't repeat what was said — just acknowledge you remember.]`
      );
    }

    setSidebarOpen(false);
  }, []);

  // Architect export
  const handleExportPrompt = useCallback(async () => {
    const lines: string[] = [];
    const firstUser = items.find(i => i.speaker === 'user');
    lines.push(`# Architecture Specification: ${firstUser?.text?.slice(0, 80) || 'Architecture Plan'}`);
    lines.push('');
    if (archStack.length > 0) {
      lines.push('## Technology Stack');
      for (const t of archStack) lines.push(`- **${t.name}** (${t.category}) — ${t.description}${t.monthly_cost > 0 ? ` [$${t.monthly_cost}/mo]` : ' [Free]'}`);
      lines.push('');
    }
    if (archDecisions.length > 0) {
      lines.push('## Architecture Decisions');
      for (const d of archDecisions) lines.push(`- **${d.title}** [${d.status}]: ${d.context}`);
      lines.push('');
    }
    if (activeMermaid) { lines.push('## System Diagram', '```mermaid', activeMermaid, '```', ''); }
    if (archHealth) {
      lines.push('## Health Assessment');
      lines.push(`- Scalability: ${archHealth.scalability}/5`, `- Security: ${archHealth.security}/5`);
      lines.push(`- Cost Efficiency: ${archHealth.cost_efficiency}/5`, `- Maintainability: ${archHealth.maintainability}/5`);
      lines.push(`- Reliability: ${archHealth.reliability}/5`, '');
    }
    try { await navigator.clipboard.writeText(lines.join('\n')); } catch { /* fallback */ }
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  }, [items, archStack, archDecisions, activeMermaid, archHealth]);

  // Full session export — downloads everything as markdown
  const handleDownloadSession = useCallback((includeAI: boolean = true) => {
    const lines: string[] = [];
    const toolLabel = activeTool === 'architect' ? 'Architecture' : activeTool === 'argument_ref' ? 'Debate' : activeTool === 'study_buddy' ? 'Study' : activeTool === 'thought_plot' ? 'Thought Plot' : 'Chat';
    lines.push(`# Gideon ${toolLabel} Session${!includeAI ? ' (Your Words Only)' : ''}`);
    lines.push(`*Exported ${new Date().toLocaleString()}*\n`);

    // Transcript
    const speeches = items.filter(i => i.type === 'speech' && i.text && (includeAI || i.speaker === 'user'));
    if (speeches.length > 0) {
      lines.push(includeAI ? '## Conversation' : '## Your Thoughts');
      for (const s of speeches) {
        if (includeAI) {
          lines.push(`**${s.speaker === 'user' ? 'You' : 'Gideon'}**: ${s.text}\n`);
        } else {
          lines.push(`${s.text}\n`);
        }
      }
    }

    // Architect data
    if (archStack.length > 0) {
      lines.push('## Technology Stack');
      for (const t of archStack) lines.push(`- **${t.name}** (${t.category}) — ${t.description}${t.monthly_cost > 0 ? ` [$${t.monthly_cost}/mo]` : ' [Free]'}`);
      lines.push('');
    }
    if (archDecisions.length > 0) {
      lines.push('## Architecture Decisions');
      for (const d of archDecisions) lines.push(`- **${d.title}** [${d.status}]: ${d.context}`);
      lines.push('');
    }
    if (archChecklist.length > 0) {
      lines.push('## Implementation Checklist');
      for (const c of archChecklist) lines.push(`- [${c.discussed ? 'x' : ' '}] **${c.label}** (${c.category})`);
      lines.push('');
    }
    if (archHealth) {
      lines.push('## Health Assessment');
      lines.push(`- Scalability: ${archHealth.scalability}/5`, `- Security: ${archHealth.security}/5`);
      lines.push(`- Cost Efficiency: ${archHealth.cost_efficiency}/5`, `- Maintainability: ${archHealth.maintainability}/5`);
      lines.push(`- Reliability: ${archHealth.reliability}/5\n`);
    }
    if (archChangelog.length > 0) {
      lines.push('## Architecture Changelog');
      for (const c of archChangelog) lines.push(`- [${c.type}] ${c.label}`);
      lines.push('');
    }

    // Debate data
    if (fallacies.length > 0) {
      lines.push('## Fallacies Detected');
      for (const f of fallacies) lines.push(`- **${f.name}** (${f.severity}): "${f.what_was_said}" — ${f.why_its_wrong}`);
      lines.push('');
    }
    if (techniques.length > 0) {
      lines.push('## Techniques Used');
      for (const t of techniques) lines.push(`- **${t.name}** (${t.quality}): ${t.feedback}`);
      lines.push('');
    }
    if (contentions.length > 0) {
      lines.push('## Argument Contentions');
      for (const c of contentions) lines.push(`- **${c.text}** [${c.strength}]: ${c.vulnerability || 'No vulnerability noted'}`);
      lines.push('');
    }

    // Fact checks
    const factChecks = items.filter(i => i.type === 'fact_check' && i.factCheck);
    if (factChecks.length > 0) {
      lines.push('## Fact Checks');
      for (const fc of factChecks) {
        const f = fc.factCheck!;
        lines.push(`- **${f.status}** (${Math.round((f.confidence || 0) * 100)}%): "${f.claim}" — ${f.explanation}`);
      }
      lines.push('');
    }

    // Diagrams — all tools
    for (const [tool, code] of Object.entries(mermaidCodes)) {
      if (code) {
        const label = tool === 'architect' ? 'Architecture' : tool === 'argument_ref' ? 'Debate' : tool === 'thought_plot' ? 'Thought Map' : 'Concept Map';
        lines.push(`## ${label} Diagram`, '```mermaid', code, '```\n');
      }
    }

    // Download as file
    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gideon-${toolLabel.toLowerCase()}${!includeAI ? '-thoughts' : ''}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [items, activeTool, archStack, archDecisions, archChecklist, archHealth, archChangelog, fallacies, techniques, contentions, mermaidCodes]);

  // ── Computed Values ──

  const totalMonthlyCost = archStack.reduce((s, t) => s + (t.monthly_cost || 0), 0);
  const stackByCategory: Record<string, StackTool[]> = {};
  for (const t of archStack) { const c = t.category || 'Other'; if (!stackByCategory[c]) stackByCategory[c] = []; stackByCategory[c].push(t); }

  const overallHealth = archHealth ? ((archHealth.scalability + archHealth.security + archHealth.cost_efficiency + archHealth.maintainability + archHealth.reliability) / 5).toFixed(1) : '0.0';
  const healthGrade = Number(overallHealth) >= 4 ? 'A' : Number(overallHealth) >= 3 ? 'B' : Number(overallHealth) >= 2 ? 'C' : 'D';
  const healthBarColor = (s: number) => s >= 4 ? 'var(--green)' : s >= 3 ? 'var(--amber)' : 'var(--red)';
  const difficultyColor = (d: string) => d === 'Easy' ? 'var(--green)' : d === 'Medium' ? 'var(--amber)' : 'var(--red)';
  const checkedCount = archChecklist.filter(c => c.discussed).length;

  const scoreboard = useMemo(() => {
    let severityScore = 0;
    const byType: Record<string, number> = {};
    for (const f of fallacies) { byType[f.name] = (byType[f.name] || 0) + 1; severityScore += f.severity === 'high' ? 15 : f.severity === 'medium' ? 8 : 3; }
    let techniqueScore = 0;
    for (const t of techniques) { techniqueScore += t.quality === 'effective' ? 10 : t.quality === 'weak' ? 3 : 0; }
    const health = Math.max(0, Math.min(100, 50 - severityScore + techniqueScore));
    const grade = health >= 90 ? 'A' : health >= 75 ? 'B' : health >= 55 ? 'C' : health >= 30 ? 'D' : 'F';
    return { health, grade, byType };
  }, [fallacies, techniques]);

  // ── Item Renderer ──

  const renderItem = (item: ChatItem) => {
    if (item.type === 'speech') {
      const isUser = item.speaker === 'user';
      const useMarkdown = !isUser && activeTool === 'architect';
      return (
        <div key={item.id} className={`mb-3 ${isUser ? 'flex justify-end' : ''} animate-fade-up`}>
          <div className={`${isMobile ? 'max-w-[88%]' : 'max-w-2xl'} rounded-2xl px-4 py-3`}
            style={{ background: isUser ? 'var(--accent-muted)' : 'var(--surface)', border: `1px solid ${isUser ? 'rgba(212, 166, 74, 0.15)' : 'var(--border-subtle)'}` }}>
            <span className="text-[10px] font-medium uppercase tracking-wider block mb-1"
              style={{ color: isUser ? 'var(--accent)' : 'var(--text-faint)' }}>
              {isUser ? 'You' : activeTool ? (TOOL_LABELS[activeTool] || 'Gideon') : 'Gideon'}
            </span>
            {useMarkdown ? (
              <div className="space-y-0.5">{renderMarkdown(item.text || '')}</div>
            ) : (
              <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{item.text}</div>
            )}
          </div>
        </div>
      );
    }

    if (item.type === 'system') {
      return (
        <div key={item.id} className="flex justify-center mb-3 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            <Sparkles size={11} style={{ color: 'var(--accent)' }} />{item.text}
          </div>
        </div>
      );
    }

    if (item.type === 'fallacy' && item.fallacy) {
      const f = item.fallacy;
      const c = SEVERITY_COLORS[f.severity] || SEVERITY_COLORS.low;
      return (
        <div key={item.id} className="mx-auto max-w-[90%] mb-3 animate-fade-up">
          <div className="rounded-xl px-4 py-3" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <ShieldAlert size={16} style={{ color: c.border }} />
              <span className="font-semibold text-sm" style={{ color: c.text }}>{f.name}</span>
              <span className="ml-auto text-[9px] px-2 py-0.5 rounded-full font-bold uppercase" style={{ background: `${c.border}30`, color: c.text }}>{f.severity}</span>
            </div>
            <p className="text-xs leading-relaxed mb-1" style={{ color: 'var(--text-secondary)' }}>&ldquo;{f.what_was_said}&rdquo;</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{f.why_its_wrong}</p>
            {f.correct_form && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-faint)' }}>Better: {f.correct_form}</p>}
          </div>
        </div>
      );
    }

    if (item.type === 'technique' && item.technique) {
      const t = item.technique;
      const c = TECHNIQUE_COLORS[t.quality] || TECHNIQUE_COLORS.weak;
      return (
        <div key={item.id} className="mx-auto max-w-[90%] mb-3 animate-fade-up">
          <div className="rounded-xl px-4 py-3" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={14} style={{ color: c.border }} />
              <span className="font-semibold text-sm" style={{ color: c.border }}>{t.name}</span>
              <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase" style={{ background: `${c.border}30`, color: c.border }}>{t.quality}</span>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.feedback}</p>
          </div>
        </div>
      );
    }

    if (item.type === 'fact_check' && item.factCheck) {
      const fc = item.factCheck;
      const bad = fc.status === 'incorrect';
      return (
        <div key={item.id} className="mx-auto max-w-[90%] mb-3 animate-fade-up">
          <div className="rounded-xl px-4 py-3" style={{ background: bad ? 'rgba(220,38,38,0.12)' : 'rgba(245,158,11,0.12)', border: `1px solid ${bad ? '#dc2626' : '#f59e0b'}` }}>
            <div className="flex items-center gap-2 mb-1.5">
              {bad ? <AlertTriangle size={16} style={{ color: '#dc2626' }} /> : <AlertCircle size={16} style={{ color: '#f59e0b' }} />}
              <span className="font-semibold text-xs uppercase" style={{ color: bad ? '#fca5a5' : '#fde68a' }}>{bad ? 'Incorrect' : 'Assumption'}</span>
            </div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>&ldquo;{fc.claim}&rdquo;</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{fc.correction}</p>
          </div>
        </div>
      );
    }

    if (item.type === 'arch_update') {
      const count = item.archStack?.length || 0;
      const cost = item.archStack?.reduce((s, t) => s + (t.monthly_cost || 0), 0) || 0;
      return (
        <div key={item.id} className="mx-auto max-w-[90%] mb-3 animate-fade-up">
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <Wrench size={16} style={{ color: '#4ade80' }} />
              <span className="font-semibold text-sm" style={{ color: '#4ade80' }}>Architecture Update</span>
            </div>
            <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span>{count} tool{count !== 1 ? 's' : ''}</span><span>${cost}/mo</span>
            </div>
            {item.archChangelog && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{item.archChangelog}</p>}
          </div>
        </div>
      );
    }

    if (item.type === 'contention' && item.contentions?.length) {
      return (
        <div key={item.id} className="mx-auto max-w-[90%] mb-3 animate-fade-up">
          <div className="rounded-xl px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Scale size={14} style={{ color: 'var(--accent)' }} />
              <span className="font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Contentions ({item.contentions.length})</span>
            </div>
            <div className="space-y-2">
              {item.contentions.map(c => {
                const sc = STRENGTH_COLORS[c.strength] || STRENGTH_COLORS.moderate;
                return (
                  <div key={c.id} className="rounded-lg px-3 py-2" style={{ background: sc.bg, borderLeft: `3px solid ${sc.border}` }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-bold uppercase" style={{ color: sc.border }}>{c.id}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${sc.border}20`, color: sc.border }}>{c.strength}</span>
                      <span className="text-[9px] ml-auto" style={{ color: 'var(--text-faint)' }}>Evidence: {c.evidence_status}</span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{c.text}</p>
                    {c.vulnerability && <p className="text-[10px] mt-0.5 italic" style={{ color: 'var(--text-faint)' }}>Vulnerability: {c.vulnerability}</p>}
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

  // ── Tool Badge ──
  const ToolBadge = activeTool ? (() => {
    const Icon = TOOL_ICONS[activeTool] || Wrench;
    const color = TOOL_COLORS[activeTool] || 'var(--accent)';
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mr-2"
        style={{ background: `${color}20`, border: `1px solid ${color}40`, color }}>
        <Icon size={12} />
        <span>{TOOL_LABELS[activeTool] || activeTool}</span>
        {activeMode !== 'general' && activeMode !== 'default' && <span className="opacity-60">· {activeMode}</span>}
        <button onClick={handleDeactivateTool} className="ml-1 p-0.5 rounded-full transition-colors hover:opacity-80 cursor-pointer" style={{ color }}>
          <X size={10} />
        </button>
      </div>
    );
  })() : null;

  // ── Welcome Screen ──
  const WelcomeScreen = (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-full blur-3xl" style={{
          background: 'radial-gradient(circle, rgba(212,166,74,0.15) 0%, transparent 70%)',
          width: 180, height: 180, left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          animation: 'gideon-breathe 4s ease-in-out infinite',
        }} />
        <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, var(--accent), #b8923d)', boxShadow: '0 4px 24px rgba(212,166,74,0.3)' }}>
          <MessageCircle size={36} style={{ color: 'var(--bg)' }} />
        </div>
      </div>
      <h1 className="heading-display mb-2" style={{ fontSize: 'clamp(2.2rem, 5vw, 3.5rem)', color: 'var(--text-primary)' }}>Gideon</h1>
      <p className="text-sm mb-1" style={{ color: 'var(--accent)', fontWeight: 600 }}>Your AI Study Companion</p>
      <p className="text-sm max-w-md mb-8 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        Talk to me about anything. I&apos;ll quiz you, map your ideas, plan your architecture, referee your debates — all through natural conversation.
      </p>
      <div className="flex items-center gap-2 mb-6">
        <span className={`status-dot ${aiStatus}`} />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {realtimeStatus === 'connected' ? (aiStatus === 'listening' ? 'Listening...' : aiStatus === 'thinking' ? 'Thinking...' : aiStatus === 'speaking' ? 'Speaking...' : 'Connected') : 'Ready'}
        </span>
      </div>
      <button onClick={handleToggleMic} className={`mic-btn ${realtimeStatus === 'connected' ? 'recording' : ''}`}
        style={isMobile ? { width: 80, height: 80 } : undefined}>
        {realtimeStatus === 'connected' ? <MicOff size={isMobile ? 32 : 24} /> : <Mic size={isMobile ? 32 : 24} />}
        {realtimeStatus === 'connected' && <span className="mic-ring" />}
      </button>
      <p className="text-xs mt-3 mb-8" style={{ color: 'var(--text-faint)' }}>
        {realtimeStatus === 'connecting' ? 'Connecting...' : realtimeStatus === 'connected' ? 'Tap to disconnect' : 'Tap to start speaking, or type below'}
      </p>
      <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-2 max-w-lg w-full`}>
        {QUICK_ACTIONS.map(action => {
          const Icon = action.icon;
          return (
            <button key={action.label} onClick={() => sendMessage(action.prompt)}
              className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all cursor-pointer group"
              style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)', minHeight: 72 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = action.color; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
              <Icon size={18} style={{ color: action.color }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── Diagram Panel (generic) ──
  const DiagramPanel = (
    <>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Thought Map</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))} className="p-1.5 rounded cursor-pointer" style={{ color: 'var(--text-muted)' }}><ZoomIn size={14} /></button>
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} className="p-1.5 rounded cursor-pointer" style={{ color: 'var(--text-muted)' }}><ZoomOut size={14} /></button>
          <button onClick={() => setZoom(1)} className="p-1.5 rounded cursor-pointer" style={{ color: 'var(--text-muted)' }}><RotateCcw size={14} /></button>
          <MermaidExport mermaidCode={activeMermaid} containerRef={mermaidContainerRef} />
          {!isMobile && <button onClick={() => setShowRightPanel(false)} className="p-1.5 rounded cursor-pointer" style={{ color: 'var(--text-faint)' }}><X size={14} /></button>}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {activeMermaid ? (
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} className="transition-transform duration-200">
            <div ref={mermaidContainerRef} className="mermaid-render" />
          </div>
        ) : (
          <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>Diagram will appear here...</p>
        )}
      </div>
    </>
  );

  // ── Architect Right Panel ──
  const ArchitectRightPanel = (
    <>
      <div className="flex overflow-x-auto no-scrollbar" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {ARCH_TABS.map(({ id, label }) => (
          <button key={id} onClick={() => setArchTab(id)}
            className="px-3 py-2.5 text-[10px] font-bold tracking-wider whitespace-nowrap transition-colors cursor-pointer"
            style={{ color: archTab === id ? 'var(--accent)' : 'var(--text-faint)', borderBottom: archTab === id ? '2px solid var(--accent)' : '2px solid transparent' }}>
            {label}
          </button>
        ))}
        {!isMobile && <button onClick={() => setShowRightPanel(false)} className="ml-auto px-2 cursor-pointer" style={{ color: 'var(--text-faint)' }}><X size={14} /></button>}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {archTab === 'architecture' && (
          <div className="flex flex-col gap-3">
            <div className="text-center py-6">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--accent-muted)' }}>
                <Layers size={24} style={{ color: 'var(--accent)' }} />
              </div>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{archStack.length > 0 ? `${archStack.length} tools selected` : 'No architecture yet'}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{archStack.length > 0 ? `$${totalMonthlyCost}/mo estimated` : 'Start chatting to build'}</p>
            </div>
            {archStack.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: 'var(--bg)' }}>
                <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{t.name}</span>
                <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{t.monthly_cost === 0 ? 'Free' : `$${t.monthly_cost}/mo`}</span>
              </div>
            ))}
          </div>
        )}

        {archTab === 'stack' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Tech Stack</span>
              <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>${totalMonthlyCost}/mo</span>
            </div>
            {Object.entries(stackByCategory).map(([cat, tools]) => (
              <div key={cat}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)' }}>{cat}</p>
                {tools.map(t => (
                  <div key={t.id} className="p-2.5 rounded-lg mb-1.5" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(0,0,0,0.2)', color: difficultyColor(t.difficulty) }}>{t.difficulty}</span>
                      {t.cost_tier && t.cost_tier !== 'both' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: t.cost_tier === 'budget' ? 'rgba(120,140,93,0.15)' : 'rgba(212,166,74,0.15)', color: t.cost_tier === 'budget' ? 'var(--green)' : 'var(--accent)' }}>
                          {t.cost_tier === 'budget' ? 'BUDGET' : 'PREMIUM'}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                    <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{t.monthly_cost === 0 ? '$0/mo' : `$${t.monthly_cost}/mo`}</span>
                  </div>
                ))}
              </div>
            ))}
            {archStack.length === 0 && <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>Building your stack...</p>}
          </div>
        )}

        {archTab === 'checklist' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Completeness</span>
              <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>{checkedCount}/{archChecklist.length}</span>
            </div>
            <div className="h-1.5 rounded-full" style={{ background: 'var(--bg)' }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: archChecklist.length > 0 ? `${(checkedCount / archChecklist.length) * 100}%` : '0%', background: 'var(--blue)' }} />
            </div>
            {archChecklist.map(item => (
              <div key={item.id} className="flex items-center gap-2 py-1.5 px-2 rounded" style={{ background: item.discussed ? 'rgba(120,140,93,0.08)' : 'transparent' }}>
                <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
                  style={{ borderColor: item.discussed ? 'var(--green)' : 'var(--border-subtle)', background: item.discussed ? 'var(--green)' : 'transparent' }}>
                  {item.discussed && <span className="text-[8px] text-white font-bold">✓</span>}
                </div>
                <span className="text-xs" style={{ color: item.discussed ? 'var(--text-primary)' : 'var(--text-muted)' }}>{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {archTab === 'health' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Architecture Health</span>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: 'var(--bg)', border: '2px solid var(--border-subtle)', color: 'var(--text-primary)' }}>{healthGrade}</div>
            </div>
            <div className="h-2 rounded-full" style={{ background: 'var(--bg)' }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(Number(overallHealth) / 5) * 100}%`, background: healthBarColor(Number(overallHealth)) }} />
            </div>
            {([['Scalability', archHealth.scalability], ['Security', archHealth.security], ['Cost Efficiency', archHealth.cost_efficiency], ['Maintainability', archHealth.maintainability], ['Reliability', archHealth.reliability]] as [string, number][]).map(([label, score]) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span className="text-xs font-medium" style={{ color: healthBarColor(score) }}>{score}/5</span>
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(i => <div key={i} className="flex-1 h-2 rounded-sm" style={{ background: i <= score ? healthBarColor(score) : 'var(--bg)' }} />)}
                </div>
              </div>
            ))}
          </div>
        )}

        {archTab === 'costs' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Monthly Cost</span>
              <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>${totalMonthlyCost}<span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>/mo</span></span>
            </div>
            {archStack.length > 0 && (
              <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                {([{ id: 'cheapest' as const, label: 'Budget', icon: TrendingDown }, { id: 'all' as const, label: 'All', icon: Package }, { id: 'best' as const, label: 'Best', icon: Crown }]).map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setCostMode(id)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                    style={{ background: costMode === id ? 'var(--bg)' : 'transparent', color: costMode === id ? 'var(--text-primary)' : 'var(--text-faint)', borderRight: id !== 'best' ? '1px solid var(--border-subtle)' : 'none' }}>
                    <Icon size={12} />{label}
                  </button>
                ))}
              </div>
            )}
            {Object.entries(stackByCategory).map(([cat, tools]) => (
              <div key={cat}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{cat}</span>
                  <span className="text-xs" style={{ color: 'var(--text-primary)' }}>${tools.reduce((s, t) => s + t.monthly_cost, 0)}</span>
                </div>
                {tools.map(t => (
                  <div key={t.name} className="flex items-center justify-between pl-3 py-0.5">
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.name}</span>
                    <span className="text-[10px]" style={{ color: t.monthly_cost === 0 ? 'var(--green)' : 'var(--text-faint)' }}>{t.monthly_cost === 0 ? 'Free' : `$${t.monthly_cost}`}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {archTab === 'decisions' && (
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Decisions ({archDecisions.length})</span>
            {archDecisions.length === 0 ? (
              <div className="text-center py-8"><GitBranch size={28} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} /><p className="text-xs" style={{ color: 'var(--text-faint)' }}>No decisions yet.</p></div>
            ) : archDecisions.map(d => (
              <div key={d.id} className="p-2.5 rounded-lg" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: d.status === 'accepted' ? 'var(--green)' : d.status === 'rejected' ? 'var(--red)' : 'var(--amber)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{d.title}</span>
                </div>
                <p className="text-[10px] pl-4" style={{ color: 'var(--text-muted)' }}>{d.context}</p>
              </div>
            ))}
          </div>
        )}

        {archTab === 'changelog' && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Timeline</span>
            {archChangelog.length === 0 ? <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>No events yet.</p>
              : archChangelog.map(e => (
                <div key={e.id} className="flex items-start gap-2 py-1.5">
                  <span className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ background: e.type === 'diagram' ? 'var(--blue)' : e.type === 'decision' ? 'var(--green)' : e.type === 'stack' ? 'var(--accent)' : 'var(--text-faint)' }} />
                  <div><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{e.label}</p><p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{new Date(e.timestamp).toLocaleTimeString()}</p></div>
                </div>
              ))}
          </div>
        )}

        {archTab === 'plot' && DiagramPanel}
      </div>
    </>
  );

  // ── Argument Ref Right Panel ──
  const ArgRefRightPanel = (
    <>
      <div className="flex overflow-x-auto no-scrollbar" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {SCORE_TABS.map(({ id, label }) => (
          <button key={id} onClick={() => setScoreTab(id)}
            className="px-3 py-2.5 text-[10px] font-bold tracking-wider whitespace-nowrap transition-colors cursor-pointer"
            style={{ color: scoreTab === id ? 'var(--accent)' : 'var(--text-faint)', borderBottom: scoreTab === id ? '2px solid var(--accent)' : '2px solid transparent' }}>
            {label}
          </button>
        ))}
        {!isMobile && <button onClick={() => setShowRightPanel(false)} className="ml-auto px-2 cursor-pointer" style={{ color: 'var(--text-faint)' }}><X size={14} /></button>}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {scoreTab === 'score' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Argument Health</span>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                style={{ background: 'var(--bg)', border: `2px solid ${scoreboard.health >= 75 ? '#4ade80' : scoreboard.health >= 45 ? '#f59e0b' : '#ef4444'}`, color: 'var(--text-primary)' }}>
                {scoreboard.grade}
              </div>
            </div>
            <div className="h-2 rounded-full" style={{ background: 'var(--bg)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${scoreboard.health}%`, background: scoreboard.health >= 75 ? '#4ade80' : scoreboard.health >= 45 ? '#f59e0b' : '#ef4444' }} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-2 rounded-lg" style={{ background: 'rgba(220,38,38,0.1)' }}>
                <p className="text-lg font-bold" style={{ color: '#f87171' }}>{fallacies.length}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>Fallacies</p>
              </div>
              <div className="p-2 rounded-lg" style={{ background: 'rgba(74,222,128,0.1)' }}>
                <p className="text-lg font-bold" style={{ color: '#4ade80' }}>{techniques.length}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>Techniques</p>
              </div>
            </div>
            {Object.entries(scoreboard.byType).map(([name, count]) => (
              <div key={name} className="flex items-center justify-between px-2 py-1 rounded" style={{ background: 'var(--bg)' }}>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{name}</span>
                <span className="text-xs font-bold" style={{ color: '#f87171' }}>{count}</span>
              </div>
            ))}
          </div>
        )}

        {scoreTab === 'structure' && (
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Contentions</span>
            {contentions.length === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>No contentions tracked yet.</p>
            ) : contentions.map(c => {
              const sc = STRENGTH_COLORS[c.strength] || STRENGTH_COLORS.moderate;
              return (
                <div key={c.id} className="p-2.5 rounded-lg" style={{ background: sc.bg, borderLeft: `3px solid ${sc.border}` }}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-bold uppercase" style={{ color: sc.border }}>{c.id}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${sc.border}20`, color: sc.border }}>{c.strength}</span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{c.text}</p>
                  {c.vulnerability && <p className="text-[10px] mt-0.5 italic" style={{ color: 'var(--text-faint)' }}>Vuln: {c.vulnerability}</p>}
                </div>
              );
            })}
          </div>
        )}

        {scoreTab === 'techniques' && (
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Techniques Used</span>
            {techniques.length === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>No techniques detected yet.</p>
            ) : techniques.map(t => {
              const c = TECHNIQUE_COLORS[t.quality] || TECHNIQUE_COLORS.weak;
              return (
                <div key={t.id} className="p-2.5 rounded-lg" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles size={12} style={{ color: c.border }} />
                    <span className="text-xs font-semibold" style={{ color: c.border }}>{t.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase" style={{ background: `${c.border}30`, color: c.border }}>{t.quality}</span>
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{t.feedback}</p>
                </div>
              );
            })}
          </div>
        )}

        {scoreTab === 'coach' && (
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Coach Tips</span>
            {debateAnalysis ? (
              <>
                {debateAnalysis.how_to_win.strongest_points.map((p, i) => (
                  <div key={i} className="p-2 rounded-lg" style={{ background: 'rgba(74,222,128,0.08)', borderLeft: '3px solid #4ade80' }}>
                    <p className="text-[10px] font-bold uppercase mb-0.5" style={{ color: '#4ade80' }}>Strength</p>
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{p}</p>
                  </div>
                ))}
                {debateAnalysis.how_to_win.weakest_links.map((p, i) => (
                  <div key={i} className="p-2 rounded-lg" style={{ background: 'rgba(220,38,38,0.08)', borderLeft: '3px solid #f87171' }}>
                    <p className="text-[10px] font-bold uppercase mb-0.5" style={{ color: '#f87171' }}>Weakness</p>
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{p}</p>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>Tips will appear as the debate progresses.</p>
            )}
          </div>
        )}

        {scoreTab === 'plot' && DiagramPanel}
      </div>
    </>
  );

  // ── Study Buddy Right Panel ──
  const StudyBuddyRightPanel = (
    <>
      <div className="flex" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button onClick={() => setStudyTab('transcript')}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
          style={{ color: studyTab === 'transcript' ? 'var(--accent)' : 'var(--text-faint)', borderBottom: studyTab === 'transcript' ? '2px solid var(--accent)' : '2px solid transparent' }}>
          <Volume2 size={12} />Transcript
        </button>
        <button onClick={() => setStudyTab('map')}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
          style={{ color: studyTab === 'map' ? 'var(--blue)' : 'var(--text-faint)', borderBottom: studyTab === 'map' ? '2px solid var(--blue)' : '2px solid transparent' }}>
          <Network size={12} />Map
        </button>
        {!isMobile && <button onClick={() => setShowRightPanel(false)} className="px-3 cursor-pointer" style={{ color: 'var(--text-faint)' }}><X size={16} /></button>}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {studyTab === 'transcript' ? (
          items.filter(i => i.type === 'speech').length === 0 ? (
            <div className="text-center py-12"><Volume2 size={32} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} /><p className="text-sm" style={{ color: 'var(--text-faint)' }}>Transcript appears here.</p></div>
          ) : (
            items.filter(i => i.type === 'speech').map(e => (
              <div key={e.id} className="mb-2 p-2 rounded-lg text-xs" style={{ background: e.speaker === 'user' ? 'var(--accent-muted)' : 'var(--bg)', border: `1px solid ${e.speaker === 'user' ? 'rgba(212,166,74,0.15)' : 'var(--border-subtle)'}` }}>
                <span className="text-[10px] font-medium opacity-60 block mb-0.5">{e.speaker === 'user' ? 'You' : 'AI'}</span>
                <span style={{ color: 'var(--text-primary)' }}>{e.text}</span>
              </div>
            ))
          )
        ) : DiagramPanel}
      </div>
    </>
  );

  // ── Thought Plot Right Panel ──
  const factCheckItems = items.filter(i => i.type === 'fact_check' && i.factCheck);
  const ThoughtPlotRightPanel = (
    <>
      <div className="flex overflow-x-auto no-scrollbar" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {TP_TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTpTab(id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
            style={{ color: tpTab === id ? '#c084fc' : 'var(--text-faint)', borderBottom: tpTab === id ? '2px solid #c084fc' : '2px solid transparent' }}>
            <Icon size={12} />{label}
            {id === 'checks' && factCheckItems.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: 'rgba(192,132,252,0.15)', color: '#c084fc' }}>{factCheckItems.length}</span>
            )}
          </button>
        ))}
        {!isMobile && <button onClick={() => setShowRightPanel(false)} className="px-3 cursor-pointer" style={{ color: 'var(--text-faint)' }}><X size={16} /></button>}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tpTab === 'controls' && (
          <div className="space-y-4">
            {/* Mode selector */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>Mode</div>
              <div className="grid grid-cols-2 gap-1.5">
                {TP_MODES.map(({ mode, label, icon: Icon }) => (
                  <button key={mode} onClick={() => handleTpModeChange(mode)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                    style={{
                      background: activeMode === mode ? 'rgba(192,132,252,0.12)' : 'var(--bg)',
                      border: `1px solid ${activeMode === mode ? 'rgba(192,132,252,0.3)' : 'var(--border-subtle)'}`,
                      color: activeMode === mode ? '#c084fc' : 'var(--text-secondary)',
                    }}>
                    <Icon size={14} />{label}
                  </button>
                ))}
              </div>
            </div>

            {/* Topic / Class inputs */}
            {(activeMode === 'topic_locked' || activeMode === 'study' || activeMode === 'quiz') && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>Topic</div>
                <input type="text" className="form-input text-xs w-full" placeholder="e.g. Nursing Pharmacology" value={topic} onChange={e => setTopic(e.target.value)} />
              </div>
            )}
            {activeMode === 'class_mode' && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>Class</div>
                <select className="form-select text-xs w-full" value={classId} onChange={e => setClassId(e.target.value)}>
                  <option value="">Select class</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

            {/* Voice toggle */}
            <button
              onClick={() => {
                const next = !tpVoiceEnabled;
                setTpVoiceEnabled(next);
                if (realtimeStatusRef.current === 'connected') {
                  updateSession(buildSystemPrompt('thought_plot', activeMode, getClassInfo(), { voiceEnabled: next }));
                }
              }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors cursor-pointer"
              style={{
                background: tpVoiceEnabled ? 'rgba(192,132,252,0.08)' : 'var(--bg)',
                border: `1px solid ${tpVoiceEnabled ? 'rgba(192,132,252,0.2)' : 'var(--border-subtle)'}`,
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0" style={{
                background: tpVoiceEnabled ? 'rgba(192,132,252,0.15)' : 'rgba(107,114,128,0.1)',
              }}>
                {tpVoiceEnabled ? <Volume2 size={16} style={{ color: '#c084fc' }} /> : <VolumeX size={16} style={{ color: 'var(--text-faint)' }} />}
              </div>
              <div className="flex-1 text-left">
                <div className="text-xs font-semibold" style={{ color: tpVoiceEnabled ? '#c084fc' : 'var(--text-secondary)' }}>
                  Voice {tpVoiceEnabled ? 'On' : 'Off'}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  {tpVoiceEnabled ? 'Gideon responds when asked directly' : 'Gideon stays completely silent'}
                </div>
              </div>
              <div className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors" style={{
                background: tpVoiceEnabled ? '#c084fc' : 'rgba(107,114,128,0.3)',
              }}>
                <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{
                  left: tpVoiceEnabled ? '18px' : '2px',
                }} />
              </div>
            </button>

            {/* Fact-check toggle */}
            <button
              onClick={() => setTpFactCheckEnabled(prev => !prev)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors cursor-pointer"
              style={{
                background: tpFactCheckEnabled ? 'rgba(192,132,252,0.08)' : 'var(--bg)',
                border: `1px solid ${tpFactCheckEnabled ? 'rgba(192,132,252,0.2)' : 'var(--border-subtle)'}`,
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0" style={{
                background: tpFactCheckEnabled ? 'rgba(192,132,252,0.15)' : 'rgba(107,114,128,0.1)',
              }}>
                {tpFactCheckEnabled ? <Shield size={16} style={{ color: '#c084fc' }} /> : <ShieldAlert size={16} style={{ color: 'var(--text-faint)' }} />}
              </div>
              <div className="flex-1 text-left">
                <div className="text-xs font-semibold" style={{ color: tpFactCheckEnabled ? '#c084fc' : 'var(--text-secondary)' }}>
                  Fact Check {tpFactCheckEnabled ? 'On' : 'Off'}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  {tpFactCheckEnabled ? 'Verifies claims against web sources' : 'No fact-checking — free thinking'}
                </div>
              </div>
              <div className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors" style={{
                background: tpFactCheckEnabled ? '#c084fc' : 'rgba(107,114,128,0.3)',
              }}>
                <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{
                  left: tpFactCheckEnabled ? '18px' : '2px',
                }} />
              </div>
            </button>
          </div>
        )}
        {tpTab === 'map' && DiagramPanel}
        {tpTab === 'checks' && (
          factCheckItems.length === 0 ? (
            <div className="text-center py-12">
              <Shield size={32} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No fact checks yet</p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>Start talking and claims will be verified</p>
            </div>
          ) : (
            <div className="space-y-2">
              {factCheckItems.map(fc => {
                const f = fc.factCheck!;
                const bad = f.status === 'incorrect';
                return (
                  <div key={fc.id} className="rounded-xl px-3 py-2.5" style={{
                    background: bad ? 'rgba(220,38,38,0.08)' : 'rgba(245,158,11,0.08)',
                    border: `1px solid ${bad ? 'rgba(220,38,38,0.2)' : 'rgba(245,158,11,0.2)'}`,
                  }}>
                    <div className="flex items-center gap-2 mb-1">
                      {bad ? <AlertTriangle size={12} style={{ color: '#dc2626' }} /> : <AlertCircle size={12} style={{ color: '#f59e0b' }} />}
                      <span className="text-[10px] font-bold uppercase" style={{ color: bad ? '#fca5a5' : '#fde68a' }}>{f.status}</span>
                      <span className="text-[9px] ml-auto" style={{ color: 'var(--text-faint)' }}>{Math.round((f.confidence || 0) * 100)}%</span>
                    </div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>&ldquo;{f.claim}&rdquo;</p>
                    {f.correction && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{f.correction}</p>}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </>
  );

  // ── Determine which right panel to show ──
  const rightPanelContent = activeTool === 'architect' ? ArchitectRightPanel
    : activeTool === 'argument_ref' ? ArgRefRightPanel
    : activeTool === 'study_buddy' ? StudyBuddyRightPanel
    : activeTool === 'thought_plot' ? ThoughtPlotRightPanel
    : activeMermaid ? DiagramPanel : null;

  const shouldShowPanel = showRightPanel && rightPanelContent;

  // ── Tool-specific header ──
  const ToolHeader = (() => {
    if (activeTool === 'study_buddy') {
      return (
        <div className="px-3 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
          {STUDY_MODES.map(({ mode, label, icon: Icon }) => (
            <button key={mode} onClick={() => handleStudyModeChange(mode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors cursor-pointer flex-shrink-0"
              style={{ background: activeMode === mode ? 'var(--accent-muted)' : 'transparent', border: `1px solid ${activeMode === mode ? 'rgba(212,166,74,0.3)' : 'var(--border-subtle)'}`, color: activeMode === mode ? 'var(--accent)' : 'var(--text-muted)' }}>
              <Icon size={14} />{label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            <select className="form-select text-xs" value={classId} onChange={e => setClassId(e.target.value)} style={{ maxWidth: 120 }}>
              <option value="">No class</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="text" className="form-input text-xs" placeholder="Topic..." value={topic} onChange={e => setTopic(e.target.value)} style={{ maxWidth: 120 }} />
          </div>
        </div>
      );
    }

    if (activeTool === 'argument_ref') {
      return (
        <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
          {(['referee', 'harvey'] as const).map(mode => (
            <button key={mode} onClick={() => handleArgModeChange(mode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer"
              style={{ background: argMode === mode ? (mode === 'harvey' ? 'rgba(212,166,74,0.15)' : 'rgba(220,38,38,0.15)') : 'transparent',
                border: `1px solid ${argMode === mode ? (mode === 'harvey' ? 'rgba(212,166,74,0.3)' : 'rgba(220,38,38,0.3)') : 'var(--border-subtle)'}`,
                color: argMode === mode ? (mode === 'harvey' ? 'var(--accent)' : '#f87171') : 'var(--text-muted)' }}>
              {mode === 'harvey' ? <Swords size={14} /> : <Scale size={14} />}
              {mode === 'referee' ? 'Referee' : 'Harvey Specter'}
            </button>
          ))}
        </div>
      );
    }

    if (activeTool === 'thought_plot') {
      const currentTpMode = TP_MODES.find(m => m.mode === activeMode);
      const CurrentIcon = currentTpMode?.icon || Map;
      return (
        <div className="px-3 py-2 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-6 h-6 rounded-md" style={{ background: 'rgba(192,132,252,0.15)' }}>
              <CurrentIcon size={13} style={{ color: '#c084fc' }} />
            </div>
            <span className="text-xs font-semibold" style={{ color: '#c084fc' }}>
              Thought Plot {currentTpMode ? `\u00b7 ${currentTpMode.label}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            {tpVoiceEnabled && <Volume2 size={12} style={{ color: 'var(--text-faint)' }} />}
            {tpFactCheckEnabled && <Shield size={12} style={{ color: 'var(--text-faint)' }} />}
          </div>
        </div>
      );
    }

    if (activeTool === 'architect' && archStack.length > 0) {
      return (
        <div className="px-3 py-2 flex items-center gap-4 text-xs overflow-x-auto no-scrollbar" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--green)' }} />
            {!isMobile && <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Architecture</span>}
          </div>
          <span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{archStack.length} tools</span>
          <span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>${totalMonthlyCost}/mo</span>
          <button onClick={handleExportPrompt}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex-shrink-0"
            style={{ background: promptCopied ? 'rgba(34,197,94,0.15)' : 'transparent', border: `1px solid ${promptCopied ? 'rgba(34,197,94,0.3)' : 'var(--border-subtle)'}`, color: promptCopied ? 'var(--green)' : 'var(--text-muted)' }}>
            {promptCopied ? <Check size={12} /> : <FileText size={12} />}
            {promptCopied ? 'Copied!' : 'Export'}
          </button>
        </div>
      );
    }

    return null;
  })();

  // ─── Main Render ───
  return (
    <div className="flex flex-col h-screen">
      {ToolHeader}

      {/* Error banner */}
      {errorBanner && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ background: 'rgba(220,38,38,0.12)', borderBottom: '1px solid rgba(220,38,38,0.3)', color: '#fca5a5' }}>
          <AlertCircle size={14} style={{ color: '#dc2626', flexShrink: 0 }} />
          <span className="flex-1">{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="p-1 rounded cursor-pointer" style={{ color: '#fca5a5' }}><X size={12} /></button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        {!isMobile && sidebarOpen && (
          <div className="w-72 flex-shrink-0 flex flex-col" style={{ background: 'var(--surface)', borderRight: '1px solid var(--border-subtle)' }}>
            <div className="px-3 pt-3 pb-2">
              <button onClick={() => { handleNewChat(); setSidebarOpen(false); }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                style={{ background: 'rgba(212,166,74,0.1)', border: '1px solid rgba(212,166,74,0.2)', color: 'var(--accent)' }}>
                <Plus size={15} />New Chat
              </button>
            </div>
            <SessionHistory tool="all" onSelectSession={handleRestoreSession} onClose={() => setSidebarOpen(false)} />
          </div>
        )}

        {/* Mobile sidebar overlay */}
        {isMobile && sidebarOpen && (
          <>
            <div className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
            <div className="fixed left-0 top-0 bottom-0 z-[65] w-72 flex flex-col animate-slide-in-left"
              style={{ background: 'var(--surface)' }}>
              <div className="px-3 pt-3 pb-2">
                <button onClick={() => { handleNewChat(); setSidebarOpen(false); }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  style={{ background: 'rgba(212,166,74,0.1)', border: '1px solid rgba(212,166,74,0.2)', color: 'var(--accent)' }}>
                  <Plus size={15} />New Chat
                </button>
              </div>
              <SessionHistory tool="all" onSelectSession={handleRestoreSession} onClose={() => setSidebarOpen(false)} />
            </div>
          </>
        )}

        {/* Chat area */}
        <div className="flex-1 flex flex-col" style={{ background: 'var(--bg)' }}>
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
            {items.length === 0 ? WelcomeScreen : (
              <>
                {items.map(renderItem)}

                {toolSwitching && (
                  <div className="flex items-center gap-3 mb-3 animate-fade-in">
                    <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />
                    <span className="text-xs" style={{ color: 'var(--accent)' }}>
                      Switching to {activeTool ? (TOOL_LABELS[activeTool] || activeTool) : 'general chat'}...
                    </span>
                  </div>
                )}

                {aiStatus === 'thinking' && !toolSwitching && (
                  <div className="flex items-center gap-3 mb-3 animate-fade-in">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)', animation: 'gideon-dot 1.4s ease-in-out infinite' }} />
                      <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)', animation: 'gideon-dot 1.4s ease-in-out 0.2s infinite' }} />
                      <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)', animation: 'gideon-dot 1.4s ease-in-out 0.4s infinite' }} />
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      {activeTool ? `${TOOL_LABELS[activeTool] || 'Gideon'} is thinking...` : 'Gideon is thinking...'}
                    </span>
                  </div>
                )}

                <div ref={transcriptEndRef} />
              </>
            )}
          </div>

          {/* Input bar */}
          <div className="px-3 sm:px-4 py-2" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
            {ToolBadge && <div className="flex items-center mb-2">{ToolBadge}</div>}
            {!activeTool && classes.length > 0 && (
              <div className="flex items-center gap-2 mb-2 overflow-x-auto no-scrollbar">
                <span className="text-[10px] font-semibold uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--text-faint)' }}>Class:</span>
                <button
                  onClick={() => setClassId('')}
                  className="px-2 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer flex-shrink-0"
                  style={{
                    background: !classId ? 'var(--accent-muted)' : 'transparent',
                    border: `1px solid ${!classId ? 'rgba(212,166,74,0.2)' : 'var(--border-subtle)'}`,
                    color: !classId ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >General</button>
                {classes.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setClassId(c.id)}
                    className="px-2 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer flex-shrink-0"
                    style={{
                      background: classId === c.id ? 'var(--accent-muted)' : 'transparent',
                      border: `1px solid ${classId === c.id ? 'rgba(212,166,74,0.2)' : 'var(--border-subtle)'}`,
                      color: classId === c.id ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >{c.name}</button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2.5 rounded-lg transition-colors flex-shrink-0 cursor-pointer"
                style={{
                  background: sidebarOpen ? 'var(--accent-muted)' : 'transparent',
                  border: `1px solid ${sidebarOpen ? 'rgba(212,166,74,0.2)' : 'var(--border-subtle)'}`,
                  color: sidebarOpen ? 'var(--accent)' : 'var(--text-muted)',
                  minHeight: 44, minWidth: 44,
                }}
                title="Session history">
                <History size={18} />
              </button>

              {items.length > 0 && (
                <div className="relative flex-shrink-0">
                  <button onClick={() => setShowExportMenu(prev => !prev)}
                    className="p-2.5 rounded-lg transition-colors cursor-pointer"
                    style={{
                      background: showExportMenu ? 'rgba(212,166,74,0.1)' : 'transparent',
                      border: `1px solid ${showExportMenu ? 'rgba(212,166,74,0.2)' : 'var(--border-subtle)'}`,
                      color: showExportMenu ? 'var(--accent)' : 'var(--text-muted)',
                      minHeight: 44, minWidth: 44,
                    }}
                    title="Export transcript">
                    <Download size={18} />
                  </button>
                  {showExportMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                      <div className="absolute bottom-full mb-2 right-0 z-50 rounded-xl py-1.5 min-w-[180px] shadow-xl"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}>
                        <button
                          onClick={() => { handleDownloadSession(true); setShowExportMenu(false); }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium transition-colors cursor-pointer"
                          style={{ color: 'var(--text-secondary)' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(212,166,74,0.08)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                        >
                          <MessageCircle size={14} />
                          Full Conversation
                        </button>
                        <button
                          onClick={() => { handleDownloadSession(false); setShowExportMenu(false); }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium transition-colors cursor-pointer"
                          style={{ color: 'var(--text-secondary)' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(212,166,74,0.08)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                        >
                          <Mic size={14} />
                          Your Words Only
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* New Chat — always visible */}
              <button onClick={handleNewChat}
                className="flex items-center gap-1.5 rounded-lg transition-colors flex-shrink-0 cursor-pointer"
                style={{
                  padding: items.length > 0 ? '0 12px' : '0 10px',
                  background: items.length > 0 ? 'rgba(212,166,74,0.1)' : 'transparent',
                  border: `1px solid ${items.length > 0 ? 'rgba(212,166,74,0.25)' : 'var(--border-subtle)'}`,
                  color: items.length > 0 ? 'var(--accent)' : 'var(--text-muted)',
                  minHeight: 44,
                }}
                title="New chat">
                <Plus size={16} />
                {!isMobile && items.length > 0 && <span className="text-xs font-medium">New</span>}
              </button>

              <button onClick={handleToggleMic}
                className="p-2.5 rounded-lg transition-colors relative flex-shrink-0"
                style={{
                  background: realtimeStatus === 'connected' ? 'var(--red-muted)' : realtimeStatus === 'connecting' ? 'rgba(212,166,74,0.15)' : 'transparent',
                  border: `1px solid ${realtimeStatus === 'connected' ? 'rgba(204,80,64,0.3)' : realtimeStatus === 'connecting' ? 'rgba(212,166,74,0.3)' : 'var(--border-subtle)'}`,
                  color: realtimeStatus === 'connected' ? 'var(--red)' : realtimeStatus === 'connecting' ? 'var(--accent)' : 'var(--text-muted)',
                  minHeight: 44, minWidth: 44,
                }}>
                {realtimeStatus === 'connecting' ? <Loader2 size={18} className="animate-spin" /> : realtimeStatus === 'connected' ? <MicOff size={18} /> : <Mic size={18} />}
              </button>

              <form onSubmit={handleTextSubmit} className="flex-1 flex items-center gap-2">
                <input type="text" className="form-input text-sm"
                  placeholder={activeTool ? `Talk to ${TOOL_LABELS[activeTool] || 'Gideon'}...` : 'Talk to Gideon...'}
                  value={textInput} onChange={e => setTextInput(e.target.value)} />
                <button type="submit" disabled={!textInput.trim()} className="btn-primary px-3 py-2" style={{ minHeight: 44 }}><Send size={16} /></button>
              </form>

              {sessionActive && (
                <div className="flex items-center gap-1 sm:gap-2">
                  <button onClick={handleVoiceToggle}
                    className="p-2 rounded-lg transition-colors cursor-pointer"
                    style={{ background: voiceEnabled ? 'transparent' : 'rgba(204,80,64,0.15)', border: `1px solid ${voiceEnabled ? 'var(--border-subtle)' : 'rgba(204,80,64,0.3)'}`, color: voiceEnabled ? 'var(--text-muted)' : 'var(--red)', minHeight: 44, minWidth: 44 }}
                    title={voiceEnabled ? 'Mute AI voice' : 'Unmute AI voice'}>
                    {voiceEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  </button>
                  <button onClick={handleEndSession} className="btn-danger text-sm" style={{ minHeight: 44 }}>
                    <Square size={14} />{!isMobile && ' End'}
                  </button>
                </div>
              )}

              {/* Panel toggle buttons */}
              {!isMobile && activeTool && (activeTool === 'architect' || activeTool === 'argument_ref' || activeTool === 'study_buddy' || activeTool === 'thought_plot') && (
                <button onClick={() => setShowRightPanel(!showRightPanel)}
                  className="p-2 rounded-lg transition-colors cursor-pointer"
                  style={{ background: showRightPanel ? 'var(--accent-muted)' : 'transparent', border: `1px solid ${showRightPanel ? 'rgba(212,166,74,0.2)' : 'var(--border-subtle)'}`, color: showRightPanel ? 'var(--accent)' : 'var(--text-muted)' }}>
                  <Layers size={14} />
                </button>
              )}
              {!isMobile && !activeTool && activeMermaid && (
                <button onClick={() => setShowRightPanel(!showRightPanel)}
                  className="p-2 rounded-lg transition-colors cursor-pointer"
                  style={{ background: showRightPanel ? 'var(--accent-muted)' : 'transparent', border: `1px solid ${showRightPanel ? 'rgba(212,166,74,0.2)' : 'var(--border-subtle)'}`, color: showRightPanel ? 'var(--accent)' : 'var(--text-muted)' }}>
                  <Network size={14} />
                </button>
              )}

              {/* Mobile panel button */}
              {isMobile && (activeTool || activeMermaid) && (
                <button onClick={() => setMobileSheetOpen(true)}
                  className="p-2 rounded-lg transition-colors cursor-pointer"
                  style={{ background: 'var(--accent-muted)', border: '1px solid rgba(212,166,74,0.2)', color: 'var(--accent)', minHeight: 44, minWidth: 44 }}>
                  {activeTool ? <PanelRight size={14} /> : <Network size={14} />}
                </button>
              )}
            </div>

            {/* Status indicator */}
            {realtimeStatus === 'connected' && (
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`status-dot ${aiStatus}`} />
                <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  {aiStatus === 'listening' ? 'Listening...' : aiStatus === 'thinking' ? 'Processing...' : aiStatus === 'speaking' ? 'Speaking...' : 'Connected'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Desktop right panel */}
        {!isMobile && shouldShowPanel && (
          <div className="w-80 flex-shrink-0 flex flex-col" style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border-subtle)' }}>
            {rightPanelContent}
          </div>
        )}
      </div>

      {/* Mobile bottom sheet */}
      {isMobile && mobileSheetOpen && rightPanelContent && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={() => setMobileSheetOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-[70] flex flex-col animate-slide-up"
            style={{ background: 'var(--surface)', borderTop: '1px solid var(--border-subtle)', borderRadius: '16px 16px 0 0', height: '70vh', maxHeight: 600 }}>
            <div className="flex justify-center py-2">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
            </div>
            <button onClick={() => setMobileSheetOpen(false)} className="absolute top-3 right-3 p-1.5 rounded-lg cursor-pointer" style={{ color: 'var(--text-faint)' }}>
              <ChevronUp size={18} />
            </button>
            {rightPanelContent}
          </div>
        </>
      )}

      <style>{`
        @keyframes gideon-breathe {
          0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.7; transform: translate(-50%, -50%) scale(1.15); }
        }
        @keyframes gideon-dot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes slide-in-left {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-left {
          animation: slide-in-left 0.25s ease-out;
        }
      `}</style>
    </div>
  );
}
