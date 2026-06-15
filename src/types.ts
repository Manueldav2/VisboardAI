// ── Graph Structure ──

export type DiagramType = 'flowchart' | 'sequence' | 'mindmap';

export interface GraphNode {
  id: string;
  label: string;
  type: 'process' | 'decision' | 'action' | 'fact' | 'assumption' | 'system' | 'person' | 'idea';
  status?: 'verified' | 'incorrect' | 'assumption' | 'pending';
  owner?: string;
  deadline?: string;
  cluster?: string;
  conversationId?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed' | 'dotted';
}

export interface GraphCluster {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface GraphJSON {
  type: DiagramType;
  title?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters?: GraphCluster[];
}

// ── Conversation Segments ──

export interface ConversationSegment {
  id: string;
  label: string;
  color: string;
  startTime: number;
  nodeIds: string[];
}

// ── Fact Checking ──

export interface FactCheck {
  id: string;
  claim: string;
  status: 'checking' | 'verified' | 'incorrect' | 'assumption';
  confidence?: number;
  correction?: string;
  source?: string;
  sources?: { url: string; title: string }[];
  timestamp: number;
}

// ── Transcript ──

export interface TranscriptEntry {
  id: string;
  speaker: 'user' | 'system';
  text: string;
  timestamp: number;
  isFinal: boolean;
  conversationId?: string;
}

// ── Action Items ──

export interface ActionItem {
  id: string;
  text: string;
  owner?: string;
  deadline?: string;
  done: boolean;
}

// ── Connection ──

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ── Transcription ──

export type TranscriptionMode = 'browser' | 'gemini' | 'whisper';

// ── Extraction Result ──

export interface ExtractionResult {
  graph: GraphJSON;
  summary: string;
  action_items: { text: string; owner?: string; deadline?: string }[];
  fact_checks: { claim: string; status: 'verified' | 'incorrect' | 'assumption'; correction?: string }[];
  corrections: { statement: string; correction: string }[];
}
