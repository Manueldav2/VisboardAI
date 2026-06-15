import { CheckCircle, XCircle, AlertTriangle, Loader2, ExternalLink, AlertOctagon } from 'lucide-react';
import type { FactCheck, ActionItem } from '../types';

interface Props {
  factChecks: FactCheck[];
  actionItems: ActionItem[];
  summary: string;
  corrections: { statement: string; correction: string }[];
}

export default function FactPanel({ factChecks, actionItems, summary, corrections }: Props) {
  const hasContent = factChecks.length > 0 || actionItems.length > 0 || summary || corrections.length > 0;

  if (!hasContent) {
    return (
      <div className="fact-panel-empty">
        <p>Facts, actions, corrections, and summary<br />will appear as the conversation develops</p>
      </div>
    );
  }

  return (
    <div className="fact-panel">
      {corrections.length > 0 && (
        <div className="panel-section">
          <h3 className="section-title corrections-title">
            <AlertOctagon size={14} /> Corrections
          </h3>
          <ul className="correction-list">
            {corrections.map((corr, i) => (
              <li key={i} className="correction-item">
                <div className="correction-wrong">
                  <XCircle size={12} /><span>{corr.statement}</span>
                </div>
                <div className="correction-right">
                  <CheckCircle size={12} /><span>{corr.correction}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary && (
        <div className="panel-section">
          <h3 className="section-title">Summary</h3>
          <p className="summary-text">{summary}</p>
        </div>
      )}

      {actionItems.length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">Action Items</h3>
          <ul className="action-list">
            {actionItems.map(item => (
              <li key={item.id} className="action-item">
                <span className="action-text">{item.text}</span>
                {item.owner && <span className="action-owner">@{item.owner}</span>}
                {item.deadline && <span className="action-deadline">{item.deadline}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {factChecks.length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">Fact Checks</h3>
          <ul className="fact-list">
            {factChecks.map(fc => (
              <li key={fc.id} className={`fact-item fact-${fc.status}`}>
                <div className="fact-icon">
                  {fc.status === 'checking' && <Loader2 size={14} className="spin" />}
                  {fc.status === 'verified' && <CheckCircle size={14} />}
                  {fc.status === 'incorrect' && <XCircle size={14} />}
                  {fc.status === 'assumption' && <AlertTriangle size={14} />}
                </div>
                <div className="fact-content">
                  <span className="fact-claim">{fc.claim}</span>
                  {fc.correction && <span className="fact-correction">{fc.correction}</span>}
                  {fc.source && (
                    <a href={fc.source} target="_blank" rel="noopener noreferrer" className="fact-source">
                      <ExternalLink size={10} /> source
                    </a>
                  )}
                </div>
                <div className="fact-right">
                  {fc.confidence !== undefined && (
                    <span className="fact-confidence">{Math.round(fc.confidence * 100)}%</span>
                  )}
                  <span className="fact-badge">
                    {fc.status === 'checking' ? 'checking' : fc.status === 'verified' ? 'verified' : fc.status === 'incorrect' ? 'wrong' : 'unverified'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
