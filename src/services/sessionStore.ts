/**
 * Session Store — persists Thought Plot sessions to localStorage.
 */

import type { GraphJSON, TranscriptEntry, FactCheck, ActionItem, ConversationSegment } from '../types';

export interface SessionMetadata {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  preview: string;
}

export interface SessionData {
  metadata: SessionMetadata;
  graph: GraphJSON;
  transcript: TranscriptEntry[];
  factChecks: FactCheck[];
  actionItems: ActionItem[];
  summary: string;
  corrections: { statement: string; correction: string }[];
  conversations: ConversationSegment[];
  transcriptText: string;
}

const SESSIONS_KEY = 'thought-plot-sessions';
const SESSION_PREFIX = 'tp-session-';
const MAX_SESSIONS = 20;

export function listSessions(): SessionMetadata[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as SessionMetadata[])
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveSession(data: SessionData): void {
  try {
    localStorage.setItem(SESSION_PREFIX + data.metadata.id, JSON.stringify(data));

    const sessions = listSessions();
    const idx = sessions.findIndex(s => s.id === data.metadata.id);
    if (idx >= 0) {
      sessions[idx] = data.metadata;
    } else {
      sessions.push(data.metadata);
    }

    // Prune oldest if over limit
    while (sessions.length > MAX_SESSIONS) {
      const oldest = sessions.sort((a, b) => a.updatedAt - b.updatedAt)[0];
      localStorage.removeItem(SESSION_PREFIX + oldest.id);
      sessions.splice(sessions.indexOf(oldest), 1);
    }

    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn('Failed to save session:', e);
  }
}

export function loadSession(id: string): SessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export function deleteSession(id: string): void {
  try {
    localStorage.removeItem(SESSION_PREFIX + id);
    const sessions = listSessions().filter(s => s.id !== id);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // ignore
  }
}
