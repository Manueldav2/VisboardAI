# Gideon v2 — Full Redesign

## Voice Engine: OpenAI Realtime API
- WebRTC direct from browser to OpenAI (ephemeral token from backend)
- Backend WebSocket for background agents (plotter, fact-checker, architect, referee)
- Function calling for tool activation, diagram generation, architecture updates
- System prompt swaps entirely on tool switch via session.update

## UI: Transform-in-Place
- Single page (/) morphs based on active tool
- General Chat: Quick actions, clean conversation
- Architect: Full 8-tab right panel (STACK/PLOT/CHECK/HEALTH/COSTS/DECIDE/LOG/ARCH)
- Study Buddy: Mode pills, class/topic selectors, concept map panel
- Thought Plot: Full-screen diagram primary, chat secondary
- Argument Ref: Fallacy tracker, contention panel, debate scoring

## Sessions: Auto-Save on Tool Switch + End
- Sidebar shows conversations with nested tool sections
- Each tool section saves its artifacts (stack, diagrams, scores, etc.)
- Clicking restores full state
- Post-session agent runs on end

## Fact-Checking: Always Active
- Every transcript forwarded to backend for fact-checking
- Aggressive mode when in Thought Plot
- Inline cards for incorrect claims and assumptions

## Implementation Order
1. Backend: OpenAI Realtime token endpoint + function definitions
2. Frontend: WebRTC connection + audio handling
3. Frontend: Transform-in-place UI with all tool panels
4. Frontend: Session sidebar with auto-save
5. Backend: Connect background agents to transcript forwarding
6. Integration testing + polish
