import { Trash2, Plus, Clock } from 'lucide-react';
import type { SessionMetadata } from '../services/sessionStore';

interface Props {
  sessions: SessionMetadata[];
  activeSessionId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function SessionPanel({ sessions, activeSessionId, onSelect, onDelete, onNew }: Props) {
  return (
    <div className="session-panel">
      <div className="session-panel-header">
        <h3>Sessions</h3>
        <button onClick={onNew} className="btn btn-primary btn-sm" title="New session">
          <Plus size={14} />
          <span>New</span>
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="session-empty">
          <Clock size={24} />
          <p>No saved sessions yet</p>
        </div>
      ) : (
        <div className="session-list">
          {sessions.map(session => (
            <div
              key={session.id}
              className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
              onClick={() => onSelect(session.id)}
            >
              <div className="session-item-header">
                <span className="session-title">
                  {session.title || 'Untitled'}
                </span>
                <button
                  className="session-delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
                  title="Delete session"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="session-meta">
                <span>{timeAgo(session.updatedAt)}</span>
                <span>{session.nodeCount} nodes</span>
              </div>
              {session.preview && (
                <p className="session-preview">{session.preview}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
