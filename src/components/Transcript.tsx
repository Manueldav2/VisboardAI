import { useEffect, useRef } from 'react';
import { Copy } from 'lucide-react';
import type { TranscriptEntry } from '../types';

interface Props {
  entries: TranscriptEntry[];
}

export default function Transcript({ entries }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  const copyAll = () => {
    const text = entries
      .map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.speaker === 'user' ? 'You' : 'Thought Plot'}: ${e.text}`)
      .join('\n');
    navigator.clipboard.writeText(text);
  };

  if (entries.length === 0) {
    return (
      <div className="transcript-empty">
        <p>Transcript will appear here as you speak or paste text</p>
      </div>
    );
  }

  return (
    <div className="transcript">
      <div className="transcript-header">
        <span>Transcript ({entries.length})</span>
        <button onClick={copyAll} className="icon-btn" title="Copy all"><Copy size={14} /></button>
      </div>
      <div className="transcript-list">
        {entries.map(entry => (
          <div key={entry.id} className={`transcript-entry ${entry.speaker}`}>
            <div className="transcript-meta">
              <span className="transcript-speaker">
                {entry.speaker === 'user' ? 'You' : 'Thought Plot'}
              </span>
              <span className="transcript-time">
                {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
            <p className="transcript-text">{entry.text}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
