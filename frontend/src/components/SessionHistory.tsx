'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, Search, X, ChevronRight, Mic, Network, Blocks, Scale, User, Bot, BookOpen, Map, Cpu, MessageCircle } from 'lucide-react';
import type { SessionListItem, SessionDetail } from '@/lib/types';
import { API_BASE } from '@/lib/api';

interface SessionHistoryProps {
  tool: string; // Pass "all" to show sessions across all tools
  onSelectSession: (detail: SessionDetail) => void;
  onClose: () => void;
}

const TOOL_LABELS: Record<string, string> = {
  study_buddy: 'Study Buddy',
  thought_plot: 'Visboard',
  architect: 'Architect',
  argument_ref: 'Argument Ref',
};

const TOOL_ICONS: Record<string, typeof Mic> = {
  study_buddy: BookOpen,
  thought_plot: Map,
  architect: Cpu,
  argument_ref: Scale,
  general_chat: MessageCircle,
};

const TOOL_COLORS: Record<string, string> = {
  study_buddy: '#60a5fa',
  thought_plot: '#c084fc',
  architect: '#4ade80',
  argument_ref: '#f87171',
  general_chat: 'var(--accent)',
};

const MODE_LABELS: Record<string, string> = {
  quiz: 'Quiz',
  guided_study: 'Guided Study',
  cram: 'Cram',
  language: 'Language',
  strategy: 'Strategy',
  general: 'General',
  thought_plot: 'Visboard',
};

function formatRelativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function SessionHistory({ tool, onSelectSession, onClose }: SessionHistoryProps) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [viewingDetail, setViewingDetail] = useState<SessionDetail | null>(null);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const url = tool === 'all'
          ? `${API_BASE}/api/sessions?limit=50`
          : `${API_BASE}/api/sessions?tool=${tool}&limit=50`;
        const res = await fetch(url);
        const data = await res.json();
        setSessions(data.sessions || []);
      } catch {
        setSessions([]);
      } finally {
        setLoading(false);
      }
    }
    fetchSessions();
  }, [tool]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    setSelectedId(sessionId);
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`);
      const data: SessionDetail = await res.json();
      setViewingDetail(data);
      onSelectSession(data);
    } catch {
      // Failed to load
    } finally {
      setLoadingDetail(false);
    }
  }, [onSelectSession]);

  const handleBack = () => {
    setViewingDetail(null);
    setSelectedId(null);
  };

  const filtered = sessions.filter((s) =>
    !searchQuery ||
    (s.topic?.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (MODE_LABELS[s.mode]?.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (TOOL_LABELS[s.tool]?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const showAllTools = tool === 'all';
  const ToolIcon = showAllTools ? Clock : (TOOL_ICONS[tool] || Mic);

  // Detail view — transcript
  if (viewingDetail) {
    return (
      <div className="flex flex-col h-full" style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <button
            onClick={handleBack}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {viewingDetail.session.topic || MODE_LABELS[viewingDetail.session.mode] || 'Session'}
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
              {formatRelativeTime(viewingDetail.session.started_at)}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: 'var(--text-faint)' }}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {viewingDetail.transcript.length === 0 && (
            <div className="text-center py-8" style={{ color: 'var(--text-faint)' }}>
              <p className="text-sm">No transcript recorded</p>
            </div>
          )}
          {viewingDetail.transcript.map((entry) => (
            <div
              key={entry.id}
              className={`flex gap-2 ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {entry.speaker !== 'user' && (
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-1" style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>
                  <Bot size={10} />
                </div>
              )}
              <div
                className="max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed"
                style={{
                  background: entry.speaker === 'user' ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: entry.speaker === 'user' ? 'var(--bg-primary)' : 'var(--text-primary)',
                }}
              >
                {entry.text}
              </div>
              {entry.speaker === 'user' && (
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-1" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                  <User size={10} />
                </div>
              )}
            </div>
          ))}
        </div>

        {viewingDetail.summary && (
          <div className="px-3 py-2" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>Summary</div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {viewingDetail.summary.summary}
            </p>
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border-subtle)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <Clock size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            Past Sessions
          </span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: 'var(--text-faint)' }}>
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full pl-7 pr-3 py-1.5 text-xs rounded"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="text-center py-8" style={{ color: 'var(--text-faint)' }}>
            <p className="text-xs">Loading sessions...</p>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-8" style={{ color: 'var(--text-faint)' }}>
            <ToolIcon size={24} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs">No past sessions yet</p>
          </div>
        )}
        {filtered.map((session) => {
          const SessionToolIcon = TOOL_ICONS[session.tool] || MessageCircle;
          const toolColor = TOOL_COLORS[session.tool] || 'var(--accent)';
          return (
            <button
              key={session.id}
              onClick={() => handleSelectSession(session.id)}
              className="w-full text-left px-3 py-2.5 transition-colors hover:bg-white/5"
              style={{
                borderBottom: '1px solid var(--border-subtle)',
                background: selectedId === session.id ? 'var(--bg-tertiary)' : 'transparent',
              }}
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1.5">
                  {showAllTools && (
                    <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: `${toolColor}15`, color: toolColor }}>
                      <SessionToolIcon size={10} />
                      {TOOL_LABELS[session.tool] || session.tool}
                    </span>
                  )}
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}
                  >
                    {MODE_LABELS[session.mode] || session.mode}
                  </span>
                </div>
                <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  {formatRelativeTime(session.started_at)}
                </span>
              </div>
              <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                {session.topic || `${TOOL_LABELS[session.tool] || session.tool} session`}
              </div>
              {loadingDetail && selectedId === session.id && (
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-faint)' }}>Loading...</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
