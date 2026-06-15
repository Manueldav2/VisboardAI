import { useState } from 'react';
import { X, FileText } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  isProcessing: boolean;
}

export default function PasteModal({ open, onClose, onSubmit, isProcessing }: Props) {
  const [text, setText] = useState('');

  if (!open) return null;

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim());
      setText('');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <FileText size={18} />
            <span>Paste Conversation</span>
          </div>
          <button onClick={onClose} className="icon-btn">
            <X size={18} />
          </button>
        </div>

        <p className="modal-desc">
          Paste a meeting transcript, chat log, Slack thread, or any conversation.
          Thought Plot will extract the structure and build a visual map.
        </p>

        <textarea
          className="modal-textarea"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste your conversation here..."
          rows={12}
          autoFocus
        />

        <div className="modal-actions">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={handleSubmit}
            className="btn btn-primary"
            disabled={!text.trim() || isProcessing}
          >
            {isProcessing ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      </div>
    </div>
  );
}
