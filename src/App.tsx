import { useState, useCallback } from 'react';
import { useThoughtPlot } from './hooks/useThoughtPlot';
import DiagramView from './components/DiagramView';
import Transcript from './components/Transcript';
import FactPanel from './components/FactPanel';
import Controls from './components/Controls';
import PasteModal from './components/PasteModal';
import SessionPanel from './components/SessionPanel';

export default function App() {
  const {
    state, startListening, stopListening, sendText, processText,
    reset, setTranscriptionMode, loadPastSession, getSessions, removeSession,
  } = useThoughtPlot();

  const [showPaste, setShowPaste] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [rightPanel, setRightPanel] = useState<'transcript' | 'facts'>('transcript');
  const [sessionList, setSessionList] = useState(getSessions);

  const refreshSessions = useCallback(() => {
    setSessionList(getSessions());
  }, [getSessions]);

  const handlePaste = async (text: string) => {
    setShowPaste(false);
    await processText(text);
    setRightPanel('facts');
    refreshSessions();
  };

  const handleSelectSession = (id: string) => {
    loadPastSession(id);
    setShowSessions(false);
  };

  const handleDeleteSession = (id: string) => {
    removeSession(id);
    refreshSessions();
  };

  const handleNewSession = () => {
    reset();
    setShowSessions(false);
  };

  const handleToggleSessions = () => {
    if (!showSessions) refreshSessions();
    setShowSessions(!showSessions);
  };

  const insightCount = state.factChecks.length + state.actionItems.length + state.corrections.length;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <circle cx="5" cy="5" r="1.5" />
            <circle cx="19" cy="5" r="1.5" />
            <circle cx="5" cy="19" r="1.5" />
            <circle cx="19" cy="19" r="1.5" />
            <line x1="9.8" y1="10.2" x2="6.2" y2="6.5" />
            <line x1="14.2" y1="10.2" x2="17.8" y2="6.5" />
            <line x1="9.8" y1="13.8" x2="6.2" y2="17.5" />
            <line x1="14.2" y1="13.8" x2="17.8" y2="17.5" />
          </svg>
          <h1>Thought Plot</h1>
        </div>
        <p className="tagline">conversations into structure</p>
      </header>

      {/* Controls */}
      <Controls
        status={state.status}
        isListening={state.isListening}
        isSpeaking={state.isSpeaking}
        volume={state.volume}
        isExtracting={state.isExtracting}
        transcriptionMode={state.transcriptionMode}
        onStart={startListening}
        onStop={stopListening}
        onReset={handleNewSession}
        onPaste={() => setShowPaste(true)}
        onSendText={sendText}
        onToggleSessions={handleToggleSessions}
        onModeChange={setTranscriptionMode}
        sessionCount={sessionList.length}
      />

      {/* Main layout */}
      <main className="main">
        {/* Session sidebar */}
        {showSessions && (
          <aside className="session-sidebar">
            <SessionPanel
              sessions={sessionList}
              activeSessionId={state.sessionId}
              onSelect={handleSelectSession}
              onDelete={handleDeleteSession}
              onNew={handleNewSession}
            />
          </aside>
        )}

        {/* Center: Diagram */}
        <section className="diagram-section">
          <DiagramView
            graph={state.graph}
            conversations={state.conversations}
            isExtracting={state.isExtracting}
          />
        </section>

        {/* Right: Transcript / Insights */}
        <aside className="side-panel">
          <div className="panel-tabs">
            <button
              className={`panel-tab ${rightPanel === 'transcript' ? 'active' : ''}`}
              onClick={() => setRightPanel('transcript')}
            >
              Transcript
              {state.transcript.length > 0 && <span className="tab-badge">{state.transcript.length}</span>}
            </button>
            <button
              className={`panel-tab ${rightPanel === 'facts' ? 'active' : ''}`}
              onClick={() => setRightPanel('facts')}
            >
              Insights
              {insightCount > 0 && <span className="tab-badge">{insightCount}</span>}
            </button>
          </div>
          <div className="panel-content">
            {rightPanel === 'transcript' ? (
              <Transcript entries={state.transcript} />
            ) : (
              <FactPanel
                factChecks={state.factChecks}
                actionItems={state.actionItems}
                summary={state.summary}
                corrections={state.corrections}
              />
            )}
          </div>
        </aside>
      </main>

      {/* Paste Modal */}
      <PasteModal
        open={showPaste}
        onClose={() => setShowPaste(false)}
        onSubmit={handlePaste}
        isProcessing={state.isProcessingText}
      />
    </div>
  );
}
