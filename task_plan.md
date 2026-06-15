# Task Plan: Mermaid Diagrams + Harvey Specter Mode

## Goal
Add Mermaid diagram support to Study Buddy and Argument Ref, plus a new "Harvey Specter" mode to Argument Ref that argues back aggressively.

---

## Phase 1: Study Buddy — Concept Map Diagrams
**Status**: pending

### What
The backend already sends `plot_update` messages for quiz/guided_study/general modes via the plotter agent. The frontend just ignores them. Add a toggle on the right panel to switch between "Live Transcript" and "Concept Map".

### Files to modify
- `frontend/src/app/study-buddy/page.tsx`
  - Add mermaid state (`mermaidCode`, `zoom`, refs)
  - Add mermaid init + render effects (copy pattern from thought-plot)
  - Handle `plot_update` in WebSocket `onmessage`
  - Add toggle button in right panel header: TRANSCRIPT | MAP
  - Add mermaid container with zoom controls

- `backend/agents/prompts.py`
  - Update plotter prompt for study modes to generate **teaching-oriented** diagrams:
    - Show term connections, concept hierarchies
    - Mark wrong answers/pronunciations with `incorrect` node type
    - Visual learning aids, not just transcription plots

### Backend changes needed
- Update the plotter agent's study mode prompts to emphasize:
  - Concept relationship mapping (not transcript plotting)
  - Highlighting corrections (wrong terms → right terms)
  - Building knowledge graphs that help students see how things connect

---

## Phase 2: Argument Ref — Debate Diagram in Scoreboard
**Status**: pending

### What
Add a PLOT tab to the argument-ref scoreboard sidebar that visualizes both sides' arguments, fallacies, and weak points as a Mermaid diagram.

### Files to modify
- `frontend/src/app/argument-ref/page.tsx`
  - Add mermaid state + init + render effects
  - Handle `plot_update` in WebSocket `onmessage`
  - Add PLOT tab toggle at top of scoreboard (SCORE | PLOT)
  - Add mermaid container with zoom controls in scoreboard

- `backend/main.py` (argument_ref handler section, ~lines 446-510)
  - After referee analysis, run plotter agent to generate debate diagram
  - Send `plot_update` WebSocket message with mermaid code
  - Track existing_graph for argument_ref sessions (merge new arguments)

- `backend/agents/prompts.py`
  - Add `REFEREE_PLOTTER_PROMPT` — debate-specific diagram instructions:
    - Two sides: Argument vs Counter-argument
    - Fallacy nodes (red, dashed border) connected to the claim they apply to
    - Strong arguments (green), weak arguments (red), neutral (default)
    - Evidence nodes connected to claims they support

- `backend/agents/plotter_agent.py`
  - Add `argument_ref` mode support with debate-specific graph structure

---

## Phase 3: Harvey Specter Mode — Devil's Advocate
**Status**: pending

### What
New mode in Argument Ref where the AI actively argues AGAINST you. Like Harvey Specter from Suits — the best argumentative lawyer poking holes through your debate. Male voice, aggressive, research-backed.

### Design
- Mode toggle at top of argument-ref page: "Referee" (default) vs "Harvey Specter"
- In Harvey mode:
  - AI automatically takes the opposing side
  - Uses Google Search grounding for evidence
  - Validates claims that ARE backed by evidence
  - Ruthlessly attacks weak arguments
  - Male voice (not Charon — use a different male voice like Puck or Fenrir)
  - Scores YOUR argument quality, not both sides

### Files to modify
- `frontend/src/app/argument-ref/page.tsx`
  - Add mode toggle: Referee | Harvey Specter
  - Send mode in WebSocket message (`mode: 'harvey'` vs `mode: 'referee'`)
  - Different UI treatment: Harvey's responses are styled differently (gold/power theme)
  - Scoreboard adapts: shows "Your Argument Strength" instead of "Debate Health"

- `backend/agents/referee_agent.py`
  - Add `argue_back()` function — new Harvey Specter agent
  - Uses Google Search grounding for counter-arguments
  - Returns: counter_argument text + validated/debunked claims + argument_quality score
  - Structured output schema for Harvey responses

- `backend/agents/prompts.py`
  - Add `HARVEY_SPECTER_PROMPT` — aggressive opposing counsel persona
  - "You are Harvey Specter. The best closer in NYC..."
  - Always opposes user's position with evidence
  - Acknowledges strong points but finds weaknesses
  - Never kind, always sharp

- `backend/main.py`
  - Add harvey mode branch in argument_ref handler
  - Run Google Search grounded research for counter-arguments
  - Different TTS voice (male — Fenrir for aggressive authority)
  - Send structured response with counter-arguments + score

- `frontend/src/lib/types.ts`
  - Add HarveyResponse type
  - Add argument quality scoring types

- `backend/agents/prompts.py`
  - Add voice: Fenrir (matches aggressive male authority)

---

## Implementation Order
1. Phase 1 (Study Buddy diagrams) — easiest, backend already sends data
2. Phase 2 (Argument Ref diagrams) — moderate, needs new plotter integration
3. Phase 3 (Harvey Specter mode) — most complex, new agent + UI mode
