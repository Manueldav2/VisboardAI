# Gideon — Unified AI Assistant Design

## Vision
Gideon is a unified AI assistant that replaces the current multi-page tool navigation. Users open the app, talk to Gideon (voice or text), and Gideon dynamically uses Study Buddy, Thought Plot, Architect, and Argument Ref as internal "skills" — activating them contextually based on what the user needs.

Gideon is a **smart friend** — casual, warm, uses humor. Like a really smart friend who happens to know everything.

## Architecture

```
User speaks/types → Gideon Orchestrator Agent (GPT-4.1-mini, function calling)
                     ├→ Student Profile (Supabase) — loads history, preferences, strengths
                     ├→ Active Skill(s) — multiple can run simultaneously:
                     │   ├ study_buddy (quiz, guided, cram, language)
                     │   ├ thought_plot (concept mapping — ALWAYS runs)
                     │   ├ architect (stack planning, code questions)
                     │   ├ argument_ref (debate, Harvey, contentions)
                     │   └ general (just chatting)
                     ├→ Voice Agent (Gemini TTS, Fenrir voice)
                     └→ Plotter Agent — always runs, builds persistent thought map
```

### Key Principles
- **No triggers/keywords** — AI contextually understands what user needs
- **Multiple skills simultaneously** — quiz + thought map, debate + fact-check
- **Learns communication style** — tracks voice vs text, response length preference
- **Proactive** — suggests what to study, offers hints, challenges when ready
- **Tone adaptation** — encouraging, patient, challenging based on context

## Student Profile (Supabase)

### New table: `student_profiles`
```sql
CREATE TABLE student_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'default',
  learning_style TEXT DEFAULT 'adaptive',
  preferred_pace TEXT DEFAULT 'moderate',
  personality_notes TEXT,
  voice_vs_text_ratio FLOAT DEFAULT 0.5,
  avg_response_length TEXT DEFAULT 'medium',
  prefers_hints BOOLEAN DEFAULT true,
  prefers_challenges BOOLEAN DEFAULT false,
  engagement_signals JSONB DEFAULT '{}',
  preferred_study_time TEXT,
  strongest_topics JSONB DEFAULT '[]',
  weakest_topics JSONB DEFAULT '[]',
  debate_strengths JSONB DEFAULT '[]',
  debate_weaknesses JSONB DEFAULT '[]',
  study_streak_days INT DEFAULT 0,
  total_study_minutes INT DEFAULT 0,
  total_sessions INT DEFAULT 0,
  last_session_summary TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### New table: `study_plans`
```sql
CREATE TABLE study_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES classes(id),
  plan_type TEXT NOT NULL,
  topics JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);
```

### Enhanced: `session_summaries`
Add columns: `key_insights TEXT`, `skills_used JSONB`, `student_mood TEXT`

## Orchestrator Agent

The orchestrator replaces the simple intent classifier. It uses GPT-4.1-mini with function calling and receives:
- Current message
- Recent conversation (last 6 messages)
- Student profile summary
- Currently active skills
- Session duration

Returns:
```json
{
  "active_skills": ["study_buddy:quiz", "thought_plot"],
  "deactivate_skills": [],
  "reasoning": "Student asked to be quizzed while mapping concepts",
  "gideon_tone": "encouraging"
}
```

## Contention System

When debate/argument skill is active:

1. **Auto-extraction**: AI identifies claims from user speech, creates contention cards
2. **Live updates**: Strength upgrades/downgrades based on evidence and fallacies
3. **WebSocket message**: `contention_update` type with numbered contentions
4. **Post-debate report**: Summary of which contentions held up

### New WebSocket type
```json
{
  "type": "contention_update",
  "contentions": [
    {
      "id": "c1",
      "text": "Solar is cheaper than coal",
      "strength": "moderate",
      "evidence_status": "cited",
      "vulnerability": "didn't address storage costs"
    }
  ]
}
```

## UI Design

### Gideon Page (`/` — home page)
- **Header**: Gideon name, quick toggles (MAP, STATS, SAVES)
- **Main area**: Chat bubbles with inline skill cards
- **Bottom bar**: Mic button, active skill pills, text input, send
- **Right panel (desktop)**: Toggle MAP / STATS / SAVES

### Skill Cards (inline, collapsible)
- Quiz cards: question number, topic, difficulty, hint toggle
- Contention cards: numbered, strength bar, evidence status
- Fallacy alerts: severity-colored, quoted text, correction
- Architecture updates: stack count, cost, changelog
- Fact-check cards: status badge, claim, correction

### Mobile
- Full-screen chat, large mic button
- Active skills as colored pills above input
- MAP/STATS/SAVES via bottom sheet overlay
- 44px touch targets

### Welcome Screen (no active session)
- Personalized greeting with study streak
- "Last time we worked on..." summary
- Suggested activities based on weak areas / upcoming exams
- Quick action chips

## Persistent Thought Map
- Mermaid diagrams ALWAYS generate regardless of active skill
- Different diagram types per skill context:
  - Study: concept relationship map
  - Debate: argument structure map
  - Architecture: system diagram
- All diagrams saveable
- Architecture prompts/build files exportable

## Implementation Phases

### Phase 1: Student Profile + Memory
- Create Supabase tables
- Build profile loader in get_session_context
- Post-session agent to update profile

### Phase 2: Gideon Orchestrator
- Replace intent classifier with orchestrator agent
- Multi-skill activation support
- Tone/style adaptation

### Phase 3: Gideon UI (home page)
- New `/` page with Gideon interface
- Inline skill cards
- Active skill pills
- Welcome screen with personalization

### Phase 4: Contention System
- Backend contention extraction
- WebSocket contention_update messages
- Frontend contention cards
- Post-debate report

### Phase 5: Enhanced Study Buddy
- Better quiz types (MCQ, fill-blank, explain-to-me)
- Proactive study suggestions
- Source-grounded answers from uploaded materials
- Progress dashboard in STATS panel
