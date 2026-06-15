/**
 * Main orchestration hook for Thought Plot.
 *
 * Pipeline:
 *   Audio → Transcriber (browser / gemini / whisper) → transcript text
 *                           ↓
 *                     Extractor (Gemini REST) → GraphJSON
 *                           ↓
 *                   Mermaid → Render
 *
 *   [background] Assumptions → Gemini → verify
 *   [persist] State → localStorage
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  GraphJSON, TranscriptEntry, FactCheck, ActionItem,
  ConnectionStatus, ConversationSegment, TranscriptionMode,
} from '../types';
import { extractStructure } from '../services/extractor';
import { GeminiLiveService, speakCorrection } from '../services/geminiLive';
import { VoiceRecorder } from '../services/recorder';
import { transcribeAudio } from '../services/whisper';
import { verifyClaimsBatch } from '../services/factChecker';
import { emptyGraph, mergeGraphs } from '../services/graphEngine';
import { ClaimRegistry } from '../services/claimRegistry';
import { saveSession, loadSession, listSessions, deleteSession } from '../services/sessionStore';
import type { SessionMetadata } from '../services/sessionStore';
import { CONVERSATION_COLORS } from '../services/graphEngine';

export interface ThoughtPlotState {
  graph: GraphJSON;
  transcript: TranscriptEntry[];
  factChecks: FactCheck[];
  actionItems: ActionItem[];
  summary: string;
  corrections: { statement: string; correction: string }[];
  conversations: ConversationSegment[];
  activeConversationId: string;
  status: ConnectionStatus;
  isListening: boolean;
  isSpeaking: boolean;
  volume: number;
  isProcessingText: boolean;
  isExtracting: boolean;
  sessionId: string;
  transcriptionMode: TranscriptionMode;
}

function newId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeInitialState(): ThoughtPlotState {
  const sessionId = newId();
  const convId = `conv_${newId()}`;
  return {
    graph: emptyGraph(),
    transcript: [],
    factChecks: [],
    actionItems: [],
    summary: '',
    corrections: [],
    conversations: [{
      id: convId,
      label: 'Conversation 1',
      color: CONVERSATION_COLORS[0].stroke,
      startTime: Date.now(),
      nodeIds: [],
    }],
    activeConversationId: convId,
    status: 'disconnected',
    isListening: false,
    isSpeaking: false,
    volume: 0,
    isProcessingText: false,
    isExtracting: false,
    sessionId,
    transcriptionMode: 'browser',
  };
}

export function useThoughtPlot() {
  const [state, setState] = useState<ThoughtPlotState>(makeInitialState);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const geminiLiveRef = useRef<GeminiLiveService | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const transcriptTextRef = useRef('');
  const claimRegistryRef = useRef(new ClaimRegistry());
  const extractionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extractionInProgressRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionCreatedRef = useRef(Date.now());
  const lastSummaryRef = useRef('');

  // ── Set transcription mode ──

  const setTranscriptionMode = useCallback((mode: TranscriptionMode) => {
    setState(prev => ({ ...prev, transcriptionMode: mode }));
  }, []);

  // ── Add transcript entry ──

  const addTranscript = useCallback((text: string, speaker: 'user' | 'system') => {
    if (!text.trim()) return;
    const entry: TranscriptEntry = {
      id: `t_${newId()}`, speaker, text: text.trim(),
      timestamp: Date.now(), isFinal: true,
      conversationId: stateRef.current.activeConversationId,
    };
    setState(prev => ({ ...prev, transcript: [...prev.transcript, entry] }));
    if (speaker === 'user') {
      transcriptTextRef.current += `\n${text.trim()}`;
    }
  }, []);

  // ── Detect topic shift → new conversation segment ──

  const checkTopicShift = useCallback((newSummary: string) => {
    const prev = lastSummaryRef.current;
    if (!prev || !newSummary) {
      lastSummaryRef.current = newSummary;
      return;
    }

    const wordsA = new Set(prev.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(newSummary.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) {
      lastSummaryRef.current = newSummary;
      return;
    }

    const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
    const wordSimilarity = (2 * overlap) / (wordsA.size + wordsB.size);

    const extractEntities = (text: string) => {
      const words = text.split(/\s+/);
      const entities = new Set<string>();
      for (const w of words) {
        if (w.length > 2 && (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase())) {
          entities.add(w.toLowerCase());
        }
      }
      return entities;
    };

    const entitiesA = extractEntities(prev);
    const entitiesB = extractEntities(newSummary);
    let entitySimilarity = 1;
    if (entitiesA.size > 0 && entitiesB.size > 0) {
      const entityOverlap = [...entitiesA].filter(e => entitiesB.has(e)).length;
      entitySimilarity = (2 * entityOverlap) / (entitiesA.size + entitiesB.size);
    }

    const combinedSimilarity = wordSimilarity * 0.6 + entitySimilarity * 0.4;

    if (combinedSimilarity < 0.2 && stateRef.current.graph.nodes.length > 3) {
      const convIdx = stateRef.current.conversations.length;
      const convId = `conv_${newId()}`;
      const color = CONVERSATION_COLORS[convIdx % CONVERSATION_COLORS.length];
      const label = newSummary.slice(0, 50).replace(/\s+\S*$/, '') || `Topic ${convIdx + 1}`;

      setState(prev => ({
        ...prev,
        conversations: [...prev.conversations, {
          id: convId, label, color: color.stroke, startTime: Date.now(), nodeIds: [],
        }],
        activeConversationId: convId,
      }));
    }

    lastSummaryRef.current = newSummary;
  }, []);

  // ── Trigger extraction (debounced) ──

  const triggerExtraction = useCallback(() => {
    if (extractionTimerRef.current) clearTimeout(extractionTimerRef.current);

    extractionTimerRef.current = setTimeout(async () => {
      const text = transcriptTextRef.current.trim();
      if (!text || extractionInProgressRef.current) return;

      extractionInProgressRef.current = true;
      setState(prev => ({ ...prev, isExtracting: true }));

      try {
        const currentState = stateRef.current;
        const result = await extractStructure(
          text,
          claimRegistryRef.current.getAllClaims(),
          currentState.graph.nodes.length > 0 ? currentState.graph : undefined
        );

        if (result) {
          const activeConv = currentState.activeConversationId;
          result.graph.nodes = result.graph.nodes.map(n => ({
            ...n, conversationId: n.conversationId || activeConv,
          }));

          checkTopicShift(result.summary);

          setState(prev => {
            const mergedGraph = mergeGraphs(prev.graph, result.graph);

            const existingTexts = new Set(prev.actionItems.map(a => a.text));
            const newActions = (result.action_items || [])
              .filter(a => !existingTexts.has(a.text))
              .map(a => ({
                id: `ai_${newId()}`, text: a.text,
                owner: a.owner, deadline: a.deadline, done: false,
              }));

            const newFactChecks: FactCheck[] = (result.fact_checks || [])
              .filter(fc => claimRegistryRef.current.register(fc.claim))
              .map(fc => ({
                id: `fc_${newId()}`, claim: fc.claim, status: fc.status,
                correction: fc.correction, timestamp: Date.now(),
              }));

            const newCorrections = (result.corrections || [])
              .filter(c => claimRegistryRef.current.register(c.statement));

            for (const corr of newCorrections) {
              speakCorrection(corr.correction);
              prev = {
                ...prev,
                transcript: [...prev.transcript, {
                  id: `corr_${newId()}`, speaker: 'system' as const,
                  text: `Correction: ${corr.correction}`,
                  timestamp: Date.now(), isFinal: true,
                }],
              };
            }

            return {
              ...prev,
              graph: mergedGraph,
              summary: result.summary || prev.summary,
              actionItems: [...prev.actionItems, ...newActions],
              factChecks: [...prev.factChecks, ...newFactChecks],
              corrections: [...prev.corrections, ...newCorrections],
              isExtracting: false,
            };
          });

          // Background fact-check
          const claimsToVerify = (result.fact_checks || []).filter(
            fc => fc.status === 'assumption' || fc.status === 'verified'
          );
          if (claimsToVerify.length > 0) {
            verifyClaimsBatch(claimsToVerify, (verified) => {
              setState(prev => {
                const idx = prev.factChecks.findIndex(f => f.claim === verified.claim);
                if (idx < 0) return prev;
                const updated = [...prev.factChecks];
                updated[idx] = verified;

                let updatedGraph = prev.graph;
                if (verified.status === 'incorrect' || verified.status === 'verified') {
                  const claimWords = verified.claim.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                  updatedGraph = {
                    ...prev.graph,
                    nodes: prev.graph.nodes.map(n => {
                      if (n.status === 'assumption' || n.status === 'pending' || !n.status) {
                        const labelLower = n.label.toLowerCase();
                        const matchCount = claimWords.filter(w => labelLower.includes(w)).length;
                        if (matchCount >= 2 || labelLower.includes(verified.claim.toLowerCase().slice(0, 20))) {
                          return { ...n, status: verified.status as 'verified' | 'incorrect' };
                        }
                      }
                      return n;
                    }),
                  };

                  if (verified.status === 'incorrect' && verified.correction) {
                    speakCorrection(`Correction: ${verified.correction}`);
                  }
                }

                return { ...prev, factChecks: updated, graph: updatedGraph };
              });
            });
          }
        } else {
          setState(prev => ({ ...prev, isExtracting: false }));
        }
      } catch (err) {
        console.error('Extraction error:', err);
        setState(prev => ({ ...prev, isExtracting: false }));
      }

      extractionInProgressRef.current = false;
    }, 1500);
  }, [checkTopicShift]);

  // ── Stop everything ──

  const stopAll = useCallback(() => {
    // Stop browser speech recognition
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* */ }
      recognitionRef.current = null;
    }
    // Stop recorder
    recorderRef.current?.stop();
    recorderRef.current = null;
    // Stop Gemini Live
    geminiLiveRef.current?.disconnect();
    geminiLiveRef.current = null;
  }, []);

  // ── Start: Browser Speech Recognition ──

  const startBrowser = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setState(prev => ({ ...prev, status: 'error' }));
      console.error('Browser Speech Recognition not supported');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    let lastFinalIndex = 0;

    recognition.onstart = () => {
      setState(prev => ({ ...prev, status: 'connected', isListening: true }));
    };

    recognition.onresult = (event: any) => {
      // Collect only NEW final results since last check
      let finalText = '';
      for (let i = lastFinalIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
          lastFinalIndex = i + 1;
        }
      }
      if (finalText.trim()) {
        addTranscript(finalText.trim(), 'user');
        triggerExtraction();
      }

      // Show speaking state from interim results
      const lastResult = event.results[event.results.length - 1];
      setState(prev => ({ ...prev, isSpeaking: !lastResult.isFinal }));
    };

    recognition.onerror = (event: any) => {
      // 'no-speech' is not fatal — just no audio detected yet
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.warn('Speech recognition error:', event.error);
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (recognitionRef.current === recognition) {
        try { recognition.start(); } catch { /* already started */ }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [addTranscript, triggerExtraction]);

  // ── Start: Gemini Live ──

  const startGemini = useCallback(async () => {
    setState(prev => ({ ...prev, status: 'connecting' }));

    const geminiLive = new GeminiLiveService({
      onConnected: () => {
        console.log('Gemini Live connected');
        setState(prev => ({ ...prev, status: 'connected' }));
      },
      onDisconnected: () => {
        console.log('Gemini Live disconnected');
        // Don't set disconnected status if we're still supposed to be listening —
        // the recorder is still running so mark as connected
      },
      onError: (err) => {
        console.warn('Gemini Live error:', err);
      },
      onTranscript: (text) => {
        if (text && text.trim().length > 1) {
          addTranscript(text, 'user');
          triggerExtraction();
        }
      },
    });

    geminiLiveRef.current = geminiLive;

    try {
      const connected = await geminiLive.connect();
      if (!connected) {
        console.warn('Gemini Live failed — starting anyway, audio still records');
      }
    } catch (err) {
      console.warn('Gemini Live connect error:', err);
    }

    // Recorder streams PCM to Gemini Live
    const recorder = new VoiceRecorder({
      onPCMData: (b64) => {
        if (geminiLive.isConnected) geminiLive.sendAudio(b64);
      },
      onSpeechSegment: async (blob) => {
        // If Gemini Live is down, use Whisper as fallback
        if (!geminiLive.isConnected) {
          try {
            const text = await transcribeAudio(blob);
            if (text && text.trim().length > 1) {
              addTranscript(text, 'user');
              triggerExtraction();
            }
          } catch (e) {
            console.warn('Whisper fallback failed:', e);
          }
        }
      },
      onVolume: (rms) => setState(prev => ({ ...prev, volume: rms })),
      onSpeechStart: () => setState(prev => ({ ...prev, isSpeaking: true })),
      onSpeechEnd: () => setState(prev => ({ ...prev, isSpeaking: false })),
    }, { skipMediaRecorder: false });

    await recorder.start();
    recorderRef.current = recorder;
    setState(prev => ({ ...prev, isListening: true, status: 'connected' }));
  }, [addTranscript, triggerExtraction]);

  // ── Start: Whisper ──

  const startWhisper = useCallback(async () => {
    setState(prev => ({ ...prev, status: 'connecting' }));

    const recorder = new VoiceRecorder({
      onPCMData: () => { /* not needed for Whisper mode */ },
      onSpeechSegment: async (blob) => {
        try {
          const text = await transcribeAudio(blob);
          if (text && text.trim().length > 1) {
            addTranscript(text, 'user');
            triggerExtraction();
          }
        } catch (e) {
          console.warn('Whisper transcription failed:', e);
        }
      },
      onVolume: (rms) => setState(prev => ({ ...prev, volume: rms })),
      onSpeechStart: () => setState(prev => ({ ...prev, isSpeaking: true })),
      onSpeechEnd: () => setState(prev => ({ ...prev, isSpeaking: false })),
    }, { skipMediaRecorder: false });

    await recorder.start();
    recorderRef.current = recorder;
    setState(prev => ({ ...prev, isListening: true, status: 'connected' }));
  }, [addTranscript, triggerExtraction]);

  // ── Start listening (dispatches to mode) ──

  const startListening = useCallback(async () => {
    const mode = stateRef.current.transcriptionMode;
    try {
      if (mode === 'browser') {
        startBrowser();
      } else if (mode === 'gemini') {
        await startGemini();
      } else {
        await startWhisper();
      }
    } catch (err) {
      console.error('Start listening error:', err);
      setState(prev => ({ ...prev, status: 'error' }));
    }
  }, [startBrowser, startGemini, startWhisper]);

  // ── Stop listening ──

  const stopListening = useCallback(() => {
    if (extractionTimerRef.current) clearTimeout(extractionTimerRef.current);
    stopAll();
    setState(prev => ({
      ...prev, isListening: false, isSpeaking: false, volume: 0, status: 'disconnected',
    }));
    // Final extraction
    triggerExtraction();
  }, [stopAll, triggerExtraction]);

  // ── Send typed text ──

  const sendText = useCallback((text: string) => {
    addTranscript(text, 'user');
    triggerExtraction();
  }, [addTranscript, triggerExtraction]);

  // ── Process pasted text ──

  const processText = useCallback(async (text: string) => {
    setState(prev => ({ ...prev, isProcessingText: true, isExtracting: true }));
    transcriptTextRef.current = text;
    addTranscript(text, 'user');

    try {
      const result = await extractStructure(text);
      if (result) {
        const activeConv = stateRef.current.activeConversationId;
        result.graph.nodes = result.graph.nodes.map(n => ({
          ...n, conversationId: n.conversationId || activeConv,
        }));

        const newActions = (result.action_items || []).map(a => ({
          id: `ai_${newId()}`, text: a.text, owner: a.owner, deadline: a.deadline, done: false,
        }));

        const newFacts: FactCheck[] = (result.fact_checks || []).map(fc => {
          claimRegistryRef.current.register(fc.claim);
          return {
            id: `fc_${newId()}`, claim: fc.claim, status: fc.status,
            correction: fc.correction, timestamp: Date.now(),
          };
        });

        for (const corr of result.corrections || []) {
          addTranscript(`Correction: ${corr.correction}`, 'system');
          speakCorrection(corr.correction);
        }

        setState(prev => ({
          ...prev,
          graph: result.graph,
          summary: result.summary || '',
          actionItems: newActions,
          factChecks: newFacts,
          corrections: result.corrections || [],
          isProcessingText: false,
          isExtracting: false,
        }));

        // Background verify
        const claimsToVerify = (result.fact_checks || []).filter(
          fc => fc.status === 'assumption' || fc.status === 'verified'
        );
        if (claimsToVerify.length > 0) {
          verifyClaimsBatch(claimsToVerify, (verified) => {
            setState(prev => {
              const idx = prev.factChecks.findIndex(f => f.claim === verified.claim);
              if (idx < 0) return prev;
              const updated = [...prev.factChecks];
              updated[idx] = verified;

              let updatedGraph = prev.graph;
              if (verified.status === 'incorrect' || verified.status === 'verified') {
                const claimWords = verified.claim.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                updatedGraph = {
                  ...prev.graph,
                  nodes: prev.graph.nodes.map(n => {
                    if (n.status === 'assumption' || n.status === 'pending' || !n.status) {
                      const labelLower = n.label.toLowerCase();
                      const matchCount = claimWords.filter(w => labelLower.includes(w)).length;
                      if (matchCount >= 2 || labelLower.includes(verified.claim.toLowerCase().slice(0, 20))) {
                        return { ...n, status: verified.status as 'verified' | 'incorrect' };
                      }
                    }
                    return n;
                  }),
                };

                if (verified.status === 'incorrect' && verified.correction) {
                  speakCorrection(`Correction: ${verified.correction}`);
                }
              }

              return { ...prev, factChecks: updated, graph: updatedGraph };
            });
          });
        }
      } else {
        setState(prev => ({ ...prev, isProcessingText: false, isExtracting: false }));
      }
    } catch {
      setState(prev => ({ ...prev, isProcessingText: false, isExtracting: false }));
    }
  }, [addTranscript]);

  // ── Session management ──

  const loadPastSession = useCallback((sessionId: string) => {
    const data = loadSession(sessionId);
    if (!data) return;

    stopAll();

    claimRegistryRef.current.clear();
    for (const fc of data.factChecks) claimRegistryRef.current.register(fc.claim);
    for (const c of data.corrections) claimRegistryRef.current.register(c.statement);

    transcriptTextRef.current = data.transcriptText || '';
    sessionCreatedRef.current = data.metadata.createdAt;
    lastSummaryRef.current = data.summary || '';

    setState(prev => ({
      graph: data.graph,
      transcript: data.transcript,
      factChecks: data.factChecks,
      actionItems: data.actionItems,
      summary: data.summary,
      corrections: data.corrections,
      conversations: data.conversations || [],
      activeConversationId: data.conversations?.[data.conversations.length - 1]?.id || '',
      status: 'disconnected',
      isListening: false,
      isSpeaking: false,
      volume: 0,
      isProcessingText: false,
      isExtracting: false,
      sessionId: data.metadata.id,
      transcriptionMode: prev.transcriptionMode,
    }));
  }, [stopAll]);

  const getSessions = useCallback((): SessionMetadata[] => {
    return listSessions();
  }, []);

  const removeSession = useCallback((id: string) => {
    deleteSession(id);
  }, []);

  // ── Reset ──

  const reset = useCallback(() => {
    stopAll();
    if (extractionTimerRef.current) clearTimeout(extractionTimerRef.current);
    transcriptTextRef.current = '';
    claimRegistryRef.current.clear();
    lastSummaryRef.current = '';
    sessionCreatedRef.current = Date.now();
    setState(prev => ({
      ...makeInitialState(),
      transcriptionMode: prev.transcriptionMode,
    }));
  }, [stopAll]);

  // ── Auto-save ──

  useEffect(() => {
    if (state.transcript.length === 0 && state.graph.nodes.length === 0) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveSession({
        metadata: {
          id: state.sessionId,
          title: state.summary?.slice(0, 60) || 'Untitled Session',
          createdAt: sessionCreatedRef.current,
          updatedAt: Date.now(),
          nodeCount: state.graph.nodes.length,
          preview: state.summary?.slice(0, 100) || state.transcript[0]?.text?.slice(0, 100) || '',
        },
        graph: state.graph,
        transcript: state.transcript,
        factChecks: state.factChecks,
        actionItems: state.actionItems,
        summary: state.summary,
        corrections: state.corrections,
        conversations: state.conversations,
        transcriptText: transcriptTextRef.current,
      });
    }, 2000);
  }, [state.graph, state.transcript.length, state.factChecks.length, state.summary, state.sessionId]);

  // ── Cleanup ──

  useEffect(() => {
    return () => {
      stopAll();
      if (extractionTimerRef.current) clearTimeout(extractionTimerRef.current);
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [stopAll]);

  return {
    state,
    startListening,
    stopListening,
    sendText,
    processText,
    reset,
    setTranscriptionMode,
    loadPastSession,
    getSessions,
    removeSession,
  };
}
