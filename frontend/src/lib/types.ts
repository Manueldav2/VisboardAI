export type StudyMode = 'quiz' | 'guided_study' | 'cram' | 'language' | 'strategy' | 'general';

export type PlatformTool = 'study_buddy' | 'thought_plot' | 'architect' | 'argument_ref' | 'general_chat';

export type TranscriptionMode = 'browser' | 'gemini';

export type ThoughtPlotMode = 'general' | 'topic_locked' | 'class_mode' | 'study' | 'quiz';

export interface StudyClass {
  id: string;
  name: string;
  subject: string;
  language: string | null;
  difficulty_level: string;
  teacher: string;
  description: string;
  exam_dates: string[];
  settings: Record<string, unknown>;
  created_at: string;
}

export interface CourseMaterial {
  id: string;
  class_id: string;
  title: string;
  type: string;
  raw_text: string;
  processed: boolean;
  created_at: string;
}

export interface StudySession {
  id: string;
  class_id: string | null;
  mode: StudyMode;
  tool: PlatformTool;
  topic: string | null;
  started_at: string;
}

export interface TranscriptEntry {
  id: string;
  session_id: string;
  speaker: 'user' | 'ai';
  text: string;
  timestamp_ms: number;
}

export interface ConceptMastery {
  id: string;
  class_id: string;
  concept: string;
  mastery_level: number;
  times_tested: number;
  times_correct: number;
}

export interface WebSocketOutgoing {
  type: 'transcript';
  text: string;
  mode: string;
  tool?: PlatformTool;
  class_id?: string;
  topic?: string;
}

export interface WebSocketIncomingAIResponse {
  type: 'ai_response';
  text: string;
  should_speak: boolean;
  audio_data?: string;
  audio_format?: 'pcm';
  audio_sample_rate?: number;
  is_interrupt?: boolean;
  response_type?: string;
  suggestions?: string[];
  option_cards?: { title: string; description: string }[];
}

export interface WebSocketIncomingPlotUpdate {
  type: 'plot_update';
  graph: {
    mermaid_code?: string;
    [key: string]: unknown;
  };
}

export interface WebSocketIncomingFactCheck {
  type: 'fact_check';
  id: string;
  claim: string;
  status: 'incorrect' | 'assumption';
  confidence: number;
  correction: string;
  explanation: string;
  source_excerpt: string;
}

export interface FactCheckNotification extends WebSocketIncomingFactCheck {
  timestamp: number;
  read: boolean;
}

// Architecture Planner types
export type CostTier = 'budget' | 'premium' | 'both';

export interface StackTool {
  id: string;
  name: string;
  category: string;
  description: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  monthly_cost: number;
  website: string;
  reason?: string;
  alternatives?: string[];
  cost_tier: CostTier;
  purpose?: string;
}

export interface ChecklistItem {
  id: string;
  category: string;
  label: string;
  discussed: boolean;
}

export interface HealthScores {
  scalability: number;
  security: number;
  cost_efficiency: number;
  maintainability: number;
  reliability: number;
}

export interface ArchDecision {
  id: string;
  title: string;
  status: 'proposed' | 'accepted' | 'rejected';
  context: string;
}

// Architecture Review types
export interface ReviewCategory {
  score: number;
  grade: string;
  reasoning: string;
}

export interface ReviewStrength {
  title: string;
  description: string;
}

export interface ReviewWeakness {
  title: string;
  description: string;
  anti_pattern: string;
}

export interface ReviewRecommendation {
  title: string;
  description: string;
  impact: 'critical' | 'high' | 'medium' | 'low';
  effort: 'easy' | 'medium' | 'hard';
}

export interface ReviewBreakingPoint {
  component: string;
  scenario: string;
  estimated_load: string;
  mitigation: string;
}

export interface ArchitectureReview {
  requested: boolean;
  overall_score: number;
  overall_grade: string;
  categories: {
    scalability: ReviewCategory;
    security: ReviewCategory;
    cost_efficiency: ReviewCategory;
    maintainability: ReviewCategory;
    reliability: ReviewCategory;
    developer_experience: ReviewCategory;
  };
  strengths: ReviewStrength[];
  weaknesses: ReviewWeakness[];
  recommendations: ReviewRecommendation[];
  breaking_point: ReviewBreakingPoint;
}

export interface ChangelogEntry {
  id: string;
  type: 'diagram' | 'decision' | 'stack' | 'message';
  label: string;
  timestamp: number;
}

export interface ArchitectureState {
  stack: StackTool[];
  checklist: ChecklistItem[];
  health: HealthScores;
  decisions: ArchDecision[];
  changelog: ChangelogEntry[];
}

export interface WebSocketIncomingArchState {
  type: 'architecture_state';
  panel: {
    stack: StackTool[];
    checklist: ChecklistItem[];
    health: HealthScores;
    decisions: ArchDecision[];
    changelog_entry: string;
    diagram_instruction: string;
    review?: ArchitectureReview;
  };
}

// Argument Referee types
export interface FallacyCall {
  id: string;
  name: string;
  category: 'Formal' | 'Relevance' | 'Presumption' | 'Ambiguity' | 'Bad Faith' | 'Factual Error';
  what_was_said: string;
  why_its_wrong: string;
  correct_form: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: number;
}

export interface WebSocketIncomingFallacy {
  type: 'fallacy_call';
  fallacy: FallacyCall;
}

// Live contention tracking
export interface Contention {
  id: string;
  text: string;
  strength: 'strong' | 'moderate' | 'weak';
  evidence_status: 'cited' | 'implied' | 'missing';
  vulnerability: string;
}

export interface WebSocketIncomingContentionUpdate {
  type: 'contention_update';
  contentions: Contention[];
}

// Debate Coach analysis types
export interface DebateContention {
  id: string;
  text: string;
  strength: 'strong' | 'moderate' | 'weak';
  evidence_quality: 'strong' | 'moderate' | 'weak' | 'missing';
  evidence_cited?: string;
  evidence_needed?: string;
  logical_connection?: string;
}

export interface DebateTechnique {
  name: string;
  quality: 'effective' | 'weak' | 'misapplied';
  where: string;
  feedback: string;
}

export interface MissingTechnique {
  name: string;
  why_needed: string;
  example: string;
}

export interface RewriteSuggestion {
  original: string;
  improved: string;
  reason: string;
}

export interface OpponentAttack {
  attack: string;
  counter: string;
}

export interface DebateAnalysis {
  overall_grade: string;
  overall_score: number;
  summary: string;
  argument_structure: {
    thesis: string;
    contentions: DebateContention[];
    rebuttals_addressed?: string[];
    rebuttals_missing?: string[];
  };
  techniques_used: DebateTechnique[];
  techniques_missing: MissingTechnique[];
  fallacies: {
    name: string;
    category: string;
    what_was_said: string;
    why_its_wrong: string;
    correct_form: string;
    severity: 'low' | 'medium' | 'high';
  }[];
  how_to_win: {
    strongest_points: string[];
    weakest_links: string[];
    missing_evidence: string[];
    rewrite_suggestions: RewriteSuggestion[];
    opponent_likely_attacks: OpponentAttack[];
  };
}

export interface TechniqueDetection {
  id: string;
  name: string;
  quality: 'effective' | 'weak' | 'misapplied';
  feedback: string;
  contention_strength: string;
  timestamp: number;
}

export interface WebSocketIncomingDebateAnalysis {
  type: 'debate_analysis';
  analysis: DebateAnalysis;
}

export interface WebSocketIncomingTechnique {
  type: 'technique_detected';
  technique: TechniqueDetection;
}

export interface WebSocketIncomingAudio {
  type: 'ai_audio';
  audio_data: string;
  audio_format: 'pcm';
  audio_sample_rate: number;
}

export interface WebSocketIncomingTtsFailed {
  type: 'tts_failed';
}

export interface WebSocketIncomingToolSuggestion {
  type: 'tool_suggestion';
  tool: string;
  mode: string;
  confidence: number;
  reason: string;
}

export interface WebSocketIncomingToolActivated {
  type: 'tool_activated';
  tool: string;
  mode: string;
  reason: string;
}

export interface WebSocketIncomingToolDeactivated {
  type: 'tool_deactivated';
}

export type WebSocketIncoming =
  | WebSocketIncomingAIResponse
  | WebSocketIncomingPlotUpdate
  | WebSocketIncomingFactCheck
  | WebSocketIncomingArchState
  | WebSocketIncomingFallacy
  | WebSocketIncomingContentionUpdate
  | WebSocketIncomingAudio
  | WebSocketIncomingTtsFailed
  | WebSocketIncomingDebateAnalysis
  | WebSocketIncomingTechnique
  | WebSocketIncomingToolSuggestion
  | WebSocketIncomingToolActivated
  | WebSocketIncomingToolDeactivated;

// Session history types
export interface SessionListItem {
  id: string;
  user_id: string;
  class_id: string | null;
  mode: string;
  tool: string;
  topic: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
}

export interface SessionTranscriptEntry {
  id: string;
  session_id: string;
  speaker: 'user' | 'ai' | 'system';
  text: string;
  timestamp_ms: number;
}

export interface SessionDetail {
  session: SessionListItem;
  transcript: SessionTranscriptEntry[];
  summary: {
    summary: string;
    topics_covered: string[];
    weak_topics: string[];
  } | null;
  thought_plot: {
    id: string;
    graph_json: Record<string, unknown>;
    title: string | null;
    summary: string | null;
  } | null;
}
