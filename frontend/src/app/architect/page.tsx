'use client';

import { useEffect, useRef, useState, useCallback, Fragment, useMemo } from 'react';
import { WS_BASE } from '@/lib/api';
import {
  Mic,
  MicOff,
  Send,
  Plus,
  Search,
  Layers,
  Package,
  CheckSquare,
  Activity,
  DollarSign,
  GitBranch,
  Clock,
  Square,
  Volume2,
  VolumeX,
  Pause,
  Network,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  Shield,
  Server,
  Zap,
  Settings,
  TrendingDown,
  Crown,
  Maximize2,
  Minimize2,
  AlertTriangle,
  XCircle,
  FileText,
  Copy,
  Check,
  PanelRight,
  Menu as MenuIcon,
  Award,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useSpeechRecognition } from '@/lib/useSpeechRecognition';
import { useAudioPlayback } from '@/lib/useAudioPlayback';
import { MermaidExport } from '@/components/MermaidExport';
import { useIsMobile } from '@/lib/useIsMobile';
import type {
  TranscriptEntry,
  WebSocketIncoming,
  StackTool,
  ChecklistItem,
  HealthScores,
  ArchDecision,
  ChangelogEntry,
  SessionDetail,
  FactCheckNotification,
  ArchitectureReview,
} from '@/lib/types';
import { SessionHistory } from '@/components/SessionHistory';

type PanelTab = 'architecture' | 'stack' | 'checklist' | 'health' | 'costs' | 'decisions' | 'changelog' | 'review' | 'plot';
type AIStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Simple markdown → React elements for AI messages. Handles bold, headers, bullets, code. */
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let key = 0;

  const inlineFormat = (line: string): React.ReactNode => {
    // Bold, inline code, and plain text
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIndex = 0;
    let match;
    let pk = 0;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
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
    if (!trimmed) {
      flushList();
      continue;
    }

    // Headers
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <p key={key++} className="text-xs font-bold uppercase tracking-wider mt-2 mb-1"
          style={{ color: 'var(--accent)' }}>
          {trimmed.slice(3)}
        </p>
      );
    } else if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <p key={key++} className="text-sm font-bold mt-2 mb-1" style={{ color: 'var(--text-primary)' }}>
          {trimmed.slice(2)}
        </p>
      );
    }
    // Bullets
    else if (/^[-*]\s/.test(trimmed)) {
      listItems.push(
        <li key={key++} className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          {inlineFormat(trimmed.replace(/^[-*]\s+/, ''))}
        </li>
      );
    }
    // Numbered list
    else if (/^\d+\.\s/.test(trimmed)) {
      flushList();
      elements.push(
        <p key={key++} className="text-sm leading-relaxed pl-2" style={{ color: 'var(--text-primary)' }}>
          {inlineFormat(trimmed)}
        </p>
      );
    }
    // Regular paragraph
    else {
      flushList();
      elements.push(
        <p key={key++} className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          {inlineFormat(trimmed)}
        </p>
      );
    }
  }
  flushList();
  return elements;
}

interface ConversationSession {
  id: string;
  title: string;
  timestamp: number;
}

export default function ArchitectPage() {
  const isMobile = useIsMobile();

  // Mobile panel state
  const [showLeftPanel, setShowLeftPanel] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);

  // Session state
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [sessionActive, setSessionActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // Chat state
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [textInput, setTextInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIStatus>('idle');
  const [interimText, setInterimText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [optionCards, setOptionCards] = useState<{ title: string; description: string }[]>([]);

  // Architecture state (right panel)
  const [stack, setStack] = useState<StackTool[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [health, setHealth] = useState<HealthScores>({
    scalability: 1, security: 1, cost_efficiency: 1, maintainability: 1, reliability: 1,
  });
  const [decisions, setDecisions] = useState<ArchDecision[]>([]);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<PanelTab>('architecture');
  const [review, setReview] = useState<ArchitectureReview | null>(null);

  // Cost optimization mode
  const [costMode, setCostMode] = useState<'cheapest' | 'best' | 'all'>('all');

  // Fact-check notifications
  const [factChecks, setFactChecks] = useState<FactCheckNotification[]>([]);
  const [unreadFcCount, setUnreadFcCount] = useState(0);
  const [showFactPanel, setShowFactPanel] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Diagram
  const [mermaidCode, setMermaidCode] = useState('');
  // showDiagram removed — diagram lives in PLOT tab now
  const [zoom, setZoom] = useState(1);
  const [diagramFullscreen, setDiagramFullscreen] = useState(false);
  const mermaidContainerRef = useRef<HTMLDivElement>(null);
  const mermaidFullscreenRef = useRef<HTMLDivElement>(null);
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
        const id = `mermaid-arch-${Date.now()}`;
        const { svg } = await m.default.render(id, mermaidCode);
        if (mermaidContainerRef.current) {
          mermaidContainerRef.current.innerHTML = svg;
        }
        if (mermaidFullscreenRef.current) {
          const id2 = `mermaid-arch-fs-${Date.now()}`;
          const { svg: svg2 } = await m.default.render(id2, mermaidCode);
          mermaidFullscreenRef.current.innerHTML = svg2;
        }
      } catch { /* diagram parse error */ }
    });
  }, [mermaidCode, activeTab, diagramFullscreen]);

  const addTranscriptEntry = useCallback((speaker: 'user' | 'ai', text: string) => {
    setTranscript((prev) => [
      ...prev,
      { id: crypto.randomUUID(), session_id: '', speaker, text, timestamp_ms: Date.now() },
    ]);
  }, []);

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(`${WS_BASE}/ws/study-session`);

    ws.onopen = () => console.log('Architect WebSocket connected');

    ws.onmessage = (event) => {
      try {
        const data: WebSocketIncoming = JSON.parse(event.data);

        if (data.type === 'ai_response') {
          // Stop any currently playing audio — new response preempts old
          stopAudio();
          if (ttsRecoveryRef.current) { clearTimeout(ttsRecoveryRef.current); ttsRecoveryRef.current = null; }

          setAiStatus('speaking');
          addTranscriptEntry('ai', data.text);
          setSuggestions(data.suggestions || []);
          setOptionCards(data.option_cards || []);

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
        } else if (data.type === 'architecture_state' && data.panel) {
          const p = data.panel;
          if (p.stack?.length) setStack(p.stack);
          if (p.checklist?.length) setChecklist(p.checklist);
          if (p.health) setHealth(p.health);
          if (p.decisions?.length) setDecisions(p.decisions);
          if (p.changelog_entry) {
            setChangelog((prev) => [
              { id: crypto.randomUUID(), type: 'message', label: p.changelog_entry, timestamp: Date.now() },
              ...prev,
            ]);
          }
          if (p.review?.requested) {
            const rev = p.review;
            setReview(rev);
            setActiveTab('review');
            setChangelog((prev) => [
              { id: crypto.randomUUID(), type: 'message', label: `Architecture reviewed: ${rev.overall_grade}`, timestamp: Date.now() },
              ...prev,
            ]);
          }
        } else if (data.type === 'plot_update' && data.graph?.mermaid_code) {
          setMermaidCode(data.graph.mermaid_code);
          setActiveTab('plot');
          setChangelog((prev) => [
            { id: crypto.randomUUID(), type: 'diagram', label: 'Architecture diagram updated', timestamp: Date.now() },
            ...prev,
          ]);
        } else if (data.type === 'fact_check') {
          const notification: FactCheckNotification = {
            ...data,
            timestamp: Date.now(),
            read: false,
          };
          setFactChecks((prev) => [notification, ...prev]);
          setUnreadFcCount((prev) => prev + 1);
        }
      } catch { /* invalid message */ }
    };

    ws.onclose = () => console.log('Architect WebSocket disconnected');
    ws.onerror = () => console.log('Architect WebSocket error');
    wsRef.current = ws;
  }, [addTranscriptEntry, playPcmAudio]);

  // Send message
  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    if (!sessionActive) {
      setSessionActive(true);
      setTranscript([]);
      setStack([]);
      setDecisions([]);
      setChangelog([]);
      setMermaidCode('');
      connectWebSocket();
      const newSession: ConversationSession = {
        id: crypto.randomUUID(),
        title: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
        timestamp: Date.now(),
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
    }

    addTranscriptEntry('user', text);
    setAiStatus('thinking');
    setSuggestions([]);
    setOptionCards([]);

    // Wait briefly for WebSocket to connect if just started
    const send = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'transcript',
          text,
          mode: 'general',
          tool: 'architect',
        }));
      } else {
        setTimeout(send, 200);
      }
    };
    send();
  }, [sessionActive, addTranscriptEntry, connectWebSocket]);

  // Speech — interrupt AI audio when user speaks
  const handleSpeechResult = useCallback((finalText: string) => {
    stopAudio();
    sendMessage(finalText);
  }, [sendMessage, stopAudio]);

  const { start: startListening, stop: stopListening, error: speechError, retryCount } = useSpeechRecognition({
    onResult: handleSpeechResult,
    onInterim: setInterimText,
    aiSpeakingRef,
  });

  // Stable refs for start/stop so WebSocket callback can pause/resume mic
  const startListeningRef = useRef(startListening);
  startListeningRef.current = startListening;
  const stopListeningRef = useRef(stopListening);
  stopListeningRef.current = stopListening;

  function handleToggleMic() {
    if (isRecording) {
      setIsRecording(false);
      setIsPaused(false);
      setAiStatus('idle');
      setInterimText('');
      stopListening();
    } else {
      if (!sessionActive) {
        setSessionActive(true);
        connectWebSocket();
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

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim()) return;
    sendMessage(textInput.trim());
    setTextInput('');
  }

  function handleEndSession() {
    setSessionActive(false);
    setIsRecording(false);
    setIsPaused(false);
    setAiStatus('idle');
    setInterimText('');
    stopListening();
    stopAudio();
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
  }

  function handleNewArchitecture() {
    handleEndSession();
    setTranscript([]);
    setStack([]);
    setChecklist([]);
    setHealth({ scalability: 1, security: 1, cost_efficiency: 1, maintainability: 1, reliability: 1 });
    setDecisions([]);
    setChangelog([]);
    setMermaidCode('');
    setSuggestions([]);
    setOptionCards([]);
    setActiveSessionId('');
    setReview(null);
  }

  // Auto-dismiss fact-check toast after 8 seconds
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
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, [factChecks]);

  useEffect(() => {
    return () => {
      stopListening();
      stopAudio();
      if (wsRef.current) wsRef.current.close();
    };
  }, [stopListening, stopAudio]);

  // Computed values
  const totalMonthlyCost = stack.reduce((sum, t) => sum + t.monthly_cost, 0);
  const freeToolsCount = stack.filter((t) => t.monthly_cost === 0).length;
  const checkedCount = checklist.filter((c) => c.discussed).length;
  const overallHealth = health
    ? ((health.scalability + health.security + health.cost_efficiency + health.maintainability + health.reliability) / 5).toFixed(1)
    : '0.0';
  const healthGrade = Number(overallHealth) >= 4 ? 'A' : Number(overallHealth) >= 3 ? 'B' : Number(overallHealth) >= 2 ? 'C' : 'D';

  // Filter stack by cost mode — deduplicate by purpose
  const filteredStack = (() => {
    if (costMode === 'all') return stack;
    // Group by purpose, pick the right tier
    const byPurpose: Record<string, StackTool[]> = {};
    for (const tool of stack) {
      const key = tool.purpose || tool.category || tool.name;
      if (!byPurpose[key]) byPurpose[key] = [];
      byPurpose[key].push(tool);
    }
    const result: StackTool[] = [];
    for (const tools of Object.values(byPurpose)) {
      if (costMode === 'cheapest') {
        // Pick 'budget' or 'both'; if neither, pick cheapest by cost
        const budget = tools.find((t) => t.cost_tier === 'budget' || t.cost_tier === 'both');
        result.push(budget || tools.reduce((a, b) => a.monthly_cost <= b.monthly_cost ? a : b));
      } else {
        // 'best' — pick 'premium' or 'both'; if neither, pick most expensive
        const premium = tools.find((t) => t.cost_tier === 'premium' || t.cost_tier === 'both');
        result.push(premium || tools.reduce((a, b) => a.monthly_cost >= b.monthly_cost ? a : b));
      }
    }
    return result;
  })();

  const filteredMonthlyCost = filteredStack.reduce((sum, t) => sum + t.monthly_cost, 0);
  const budgetTotal = (() => {
    const byPurpose: Record<string, StackTool[]> = {};
    for (const tool of stack) {
      const key = tool.purpose || tool.category || tool.name;
      if (!byPurpose[key]) byPurpose[key] = [];
      byPurpose[key].push(tool);
    }
    let total = 0;
    for (const tools of Object.values(byPurpose)) {
      const budget = tools.find((t) => t.cost_tier === 'budget' || t.cost_tier === 'both');
      total += (budget || tools.reduce((a, b) => a.monthly_cost <= b.monthly_cost ? a : b)).monthly_cost;
    }
    return total;
  })();
  const premiumTotal = (() => {
    const byPurpose: Record<string, StackTool[]> = {};
    for (const tool of stack) {
      const key = tool.purpose || tool.category || tool.name;
      if (!byPurpose[key]) byPurpose[key] = [];
      byPurpose[key].push(tool);
    }
    let total = 0;
    for (const tools of Object.values(byPurpose)) {
      const premium = tools.find((t) => t.cost_tier === 'premium' || t.cost_tier === 'both');
      total += (premium || tools.reduce((a, b) => a.monthly_cost >= b.monthly_cost ? a : b)).monthly_cost;
    }
    return total;
  })();
  const savings = premiumTotal - budgetTotal;

  // Group stack by category
  const stackByCategory: Record<string, StackTool[]> = {};
  for (const tool of stack) {
    const cat = tool.category || 'Other';
    if (!stackByCategory[cat]) stackByCategory[cat] = [];
    stackByCategory[cat].push(tool);
  }

  // Group checklist by category
  const checklistByCategory: Record<string, ChecklistItem[]> = {};
  for (const item of checklist) {
    const cat = item.category || 'Other';
    if (!checklistByCategory[cat]) checklistByCategory[cat] = [];
    checklistByCategory[cat].push(item);
  }

  // Cost breakdown by category (uses filteredStack for cost mode)
  const filteredByCategory: Record<string, StackTool[]> = {};
  for (const tool of filteredStack) {
    const cat = tool.category || 'Other';
    if (!filteredByCategory[cat]) filteredByCategory[cat] = [];
    filteredByCategory[cat].push(tool);
  }
  const costByCategory: { name: string; tools: { name: string; cost: number; tier: string }[]; total: number }[] = [];
  for (const [cat, tools] of Object.entries(filteredByCategory)) {
    const total = tools.reduce((s, t) => s + t.monthly_cost, 0);
    costByCategory.push({
      name: cat,
      tools: tools.map((t) => ({ name: t.name, cost: t.monthly_cost, tier: t.cost_tier || 'both' })),
      total,
    });
  }
  costByCategory.sort((a, b) => b.total - a.total);

  const tabConfig: { id: PanelTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'architecture', label: 'ARCH', icon: Layers },
    { id: 'stack', label: 'STACK', icon: Package },
    { id: 'checklist', label: 'CHECK', icon: CheckSquare },
    { id: 'health', label: 'HEALTH', icon: Activity },
    { id: 'costs', label: 'COSTS', icon: DollarSign },
    { id: 'decisions', label: 'DECIDE', icon: GitBranch },
    { id: 'changelog', label: 'LOG', icon: Clock },
    { id: 'review', label: 'REVIEW', icon: Award },
    { id: 'plot', label: 'PLOT', icon: Network },
  ];

  const difficultyColor = (d: string) =>
    d === 'Easy' ? 'var(--green)' : d === 'Medium' ? 'var(--amber)' : 'var(--red)';

  const healthBarColor = (score: number) =>
    score >= 4 ? 'var(--green)' : score >= 3 ? 'var(--amber)' : 'var(--red)';

  const gradeColor = (grade: string) => {
    const g = grade.charAt(0);
    if (g === 'A') return 'var(--green)';
    if (g === 'B') return 'var(--blue)';
    if (g === 'C') return 'var(--amber)';
    return 'var(--red)';
  };

  const impactColor = (impact: string) => {
    if (impact === 'critical') return 'var(--red)';
    if (impact === 'high') return 'var(--amber)';
    if (impact === 'medium') return 'var(--blue)';
    return 'var(--text-faint)';
  };

  const effortColor = (effort: string) => {
    if (effort === 'easy') return 'var(--green)';
    if (effort === 'medium') return 'var(--amber)';
    return 'var(--red)';
  };

  // One-shot prompt export
  const [promptCopied, setPromptCopied] = useState(false);
  const handleExportPrompt = useCallback(async () => {
    const lines: string[] = [];
    // Title from first user message
    const firstUser = transcript.find((t) => t.speaker === 'user');
    const topic = firstUser?.text.slice(0, 80) || 'Architecture Plan';
    lines.push(`# Architecture Specification: ${topic}`);
    lines.push('');

    if (stack.length > 0) {
      lines.push('## Technology Stack');
      for (const tool of stack) {
        lines.push(`- **${tool.name}** (${tool.category}) — ${tool.description}${tool.monthly_cost > 0 ? ` [$${tool.monthly_cost}/mo]` : ' [Free]'}`);
        if (tool.reason) lines.push(`  Reason: ${tool.reason}`);
      }
      lines.push('');
    }

    if (decisions.length > 0) {
      lines.push('## Architecture Decisions');
      for (const d of decisions) {
        lines.push(`- **${d.title}** [${d.status}]: ${d.context}`);
      }
      lines.push('');
    }

    if (mermaidCode) {
      lines.push('## System Diagram');
      lines.push('```mermaid');
      lines.push(mermaidCode);
      lines.push('```');
      lines.push('');
    }

    if (health) {
      lines.push('## Health Assessment');
      lines.push(`- Scalability: ${health.scalability}/5`);
      lines.push(`- Security: ${health.security}/5`);
      lines.push(`- Cost Efficiency: ${health.cost_efficiency}/5`);
      lines.push(`- Maintainability: ${health.maintainability}/5`);
      lines.push(`- Reliability: ${health.reliability}/5`);
      lines.push(`- Overall: ${overallHealth}/5 (${healthGrade})`);
      lines.push('');
    }

    if (review && review.overall_grade && review.overall_grade !== '?') {
      lines.push('## Architecture Review');
      lines.push(`- **Overall Grade: ${review.overall_grade} (${review.overall_score}/100)**`);
      for (const [key, cat] of Object.entries(review.categories)) {
        lines.push(`- ${key.replace(/_/g, ' ')}: ${(cat as { grade: string; score: number }).grade} (${(cat as { grade: string; score: number }).score}/100)`);
      }
      lines.push('');
      if (review.strengths.length > 0) {
        lines.push('### Strengths');
        for (const s of review.strengths) lines.push(`- **${s.title}**: ${s.description}`);
        lines.push('');
      }
      if (review.weaknesses.length > 0) {
        lines.push('### Weaknesses');
        for (const w of review.weaknesses) lines.push(`- **${w.title}**${w.anti_pattern ? ` [${w.anti_pattern}]` : ''}: ${w.description}`);
        lines.push('');
      }
      if (review.recommendations.length > 0) {
        lines.push('### Recommendations');
        for (const r of review.recommendations) lines.push(`- [${r.impact}/${r.effort}] **${r.title}**: ${r.description}`);
        lines.push('');
      }
      if (review.breaking_point.component) {
        lines.push(`### Breaking Point: ${review.breaking_point.component}`);
        lines.push(`${review.breaking_point.scenario} (~${review.breaking_point.estimated_load}). Fix: ${review.breaking_point.mitigation}`);
        lines.push('');
      }
    }

    if (transcript.length > 0) {
      lines.push('## Key Discussion Points');
      // Include AI messages as summary points (last 10)
      const aiMsgs = transcript.filter((t) => t.speaker === 'ai').slice(-10);
      for (const msg of aiMsgs) {
        const summary = msg.text.length > 200 ? msg.text.slice(0, 200) + '...' : msg.text;
        lines.push(`- ${summary}`);
      }
      lines.push('');
    }

    const prompt = lines.join('\n');
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  }, [transcript, stack, decisions, mermaidCode, health, overallHealth, healthGrade, review]);

  const categoryIcon = (cat: string) => {
    if (cat === 'Security') return Shield;
    if (cat === 'Infrastructure') return Server;
    if (cat === 'Reliability') return Zap;
    if (cat === 'Devops') return Settings;
    return Layers;
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Summary Bar */}
      {stack.length > 0 && (
        <div
          className="px-3 sm:px-6 py-2 flex items-center gap-2 sm:gap-4 text-xs overflow-x-auto no-scrollbar"
          style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)' }}
        >
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--green)' }} />
            {!isMobile && <span style={{ color: 'var(--text-primary)' }} className="font-medium">Architecture Summary</span>}
          </div>
          <span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{stack.length} tools</span>
          <span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>${filteredMonthlyCost}/mo{costMode !== 'all' ? ` (${costMode})` : ''}</span>
          {mermaidCode && <span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Diagram</span>}
          <span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{checkedCount}/{checklist.length}</span>
          <button
            onClick={handleExportPrompt}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex-shrink-0"
            style={{
              background: promptCopied ? 'rgba(34, 197, 94, 0.15)' : 'transparent',
              border: `1px solid ${promptCopied ? 'rgba(34, 197, 94, 0.3)' : 'var(--border-subtle)'}`,
              color: promptCopied ? 'var(--green)' : 'var(--text-muted)',
            }}
            title="Export architecture as a one-shot prompt"
          >
            {promptCopied ? <Check size={12} /> : <FileText size={12} />}
            {promptCopied ? 'Copied!' : 'Export'}
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: conversation history */}
        {isMobile && showLeftPanel && (
          <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowLeftPanel(false)} />
        )}
        <div
          className={`${isMobile ? `fixed top-0 left-0 bottom-0 z-50 w-72 animate-slide-right ${showLeftPanel ? '' : 'hidden'}` : 'w-56 flex-shrink-0 relative'} flex flex-col`}
          style={{ background: 'var(--surface)', borderRight: '1px solid var(--border-subtle)' }}
        >
          {isMobile && (
            <div className="flex items-center justify-between px-3 pt-3 pb-1">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Conversations</span>
              <button onClick={() => setShowLeftPanel(false)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="mx-3 mt-3 mb-2 flex gap-2">
            <button
              onClick={() => { handleNewArchitecture(); if (isMobile) setShowLeftPanel(false); }}
              className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                minHeight: isMobile ? '44px' : undefined,
              }}
            >
              <Plus size={14} />
              New
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                minHeight: isMobile ? '44px' : undefined,
              }}
              title="Past sessions"
            >
              <Clock size={14} />
              History
            </button>
          </div>

          <div className="px-3 mb-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
              <input
                type="text"
                className="form-input text-xs pl-8"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-faint)' }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2">
            {sessions.length === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>
                No conversations yet.
              </p>
            ) : (
              sessions
                .filter((s) => !searchQuery || s.title.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((session) => (
                  <button
                    key={session.id}
                    onClick={() => setActiveSessionId(session.id)}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs mb-1 transition-colors cursor-pointer"
                    style={{
                      background: session.id === activeSessionId ? 'var(--bg)' : 'transparent',
                      color: session.id === activeSessionId ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    <p className="truncate font-medium">{session.title}</p>
                    <p className="mt-0.5" style={{ color: 'var(--text-faint)' }}>
                      {new Date(session.timestamp).toLocaleDateString()}
                    </p>
                  </button>
                ))
            )}
          </div>

          {showHistory && (
            <div className="absolute inset-0 z-30" style={{ background: 'var(--surface)' }}>
              <SessionHistory
                tool="architect"
                onSelectSession={(detail: SessionDetail) => {
                  setShowHistory(false);
                }}
                onClose={() => setShowHistory(false)}
              />
            </div>
          )}
        </div>

        {/* Center: Chat + Diagram */}
        <div className="flex-1 flex flex-col" style={{ background: 'var(--bg)' }}>
          {/* Speech error banner */}
          {speechError && (
            <div className="mx-4 mt-3 flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ background: 'var(--red-muted)', border: '1px solid rgba(204, 80, 64, 0.2)', color: 'var(--red)' }}>
              <AlertCircle size={16} />{speechError}
            </div>
          )}
          {retryCount > 0 && !speechError && (
            <div className="mx-4 mt-3 flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ background: 'var(--amber-muted)', border: '1px solid rgba(212, 166, 74, 0.2)', color: 'var(--amber)' }}>
              <RefreshCw size={14} className="animate-spin" />Reconnecting... (attempt {retryCount}/5)
            </div>
          )}

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
            {transcript.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: 'var(--accent-muted)', border: '1px solid rgba(212, 166, 74, 0.15)' }}>
                  <Layers size={28} style={{ color: 'var(--accent)' }} />
                </div>
                <h2 className="heading-section text-lg mb-2">Architecture Planner</h2>
                <p className="text-sm max-w-md mb-4" style={{ color: 'var(--text-secondary)' }}>
                  Describe your project idea and I&apos;ll help you design the architecture,
                  choose the right tools, and estimate costs.
                </p>
                <div className="flex items-center gap-2 mb-4">
                  <span className={`status-dot ${aiStatus}`} />
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {aiStatus === 'idle' ? 'Ready' : aiStatus === 'listening' ? 'Listening...'
                      : aiStatus === 'thinking' ? 'Thinking...' : 'Speaking...'}
                  </span>
                </div>
                <button onClick={handleToggleMic} className={`mic-btn ${isRecording ? 'recording' : ''}`}
                  style={isMobile ? { width: 80, height: 80 } : undefined}>
                  {isRecording ? <MicOff size={isMobile ? 32 : 24} /> : <Mic size={isMobile ? 32 : 24} />}
                  {isRecording && <span className="mic-ring" />}
                </button>
                <p className="text-xs mt-3" style={{ color: 'var(--text-faint)' }}>
                  {isRecording ? 'Tap to stop' : 'Tap to start speaking'}
                </p>
              </div>
            ) : (
              <>
                {transcript.map((entry) => (
                  <div key={entry.id} className={`mb-4 ${entry.speaker === 'user' ? 'flex justify-end' : ''}`}>
                    <div
                      className="max-w-2xl rounded-xl px-4 py-3"
                      style={{
                        background: entry.speaker === 'user' ? 'var(--accent-muted)' : 'var(--surface)',
                        border: `1px solid ${entry.speaker === 'user' ? 'rgba(212, 166, 74, 0.15)' : 'var(--border-subtle)'}`,
                      }}
                    >
                      <span className="text-xs font-medium opacity-50 block mb-1">
                        {entry.speaker === 'user' ? 'YOU' : 'ARCHITECT'}
                      </span>
                      {entry.speaker === 'ai' ? (
                        <div className="space-y-0.5">{renderMarkdown(entry.text)}</div>
                      ) : (
                        <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
                          {entry.text}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Option cards */}
                {optionCards.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 max-w-2xl">
                    {optionCards.map((card, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(card.title)}
                        className="text-left p-3 rounded-lg transition-colors cursor-pointer"
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{card.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{card.description}</p>
                      </button>
                    ))}
                  </div>
                )}

                {/* Suggestion chips */}
                {suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Suggestions:</span>
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(s)}
                        className="px-3 py-1.5 rounded-full text-xs transition-colors cursor-pointer"
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                {/* AI status */}
                {aiStatus === 'thinking' && (
                  <div className="flex items-center gap-2 mb-4">
                    <span className="status-dot thinking" />
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Researching...</span>
                  </div>
                )}

                {interimText && (
                  <div className="flex justify-end mb-4">
                    <div className="max-w-2xl rounded-xl px-4 py-3 opacity-50"
                      style={{ background: 'var(--accent-muted)', border: '1px solid rgba(212, 166, 74, 0.1)' }}>
                      <span className="text-xs font-medium opacity-50 block mb-1">YOU</span>
                      <p className="text-sm italic" style={{ color: 'var(--text-faint)' }}>{interimText}...</p>
                    </div>
                  </div>
                )}

                <div ref={transcriptEndRef} />
              </>
            )}
          </div>

          {/* Fact-check toast notification */}
          {factChecks.length > 0 && !factChecks[0].read && (
            <div
              className="mx-4 mb-2 flex items-start gap-2 p-3 rounded-lg text-sm cursor-pointer animate-slide-up"
              style={{
                background: factChecks[0].status === 'incorrect' ? 'var(--red-muted)' : 'var(--amber-muted)',
                border: `1px solid ${factChecks[0].status === 'incorrect' ? 'rgba(204, 80, 64, 0.3)' : 'rgba(212, 166, 74, 0.3)'}`,
              }}
              onClick={() => {
                setShowFactPanel(true);
                setUnreadFcCount(0);
                setFactChecks((prev) => prev.map((fc) => ({ ...fc, read: true })));
              }}
            >
              {factChecks[0].status === 'incorrect' ? (
                <XCircle size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--red)' }} />
              ) : (
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--amber)' }} />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium" style={{
                  color: factChecks[0].status === 'incorrect' ? 'var(--red)' : 'var(--amber)',
                }}>
                  {factChecks[0].status === 'incorrect' ? 'Technical Correction' : 'Unverified Claim'}
                </p>
                <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                  {factChecks[0].correction || factChecks[0].claim}
                </p>
              </div>
            </div>
          )}

          {/* Fact-check badge */}
          {factChecks.length > 0 && (
            <div className="mx-4 mb-1 flex items-center gap-2">
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
            </div>
          )}

          {/* Mobile floating buttons */}
          {isMobile && (
            <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
              <button
                onClick={() => setShowLeftPanel(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
                style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', minHeight: '36px' }}
              >
                <MenuIcon size={14} />
                Chats
              </button>
              <button
                onClick={() => setShowRightPanel(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ml-auto"
                style={{ background: 'var(--accent-muted)', border: '1px solid rgba(212, 166, 74, 0.2)', color: 'var(--accent)', minHeight: '36px' }}
              >
                <PanelRight size={14} />
                {activeTab.toUpperCase()}
              </button>
            </div>
          )}

          {/* Bottom input bar */}
          <div className="px-3 sm:px-4 py-2" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
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
                  placeholder="Describe your idea..."
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                />
                <button type="submit" disabled={!textInput.trim()} className="btn-primary px-3 py-2" style={{ minHeight: '44px' }}>
                  <Send size={16} />
                </button>
              </form>

              {!isMobile && (
                <div className="flex items-center gap-2">
                  <span className={`status-dot ${isRecording ? 'listening' : aiStatus}`} />
                </div>
              )}

              {sessionActive && (
                <div className="flex items-center gap-1 sm:gap-2">
                  {isRecording && !isMobile && (
                    <button
                      onClick={handlePauseResume}
                      className="p-2 rounded-lg transition-colors cursor-pointer"
                      style={{
                        background: isPaused ? 'rgba(212, 166, 74, 0.15)' : 'var(--surface)',
                        border: `1px solid ${isPaused ? 'rgba(212, 166, 74, 0.3)' : 'var(--border-subtle)'}`,
                        color: isPaused ? 'var(--amber)' : 'var(--text-muted)',
                      }}
                      title={isPaused ? 'Resume' : 'Pause'}
                    >
                      {isPaused ? <Mic size={14} /> : <Pause size={14} />}
                    </button>
                  )}
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
                    <Square size={14} />{!isMobile && 'End'}
                  </button>
                </div>
              )}
            </div>
            {interimText && (
              <p className="text-xs italic mt-2 ml-12" style={{ color: 'var(--text-faint)' }}>{interimText}...</p>
            )}
          </div>
        </div>

        {/* Right panel: tabbed architecture data */}
        {isMobile && showRightPanel && (
          <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowRightPanel(false)} />
        )}
        <div className={`${isMobile ? `fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl ${showRightPanel ? 'animate-slide-up' : 'hidden'}` : 'w-80 flex-shrink-0'} flex flex-col`}
          style={{
            background: 'var(--surface)',
            borderLeft: isMobile ? 'none' : '1px solid var(--border-subtle)',
            maxHeight: isMobile ? '75vh' : undefined,
          }}>
          {/* Mobile handle */}
          {isMobile && (
            <div className="flex items-center justify-center py-2">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border-subtle)' }} />
            </div>
          )}
          {/* Tab bar */}
          <div className="flex overflow-x-auto no-scrollbar" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {tabConfig.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className="px-3 py-2.5 text-[10px] font-bold tracking-wider whitespace-nowrap transition-colors cursor-pointer"
                style={{
                  color: activeTab === id ? 'var(--accent)' : 'var(--text-faint)',
                  borderBottom: activeTab === id ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-3">

            {/* ARCHITECTURE tab */}
            {activeTab === 'architecture' && (
              <div className="flex flex-col gap-3">
                <div className="text-center py-8">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3"
                    style={{ background: 'var(--accent-muted)' }}>
                    <Layers size={24} style={{ color: 'var(--accent)' }} />
                  </div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {stack.length > 0 ? `${stack.length} tools selected` : 'No architecture yet'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {stack.length > 0
                      ? `$${filteredMonthlyCost}/mo estimated · ${filteredStack.length} tools`
                      : 'Start chatting to build your architecture'}
                  </p>
                </div>
                {mermaidCode && (
                  <button
                    onClick={() => setActiveTab('plot')}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    <Network size={14} />
                    View Architecture Diagram
                  </button>
                )}
                {stack.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {stack.slice(0, 5).map((tool) => (
                      <div key={tool.id} className="flex items-center gap-2 px-2 py-1.5 rounded"
                        style={{ background: 'var(--bg)' }}>
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${new URL(tool.website).hostname}&sz=16`}
                          alt=""
                          width={16}
                          height={16}
                          className="rounded-sm flex-shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{tool.name}</span>
                        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                          {tool.monthly_cost === 0 ? 'Free' : `$${tool.monthly_cost}/mo`}
                        </span>
                      </div>
                    ))}
                    {stack.length > 5 && (
                      <p className="text-[10px] text-center" style={{ color: 'var(--text-faint)' }}>
                        +{stack.length - 5} more in Stack tab
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STACK tab */}
            {activeTab === 'stack' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Tech Stack
                  </span>
                  <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
                    ${totalMonthlyCost}/mo
                  </span>
                </div>
                {Object.entries(stackByCategory).map(([category, tools]) => (
                  <div key={category}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)' }}>
                      {category}
                    </p>
                    {tools.map((tool) => (
                      <div key={tool.id} className="p-2.5 rounded-lg mb-1.5"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
                        <div className="flex items-start gap-2">
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${new URL(tool.website).hostname}&sz=32`}
                            alt=""
                            width={20}
                            height={20}
                            className="rounded-sm mt-0.5 flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{tool.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                style={{ background: 'rgba(0,0,0,0.2)', color: difficultyColor(tool.difficulty) }}>
                                {tool.difficulty}
                              </span>
                              {tool.cost_tier && tool.cost_tier !== 'both' && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                                  style={{
                                    background: tool.cost_tier === 'budget' ? 'rgba(120, 140, 93, 0.15)' : 'rgba(212, 166, 74, 0.15)',
                                    color: tool.cost_tier === 'budget' ? 'var(--green)' : 'var(--accent)',
                                  }}>
                                  {tool.cost_tier === 'budget' ? 'BUDGET' : 'PREMIUM'}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                              {tool.description}
                            </p>
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                                {tool.monthly_cost === 0 ? '$0/mo' : `$${tool.monthly_cost}/mo`}
                              </span>
                              {tool.alternatives && tool.alternatives.length > 0 && (
                                <span className="text-[10px]" style={{ color: 'var(--blue)' }}>
                                  Alternatives
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                {stack.length === 0 && (
                  <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>
                    No tools selected yet. Start chatting to build your stack.
                  </p>
                )}
              </div>
            )}

            {/* CHECKLIST tab */}
            {activeTab === 'checklist' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Completeness
                  </span>
                  <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
                    {checkedCount}/{checklist.length}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 rounded-full" style={{ background: 'var(--bg)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: checklist.length > 0 ? `${(checkedCount / checklist.length) * 100}%` : '0%',
                      background: 'var(--blue)',
                    }}
                  />
                </div>
                {Object.entries(checklistByCategory).map(([category, items]) => {
                  const catChecked = items.filter((i) => i.discussed).length;
                  const CatIcon = categoryIcon(category);
                  return (
                    <div key={category}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="w-2 h-2 rounded-full" style={{
                          background: catChecked === items.length ? 'var(--green)' : catChecked > 0 ? 'var(--amber)' : 'var(--red)',
                        }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                          {category}
                        </span>
                        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-faint)' }}>
                          {catChecked}/{items.length}
                        </span>
                      </div>
                      {items.map((item) => (
                        <div key={item.id} className="flex items-center gap-2 py-1.5 px-2 rounded mb-0.5"
                          style={{ background: item.discussed ? 'rgba(120, 140, 93, 0.08)' : 'transparent' }}>
                          <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
                            style={{
                              borderColor: item.discussed ? 'var(--green)' : 'var(--border-subtle)',
                              background: item.discussed ? 'var(--green)' : 'transparent',
                            }}>
                            {item.discussed && <span className="text-[8px] text-white font-bold">✓</span>}
                          </div>
                          <span className="text-xs" style={{
                            color: item.discussed ? 'var(--text-primary)' : 'var(--text-muted)',
                          }}>
                            {item.label}
                          </span>
                          {item.discussed && (
                            <span className="text-[9px] ml-auto px-1.5 py-0.5 rounded" style={{
                              background: 'rgba(120, 140, 93, 0.15)', color: 'var(--green)',
                            }}>discussed</span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* HEALTH tab */}
            {activeTab === 'health' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Architecture Health
                  </span>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: 'var(--bg)', border: '2px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                    {healthGrade}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>Overall</span>
                  <span>{overallHealth} / 5.0</span>
                </div>
                <div className="h-2 rounded-full" style={{ background: 'var(--bg)' }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(Number(overallHealth) / 5) * 100}%`, background: healthBarColor(Number(overallHealth)) }} />
                </div>

                {([
                  ['Scalability', health.scalability],
                  ['Security', health.security],
                  ['Cost Efficiency', health.cost_efficiency],
                  ['Maintainability', health.maintainability],
                  ['Reliability', health.reliability],
                ] as [string, number][]).map(([label, score]) => (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                      <span className="text-xs font-medium" style={{ color: healthBarColor(score) }}>{score}/5</span>
                    </div>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="flex-1 h-2 rounded-sm"
                          style={{ background: i <= score ? healthBarColor(score) : 'var(--bg)' }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* COSTS tab */}
            {activeTab === 'costs' && (
              <div className="flex flex-col gap-3">
                {/* Header with total */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Est. Monthly Cost
                  </span>
                  <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                    ${filteredMonthlyCost}<span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>/mo</span>
                  </span>
                </div>

                {/* Cost optimization toggle */}
                {stack.length > 0 && (
                  <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    {([
                      { id: 'cheapest' as const, label: 'Cheapest', icon: TrendingDown },
                      { id: 'all' as const, label: 'All Tools', icon: Package },
                      { id: 'best' as const, label: 'Best', icon: Crown },
                    ]).map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        onClick={() => setCostMode(id)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                        style={{
                          background: costMode === id
                            ? id === 'cheapest' ? 'rgba(120, 140, 93, 0.15)'
                              : id === 'best' ? 'rgba(212, 166, 74, 0.15)'
                              : 'var(--bg)'
                            : 'transparent',
                          color: costMode === id
                            ? id === 'cheapest' ? 'var(--green)'
                              : id === 'best' ? 'var(--accent)'
                              : 'var(--text-primary)'
                            : 'var(--text-faint)',
                          borderRight: id !== 'best' ? '1px solid var(--border-subtle)' : 'none',
                        }}
                      >
                        <Icon size={12} />
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Savings banner */}
                {stack.length > 0 && savings > 0 && costMode === 'cheapest' && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(120, 140, 93, 0.1)', border: '1px solid rgba(120, 140, 93, 0.2)' }}>
                    <TrendingDown size={14} style={{ color: 'var(--green)' }} />
                    <span className="text-[10px] font-medium" style={{ color: 'var(--green)' }}>
                      Save ${savings}/mo vs premium stack
                    </span>
                  </div>
                )}
                {stack.length > 0 && costMode === 'best' && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(212, 166, 74, 0.1)', border: '1px solid rgba(212, 166, 74, 0.2)' }}>
                    <Crown size={14} style={{ color: 'var(--accent)' }} />
                    <span className="text-[10px] font-medium" style={{ color: 'var(--accent)' }}>
                      Best-in-class tools for each role
                    </span>
                  </div>
                )}

                {/* Quick compare */}
                {stack.length > 0 && costMode === 'all' && budgetTotal !== premiumTotal && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCostMode('cheapest')}
                      className="flex-1 p-2 rounded-lg text-center cursor-pointer transition-colors"
                      style={{ background: 'rgba(120, 140, 93, 0.08)', border: '1px solid rgba(120, 140, 93, 0.15)' }}
                    >
                      <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--green)' }}>Budget</p>
                      <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>${budgetTotal}/mo</p>
                    </button>
                    <button
                      onClick={() => setCostMode('best')}
                      className="flex-1 p-2 rounded-lg text-center cursor-pointer transition-colors"
                      style={{ background: 'rgba(212, 166, 74, 0.08)', border: '1px solid rgba(212, 166, 74, 0.15)' }}
                    >
                      <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--accent)' }}>Premium</p>
                      <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>${premiumTotal}/mo</p>
                    </button>
                  </div>
                )}

                <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  {filteredStack.length} tools · {costByCategory.length} categories
                  {costMode !== 'all' && ` · ${costMode === 'cheapest' ? 'budget' : 'premium'} picks`}
                </p>

                {/* Cost distribution bar */}
                {filteredMonthlyCost > 0 && (
                  <div className="h-3 rounded-full flex overflow-hidden" style={{ background: 'var(--bg)' }}>
                    {costByCategory.filter((c) => c.total > 0).map((cat, i) => (
                      <div key={cat.name} className="h-full" style={{
                        width: `${(cat.total / filteredMonthlyCost) * 100}%`,
                        background: ['var(--accent)', 'var(--blue)', 'var(--green)', 'var(--amber)', 'var(--red)'][i % 5],
                      }} />
                    ))}
                  </div>
                )}

                {/* Category breakdown */}
                {costByCategory.map((cat) => (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{cat.name}</span>
                      <span className="text-xs" style={{ color: cat.total === 0 ? 'var(--green)' : 'var(--text-primary)' }}>
                        {cat.total === 0 ? 'Free' : `$${cat.total}`}
                      </span>
                    </div>
                    {cat.tools.map((tool) => (
                      <div key={tool.name} className="flex items-center justify-between pl-3 py-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{tool.name}</span>
                          {costMode === 'all' && tool.tier !== 'both' && (
                            <span className="text-[8px] px-1 py-0.5 rounded font-bold uppercase"
                              style={{
                                background: tool.tier === 'budget' ? 'rgba(120, 140, 93, 0.15)' : 'rgba(212, 166, 74, 0.15)',
                                color: tool.tier === 'budget' ? 'var(--green)' : 'var(--accent)',
                              }}>
                              {tool.tier === 'budget' ? '$' : '\u2605'}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px]" style={{ color: tool.cost === 0 ? 'var(--green)' : 'var(--text-faint)' }}>
                          {tool.cost === 0 ? 'Free' : `$${tool.cost}`}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}

                {/* Insights */}
                {stack.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>
                      Insights
                    </p>
                    {costByCategory.filter((c) => c.total > 0).length > 0 && (
                      <p className="text-[10px]" style={{ color: 'var(--amber)' }}>
                        {costByCategory[0]?.name} is the biggest cost driver at ${costByCategory[0]?.total}/mo
                      </p>
                    )}
                    {savings > 0 && (
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--green)' }}>
                        Budget stack saves ${savings}/mo ({Math.round((savings / premiumTotal) * 100)}% cheaper)
                      </p>
                    )}
                    {freeToolsCount > 0 && (
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                        {freeToolsCount} tools with genuinely free production tiers
                      </p>
                    )}
                  </div>
                )}

                {stack.length === 0 && (
                  <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>
                    No cost data yet.
                  </p>
                )}
              </div>
            )}

            {/* DECISIONS tab */}
            {activeTab === 'decisions' && (
              <div className="flex flex-col gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Decisions ({decisions.length})
                </span>
                {decisions.length === 0 ? (
                  <div className="text-center py-8">
                    <GitBranch size={28} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      No decisions detected yet. Keep chatting and decisions will be extracted automatically.
                    </p>
                  </div>
                ) : (
                  decisions.map((d) => (
                    <div key={d.id} className="p-2.5 rounded-lg"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-full" style={{
                          background: d.status === 'accepted' ? 'var(--green)' : d.status === 'rejected' ? 'var(--red)' : 'var(--amber)',
                        }} />
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{d.title}</span>
                      </div>
                      <p className="text-[10px] pl-4" style={{ color: 'var(--text-muted)' }}>{d.context}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* CHANGELOG tab */}
            {activeTab === 'changelog' && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Timeline
                </span>
                {changelog.length === 0 ? (
                  <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>
                    No events yet.
                  </p>
                ) : (
                  changelog.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2 py-1.5">
                      <span className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{
                        background: entry.type === 'diagram' ? 'var(--blue)' :
                          entry.type === 'decision' ? 'var(--green)' :
                          entry.type === 'stack' ? 'var(--accent)' : 'var(--text-faint)',
                      }} />
                      <div className="min-w-0">
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{entry.label}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* REVIEW tab — Architecture grade & feedback */}
            {activeTab === 'review' && (
              <div className="flex flex-col gap-4">
                {!review ? (
                  /* Empty state */
                  <div className="text-center py-12">
                    <Award size={32} className="mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
                    <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Rate Your Architecture
                    </p>
                    <p className="text-xs mb-4" style={{ color: 'var(--text-faint)' }}>
                      Describe your tech stack, then ask me to review it for a full grade report.
                    </p>
                    <button
                      onClick={() => sendMessage('Rate my architecture')}
                      className="px-4 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                      style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}
                    >
                      Rate my architecture
                    </button>
                  </div>
                ) : review.overall_grade === '?' ? (
                  /* Needs more info state */
                  <div className="text-center py-12">
                    <AlertCircle size={32} className="mx-auto mb-3" style={{ color: 'var(--amber)' }} />
                    <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Need More Info
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      Tell me more about your stack — database, hosting, backend — and I&apos;ll give you a full grade.
                    </p>
                  </div>
                ) : (
                  /* Full review */
                  <>
                    {/* Grade badge + score */}
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-black flex-shrink-0"
                        style={{
                          background: `${gradeColor(review.overall_grade)}15`,
                          border: `3px solid ${gradeColor(review.overall_grade)}`,
                          color: gradeColor(review.overall_grade),
                        }}>
                        {review.overall_grade}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            {review.overall_score}
                          </span>
                          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>/100</span>
                        </div>
                        <div className="h-2 rounded-full" style={{ background: 'var(--bg)' }}>
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${review.overall_score}%`, background: gradeColor(review.overall_grade) }} />
                        </div>
                      </div>
                    </div>

                    {/* Category breakdown */}
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        Category Scores
                      </span>
                      <div className="flex flex-col gap-2.5 mt-2">
                        {(Object.entries(review.categories) as [string, { score: number; grade: string; reasoning: string }][])
                          .sort(([, a], [, b]) => a.score - b.score)
                          .map(([key, cat]) => (
                            <div key={key}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs capitalize" style={{ color: 'var(--text-secondary)' }}>
                                  {key.replace(/_/g, ' ')}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                                    style={{ background: `${gradeColor(cat.grade)}15`, color: gradeColor(cat.grade) }}>
                                    {cat.grade}
                                  </span>
                                  <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{cat.score}</span>
                                </div>
                              </div>
                              <div className="h-1.5 rounded-full mb-1" style={{ background: 'var(--bg)' }}>
                                <div className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${cat.score}%`, background: gradeColor(cat.grade) }} />
                              </div>
                              {cat.reasoning && (
                                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                                  {cat.reasoning}
                                </p>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Strengths */}
                    {review.strengths.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <TrendingUp size={12} style={{ color: 'var(--green)' }} />
                          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            Strengths
                          </span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {review.strengths.map((s, i) => (
                            <div key={i} className="p-2.5 rounded-lg"
                              style={{ background: 'var(--bg)', borderLeft: '3px solid var(--green)' }}>
                              <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>{s.title}</p>
                              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{s.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Weaknesses */}
                    {review.weaknesses.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <AlertTriangle size={12} style={{ color: 'var(--red)' }} />
                          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            Weaknesses
                          </span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {review.weaknesses.map((w, i) => (
                            <div key={i} className="p-2.5 rounded-lg"
                              style={{ background: 'var(--bg)', borderLeft: '3px solid var(--red)' }}>
                              <div className="flex items-center gap-2 mb-0.5">
                                <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{w.title}</p>
                                {w.anti_pattern && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                    style={{ background: 'rgba(var(--red-rgb, 200, 80, 80), 0.12)', color: 'var(--red)' }}>
                                    {w.anti_pattern}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{w.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recommendations */}
                    {review.recommendations.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <Target size={12} style={{ color: 'var(--accent)' }} />
                          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            Recommendations
                          </span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {review.recommendations.map((r, i) => (
                            <div key={i} className="p-2.5 rounded-lg"
                              style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
                              <div className="flex items-center gap-2 mb-1">
                                <p className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{r.title}</p>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                                  style={{ background: `${impactColor(r.impact)}15`, color: impactColor(r.impact) }}>
                                  {r.impact}
                                </span>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                                  style={{ background: `${effortColor(r.effort)}15`, color: effortColor(r.effort) }}>
                                  {r.effort}
                                </span>
                              </div>
                              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{r.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Breaking point */}
                    {review.breaking_point.component && (
                      <div className="p-3 rounded-lg"
                        style={{ background: 'rgba(var(--amber-rgb, 212, 166, 74), 0.08)', border: '1px solid rgba(var(--amber-rgb, 212, 166, 74), 0.2)' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle size={14} style={{ color: 'var(--amber)' }} />
                          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--amber)' }}>
                            Breaking Point
                          </span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div>
                            <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>Component: </span>
                            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{review.breaking_point.component}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>Scenario: </span>
                            <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{review.breaking_point.scenario}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>Est. Load: </span>
                            <span className="text-[10px] font-bold" style={{ color: 'var(--red)' }}>{review.breaking_point.estimated_load}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>Fix: </span>
                            <span className="text-[10px]" style={{ color: 'var(--green)' }}>{review.breaking_point.mitigation}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Re-review button */}
                    <button
                      onClick={() => sendMessage('Rate my architecture again')}
                      className="w-full py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors flex items-center justify-center gap-2"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                    >
                      <RefreshCw size={12} />
                      Re-evaluate
                    </button>
                  </>
                )}
              </div>
            )}

            {/* PLOT tab — Architecture diagram */}
            {activeTab === 'plot' && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Architecture Diagram
                  </span>
                  {mermaidCode && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => setZoom((z) => Math.min(z + 0.2, 3))} className="p-1.5 rounded cursor-pointer"
                        style={{ color: 'var(--text-muted)' }}><ZoomIn size={14} /></button>
                      <button onClick={() => setZoom((z) => Math.max(z - 0.2, 0.3))} className="p-1.5 rounded cursor-pointer"
                        style={{ color: 'var(--text-muted)' }}><ZoomOut size={14} /></button>
                      <button onClick={() => setZoom(1)} className="p-1.5 rounded cursor-pointer"
                        style={{ color: 'var(--text-muted)' }}><RotateCcw size={14} /></button>
                      <button onClick={() => setDiagramFullscreen(true)} className="p-1.5 rounded cursor-pointer"
                        style={{ color: 'var(--text-muted)' }} title="Fullscreen"><Maximize2 size={14} /></button>
                      <MermaidExport mermaidCode={mermaidCode} containerRef={mermaidContainerRef} />
                    </div>
                  )}
                </div>
                {mermaidCode ? (
                  <div className="flex-1 overflow-auto">
                    <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} className="transition-transform duration-200">
                      <div ref={mermaidContainerRef} className="mermaid-render" />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center py-8">
                    <Network size={28} className="mb-3" style={{ color: 'var(--text-faint)' }} />
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      No diagram yet. Keep chatting and a diagram will be generated.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen diagram overlay */}
      {/* Fact-check detail panel (slides in from right) */}
      {showFactPanel && (
        <div className={`fixed z-40 flex flex-col animate-slide-up ${isMobile ? 'inset-x-0 bottom-0 rounded-t-2xl' : 'right-0 top-0 bottom-0 w-80'}`}
          style={{ background: 'var(--surface)', borderLeft: isMobile ? 'none' : '1px solid var(--border-subtle)', boxShadow: '-4px 0 20px rgba(0,0,0,0.3)', maxHeight: isMobile ? '70vh' : undefined }}>
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

      {diagramFullscreen && mermaidCode && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: 'var(--bg)' }}
        >
          <div className="flex items-center justify-between px-4 py-2"
            style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Architecture Diagram
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
