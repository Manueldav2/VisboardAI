# Gideon Listener — Granola-style always-on meeting companion (SCOPE)

> North Star: turn Gideon on before a meeting/conversation. It listens, builds a
> live thought-plot/architecture map, switches modes on command, and keeps the
> transcript + notes for every meeting. Downloadable desktop app.

Status: **scoping / not started.** Ship after core web Gideon is polished.

---

## 1. Why a desktop app (not the web app)

The web app uses the browser Web Speech API — fine for "click mic and talk," but it
**cannot capture other people's audio** in a meeting (system/loopback audio) and
isn't truly always-on. Granola/Cluely-class tools are native desktop apps because
they need:

- **System audio capture** (what you *hear* — Zoom/Meet/Teams participants), not just your mic.
- **Always-on / background** listening with a global hotkey.
- A **floating overlay** that sits over any app (the live map + notes).

## 2. Approach: fork Cluely, reuse Gideon's backend

**Reuse, don't rebuild.** Gideon's backend already has the entire live pipeline:
`realtime_transcript` over `wss://…/ws/study-session` → Gemini plotter → `plot_update`
(+ `fact_check`, `ai_response`, mode-specific panels). The desktop app is basically a
**new audio front-end** for that same WebSocket contract.

- **Fork [Cluely](https://cluely.com)** for the shell: Electron app + transparent
  click-through overlay + global hotkey + system-audio capture plumbing.
- **Reference the user's [[project-ultron]] "copilot"** — it already does always-on
  assist; lift its capture/overlay patterns.

## 3. Architecture

```
┌─────────────── Gideon Listener (Electron desktop) ───────────────┐
│  Audio capture                                                   │
│   • mic (you)          ─┐                                         │
│   • system/loopback    ─┤→ mixer → chunks                        │
│       (macOS: ScreenCaptureKit / CoreAudio tap or BlackHole;     │
│        Win: WASAPI loopback)                                      │
│                          │                                        │
│  STT (per chunk)         ▼                                        │
│   • Gemini audio / Whisper / Deepgram  → text + speaker label    │
│                          │                                        │
│  Stream ─ realtime_transcript {text, speaker, tool, mode} ──────────┐
│                          │                                        │  │
│  Overlay (always-on-top, click-through)                          │  │
│   • live Mermaid map (reuse the web renderer)                    │  │
│   • notes / fact-check flags                                     │  │
│   • mode switcher (hotkey or "Gideon, switch to architect")      │  │
└──────────────────────────────────────────────────────────────────┘ │
                                                                        ▼
                            Gideon backend (Heroku, unchanged)  ── plot_update / fact_check / ai_response
                                                                        │
                            Supabase ── transcripts + notes + maps per meeting
```

### Speaker attribution matters (already handled in the plotter)
The plotter prompt now attributes claims to whoever said them ("Speaker → argues → X").
The listener must pass a **speaker label** per chunk (me vs. others) so the map reads
"Dr. Chen argued…" not "I said…". Diarization: cheap version = mic-channel ⇒ "You",
system-channel ⇒ "Them"; better version = a diarization model.

## 4. Backend additions (small)
- New message field `speaker` on `realtime_transcript` (plumb into plotter context).
- Per-meeting persistence: `meetings` table (id, title, started_at, transcript,
  notes, graph_json) — mostly reuse existing session storage.
- Auth: desktop app needs a token (Supabase auth or a device token) instead of the
  anonymous web session.

## 5. Download page in Gideon (`/download`)
- A route in the Next app: hero + "Download for macOS / Windows", release notes,
  a short demo GIF, system-audio permission instructions.
- Host the signed installers (Firebase Storage or GitHub Releases); the page links
  to the latest.

## 6. Build phases
1. **Spike**: Electron shell that captures *mic only*, streams `realtime_transcript`
   to the live backend, shows the map in an overlay. Proves the loop end-to-end.
2. **System audio**: add loopback capture (macOS ScreenCaptureKit; Win WASAPI) + the
   mic/them speaker split.
3. **Persistence + notes**: save transcript/notes/map per meeting; a "past meetings" list.
4. **Modes + hotkeys**: global hotkey to toggle listening; voice/hotkey mode switch.
5. **Package + sign + notarize**; ship the `/download` page.

## 7. Open questions
- STT choice for system audio (Gemini audio in vs. Deepgram/Whisper streaming) — cost vs. latency vs. diarization.
- macOS system-audio permission UX (ScreenCaptureKit prompt) — the main friction point.
- Auth model for the desktop app.
- Do we keep the web app's mic flow too, or make desktop the primary capture?

## 8. Reuse checklist (already built)
- ✅ Live WS pipeline (`/ws/study-session`, `realtime_transcript` → `plot_update`).
- ✅ Gemini plotter with POV/attribution + thinking disabled (no JSON truncation).
- ✅ Mermaid renderer with auto-fit, sanitizer, suppress-error, keep-last-good.
- ✅ All modes on Gemini (quiz/architect/debate/etc.) — the overlay can switch modes.
