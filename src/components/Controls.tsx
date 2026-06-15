import { Mic, MicOff, RotateCcw, ClipboardPaste, Send, Loader2, History } from 'lucide-react';
import { useState } from 'react';
import type { ConnectionStatus, TranscriptionMode } from '../types';

interface Props {
  status: ConnectionStatus;
  isListening: boolean;
  isSpeaking: boolean;
  volume: number;
  isExtracting: boolean;
  transcriptionMode: TranscriptionMode;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onPaste: () => void;
  onSendText: (text: string) => void;
  onToggleSessions: () => void;
  onModeChange: (mode: TranscriptionMode) => void;
  sessionCount: number;
}

const MODE_LABELS: Record<TranscriptionMode, string> = {
  browser: 'Browser',
  gemini: 'Gemini',
  whisper: 'Whisper',
};

export default function Controls({
  status, isListening, isSpeaking, volume, isExtracting,
  transcriptionMode, onStart, onStop, onReset, onPaste, onSendText,
  onToggleSessions, onModeChange, sessionCount,
}: Props) {
  const [textInput, setTextInput] = useState('');

  const handleSend = () => {
    if (textInput.trim()) { onSendText(textInput.trim()); setTextInput(''); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const statusLabel = {
    disconnected: 'Ready',
    connecting: 'Connecting',
    connected: 'Listening',
    error: 'Error',
  }[status];

  const statusColor = {
    disconnected: 'var(--muted)',
    connecting: 'var(--warning)',
    connected: 'var(--success)',
    error: 'var(--danger)',
  }[status];

  const ringScale = isListening ? 1 + Math.min(volume * 25, 0.8) : 1;

  return (
    <div className="controls">
      <div className="controls-row">
        <div className="mic-wrapper">
          <div className="mic-ring" style={{
            transform: `scale(${ringScale})`,
            opacity: isSpeaking ? 0.7 : 0,
          }} />
          <button
            className={`mic-btn ${isListening ? 'active' : ''} ${status === 'connecting' ? 'connecting' : ''}`}
            onClick={isListening ? onStop : onStart}
            disabled={status === 'connecting'}
            title={isListening ? 'Stop listening' : 'Start listening'}
          >
            {status === 'connecting' ? <Loader2 size={20} className="spin" /> :
              isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        </div>

        <div className="status-indicator">
          <div className={`status-dot ${status === 'connected' ? 'pulse' : ''}`} style={{ background: statusColor }} />
          <span style={{ color: statusColor }}>{statusLabel}</span>
          {isExtracting && (
            <span className="extracting-tag"><Loader2 size={10} className="spin" /> mapping</span>
          )}
        </div>

        {/* Mode selector */}
        <div className="mode-selector">
          {(['browser', 'gemini', 'whisper'] as TranscriptionMode[]).map(mode => (
            <button
              key={mode}
              className={`mode-btn ${transcriptionMode === mode ? 'active' : ''}`}
              onClick={() => onModeChange(mode)}
              disabled={isListening}
              title={`${MODE_LABELS[mode]} transcription`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>

        <div className="controls-spacer" />

        <button onClick={onToggleSessions} className="btn btn-ghost" title="Session history">
          <History size={16} />
          <span>Sessions</span>
          {sessionCount > 0 && <span className="btn-badge">{sessionCount}</span>}
        </button>

        <button onClick={onPaste} className="btn btn-ghost" title="Paste text">
          <ClipboardPaste size={16} /><span>Paste</span>
        </button>

        <button onClick={onReset} className="btn btn-ghost" title="New session">
          <RotateCcw size={16} /><span>New</span>
        </button>
      </div>

      <div className="text-input-row">
        <input
          type="text" value={textInput}
          onChange={e => setTextInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? 'Type to add to conversation...' : 'Type something and press Enter...'}
          className="text-input"
        />
        <button onClick={handleSend} className="send-btn" disabled={!textInput.trim()} title="Send">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
