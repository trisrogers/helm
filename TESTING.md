# The Helm — manual test checklist

Comprehensive verification list, broken down by screen. Tick items as you
confirm each behaviour against a real running gateway.

## Pre-flight: what's already been verified

- Typecheck + production build pass
- Every screen renders without page/console errors in 3 themes × 4 viewport sizes (Playwright)
- 6 keyboard shortcuts dispatch correctly (Playwright)
- Overview wiring against a live gateway (earlier verification pass)

Everything below requires manual confirmation.

## Setup

- [ ] Token paste via connection chip → status goes `Connecting…` → `Connected · <version>`
- [ ] Bad token → `Auth failed`; chip click lets you re-edit
- [ ] Stop the gateway mid-session → `Disconnected`, then auto-reconnect with backoff when the gateway returns

## Chat (Dispatches)

- [ ] Session list populates; sort newest-updated first
- [ ] Search box filters by title / preview / key
- [ ] Click a session → history loads, scrolled to bottom
- [ ] Send a message → appears in thread; assistant reply streams in token-by-token
- [ ] `Enter` sends; `Shift+Enter` makes a newline
- [ ] `+ New` creates a session against the first agent and selects it
- [ ] Info panel matches active session (model, channel, ctx tokens, updated relative time)
- [ ] Context bar % reflects `contextTokens` / 200k
- [ ] `Abort` enabled only while `hasActiveRun`; click cancels
- [ ] `Compact Context` / `Reset Session` / `Delete Session` each call the right RPC (delete clears selection + refreshes list)
- [ ] Disconnected state shows "Not connected to gateway"

## Talk (Telegraph)

- [ ] `talk.catalog` text reflects whether a realtime provider is configured
- [ ] Mic tap → permission prompt → granted → waveform draws and `talk.session.create` succeeds (needs realtime provider; will fail otherwise)
- [ ] Mic denied → "Mic denied" status; lifecycle returns to idle cleanly
- [ ] **Auto-detect:** speaking shows "Listening…"; transcript bubble fills from `transcript.delta`; agent voice plays back through speakers; recent events list shows `output.text.delta`, `output.audio.delta`, `turn.ended`
- [ ] **Push-to-talk:** `CHANGE` toggles mode; press-and-hold mic gates upload; release stops upload; transcript still arrives
- [ ] Mute (🔇) suspends upload without ending session
- [ ] `End` closes session, releases mic, stops playback
- [ ] Session ID + provider + transport print bottom-left while live

## Design (Blueprint)

- [ ] Default HTML renders in iframe on mount
- [ ] Edit source → preview updates ~350 ms later
- [ ] `auto` checkbox off → preview stops auto-updating; `↻ Refresh` is the only update path
- [ ] Viewport buttons → desktop / tablet (768×1024) / mobile (390×720) iframe sizes
- [ ] Type a label, press Enter or click `Save ↓` → new chip appears in the strip
- [ ] Click a chip → loads that version into editor + preview
- [ ] Right-click a chip → deletes it
- [ ] Reload the page → versions persist (localStorage)
- [ ] `⬇ Export` downloads `<date>-<slug>.html` and `<date>-<slug>.meta.json`; drop both into `~/artifacts/<slug>/` and confirm the gallery picks it up

## Tasks (Works Orders)

- [ ] First visit seeds 8 example cards across columns; column counts match
- [ ] Drag card between columns → status updates; commentary log gets a "X → Y" entry
- [ ] Drop target highlights on dragover
- [ ] Goal + Agent filters narrow the visible set
- [ ] `+ New Works Order` prompts for title and opens the detail modal
- [ ] Modal: every field edits + persists on Save (status, priority, goal, due, agent, cron)
- [ ] Modal: Delete (with confirm) removes the card and its commentary
- [ ] `Esc` closes the modal
- [ ] Move a card to Review → Approve/Requeue form appears; Approve → done + log; Requeue → in_progress + log
- [ ] Sidebar badge on Works Orders = number of Review cards (changes live on drag / Approve / Requeue)
- [ ] Reload page → all cards persist (localStorage)

## Goals (Ventures)

- [ ] First visit seeds 3 goals; progress ring reflects linked tasks (0 % if none)
- [ ] Click card → loads into detail pane
- [ ] Status dropdown changes status; commentary logged
- [ ] Narrative textarea saves on blur
- [ ] `+ Note` prompt adds a user-note commentary entry
- [ ] **AI decompose** (needs connected gateway): button creates a chat session via `sessions.create` with a decomposition prompt; commentary entry records the session key; switch to Dispatches to see the AI's task suggestions
- [ ] Delete (with confirm) removes goal; linked tasks lose their `goalId` but stay
- [ ] `+ New` modal: title required; Esc closes
- [ ] Linked-task list refreshes when you move that task between columns in Works Orders

## Editor (Cartography)

- [ ] Agent dropdown lists every agent from `agents.list`
- [ ] File tree shows bootstrap files (SOUL / AGENTS / TOOLS / etc.) + MEMORY; missing ones are dimmed
- [ ] Click an existing file → CodeMirror loads with content, markdown highlight active
- [ ] Edit → "Saved" pill flips to "Modified"
- [ ] `Save` (button) or `Cmd/Ctrl+S` → writes via `agents.files.set`; pill flips back to "Saved <time>"
- [ ] `Revert` discards changes back to last loaded
- [ ] Switching files when dirty: **silently drops changes** — gap, no confirm prompt yet
- [ ] Context Assembly Preview: shows present files with rough token estimate (chars / 4); total at bottom

## Skills (Craftsmen)

- [ ] **Installed:** list populates from `skills.status`; status pills (Active / Disabled / Blocked / Missing deps) correct
- [ ] Click row → detail loads with description, surfaces (model / user-invocable / command), requirements, missing bins / env
- [ ] `Enable` / `Disable` toggles via `skills.update`; row refreshes
- [ ] `Update from Clawhub` per-skill calls `skills.update { source: clawhub, slug }`
- [ ] `↻ Reload All` calls `skills.update { source: clawhub, all: true }`
- [ ] `Refresh` re-fetches status
- [ ] **Browse:** empty search returns recent Clawhub skills
- [ ] Search input + Enter triggers `skills.search`
- [ ] Click hub-card → `skills.detail` loads readme / version / changelog
- [ ] `Install` calls `skills.install { source: clawhub, slug }`; after success switch to Installed and confirm it appears
- [ ] `Force reinstall` adds `force: true`

## Orchestration (Operations)

- [ ] Agent cards: one per `agents.list` entry; show active session, channel, model, count, last active
- [ ] Status dot pulses (animated) while any agent session has `hasActiveRun`
- [ ] Communication graph: nodes laid out on a circle; edges only appear when sessions have `parentSessionKey` pointing to a session owned by a *different* agent
- [ ] Edges from sessions updated in the last 5 min animate a particle along the line
- [ ] Session timeline: dots appear as `sessions.changed` events arrive, positioned at their wall-clock time within the 2 h window; tooltip on hover shows session key + phase
- [ ] Time axis stays accurate over 30 s+ idle (background tick re-renders)

## Plan

- [ ] Renders identically in all 3 themes — purely static markup

## Global / cross-cutting

- [ ] Theme switch (sidebar A / P / B) → all tokens swap, no flash, no console errors
- [ ] `Cmd/Ctrl + .` cycles theme
- [ ] `Cmd/Ctrl + B` toggles sidebar collapse
- [ ] `Cmd/Ctrl + 1…0` jumps to correct screen
- [ ] `?` opens shortcuts overlay; `Esc` closes
- [ ] Keyboard shortcuts ignored while typing in an input / textarea / select / contentEditable / CodeMirror
- [ ] Topbar clock ticks every second
- [ ] Connection chip click → input field → paste + Enter saves token + immediately reconnects
- [ ] Storage event: open two tabs → mutate Tasks in one → other tab's badge updates

## Responsive

- [ ] 1440 px: full layout (default desktop)
- [ ] 1100 px: sidebar becomes icons-only, Assay corner-frame hidden
- [ ] 820 px: Chat info panel + Editor context panel hidden; Goals / Skills stack; Design stacks
- [ ] 560 px: Overview cards collapse to single column; kanban columns tighten so two fit per screen with horizontal scroll

## PWA

- [ ] DevTools → Application → Manifest shows correct name / colours / icon
- [ ] iOS Safari / Android Chrome "Add to Home Screen" produces standalone launcher with correct icon + title

## Known gaps (won't pass without follow-up)

- Editor: no dirty-check confirm when switching files
- Talk: needs realtime provider configured to validate audio path end-to-end
- Goals decompose: only opens the chat session — doesn't auto-parse the AI's reply back into task records
- No PWA service worker → offline doesn't work, only the install affordance does
