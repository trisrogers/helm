# The Helm — manual test checklist

Comprehensive verification list, broken down by screen. Tick items as you confirm each behaviour against a real running gateway.

## Pre-flight: what's already been verified

- Typecheck + production build pass
- Every screen renders without page/console errors in 3 themes × 4 viewport sizes (Playwright)
- 6 keyboard shortcuts dispatch correctly (Playwright)
- Overview wiring against a live gateway (earlier verification pass)
- Chat history loading via `chat.history` (replaces empty `sessions.get` path) confirmed live against dashboard sessions
- Chat streaming + stuck-indicator fix confirmed against live `agent` / `chat` event sequence

Everything below requires manual confirmation.

## Topbar (new in Phase 4 polish)

- [x] Top-right shows, in order: **Default model**, **Theme dropdown**, **Connection chip**, **Clock**
- [x] **Default model** value pulls dynamically from the default agent's `model.primary` (was static "Sonnet 4.6"); tooltip shows the source agent
- [x] **Theme dropdown** lists full names (Assay Office / Politburo / First Blizzard), not initials; selection persists via the `data-theme` attribute
- [x] **Connection chip** shows orange-bordered "Set gateway token →" when no token; click opens an inline edit (input + Save + Cancel) on the same row
- [x] Click chip when connected → opens the same inline edit so you can swap tokens; Enter saves, Esc cancels
- [x] Connecting → `Connecting…`; bad token → `Auth failed — click to retry`; disconnected → `Disconnected — click to update token`
- [x] Sidebar footer is empty (theme + conn moved to topbar — no orphan footer chrome)

## Setup

- [x] Token paste via topbar connection chip → status goes `Connecting…` → `Connected · <version>`
- [x] Bad token → `Auth failed — click to retry`; chip click lets you re-edit
- [ ] Stop the gateway mid-session → `Disconnected`, then auto-reconnect with backoff when the gateway returns

## Chat (Dispatches)

### Session list

- [x] Session list populates; sort newest-updated first
- [x] Search box filters by title / preview / key
- [FAIL] **Agent filter chips** appear above the list when there are 2+ agents in the session set; "All" + one chip per agent; click filters - FAILED NOTED as bug.
- [x] **Channel filter chips** appear when there are 2+ channels (Direct / Telegram / Slack / Email / WebChat); click filters with icon
- [FAIL] Selection survives navigation away and back (persisted in `localStorage` under `helm:chat:activeKey`) - FAILED NOTED as bug.
- [FAIL] If the persisted key no longer exists in the session list (deleted/archived), falls back to most-recent session silently rather than showing an empty thread  - FAILED NOTED as bug.
- [x] `+ New` creates a session against the first agent and selects it

### Thread + composer

- [x] Thread auto-scrolls to bottom on history load and on new messages
- [x] Send a message → **user message appears optimistically** (no 1.5s wait for the echo); composer clears immediately

- Not sure how to test these - need test instructions.
- [ ] Click a session → history loads via `chat.history` (not `sessions.get` — the latter returns empty for dashboard sessions) 
- [ ] User echo from `session.message` replaces the optimistic row (matched by text); no double-render
- [ ] Send failure → optimistic row removed, error shown, composer restored with your text
- [ ] Assistant reply streams in token-by-token from `agent` events (`stream: 'assistant'`, cumulative `data.text`)
- [ ] Streaming indicator (cursor + `· streaming…`) shows on the live row only while the run is in flight
- [ ] **Streaming indicator clears** the moment `agent.lifecycle.end` or `chat.final` arrives — no stuck "thinking…" placeholder
- [ ] `pendingRunId`-based fallback bubble shows "thinking…" only between `sessions.send` and the first text delta, then clears
- [ ] `chat.final` swaps the streaming placeholder for the canonical projected message (proper id, content-block resolved)
- [x] `Enter` sends; `Shift+Enter` makes a newline
- [x] After `Enter` send, focus stays in composer (Sprint 1 fix)
- [x] Selecting or creating a session auto-focuses the composer (Sprint 1 fix)
- [x] Tools checkbox label reads **Show Tools** (Sprint 1 fix)

### Info panel (right rail)

- [x] Info panel matches active session (model, channel, ctx tokens, updated relative time)
- [x] Context bar reflects `contextTokens` from `sessions.list` when available; otherwise falls back to char/4 estimate over the visible thread with an **(est.)** badge next to the title (Sprint 1 fix: stopped falling through to cumulative `totalTokens`)
- [ ] Context bar **denominator** matches the active session's model context window (looked up from `modelCatalog.contextWindow`), not a hardcoded 200 k (Sprint 1 fix — needs visual confirm with e.g. Sonnet 4.6 = 200 k vs Opus 4.7 1M = 1,048,576)
- [x] `Abort` enabled only while `hasActiveRun`; click cancels

### Info panel actions

- [FAIL] **⬚ Open in Design** — walks the thread for the most recent assistant reply, extracts HTML (handles ```html fences + bare HTML), navigates to Design with it as the initial source. Status line in Design shows `Loaded HTML from Chat session: <name>` (or "no HTML found" if plain text)``` - FAILED NOTED as bug.
- [x] **◉ Switch to voice** — navigates to Talk; a dismissible "↳ Continuing from chat: <name>" banner appears at the top of Talk
- [ ] **Compact Context** / **Reset Session** call the right RPC
- [ ] **Archive Session** (renamed from Delete) — confirm dialog explains the transcript moves to the gateway archive (recoverable). Calls `sessions.delete` (which by default archives the transcript via `archiveSessionTranscriptsForSessionDetailed` server-side). **Note (Sprint 1)**: requires `operator.admin` scope on the gateway token; UI tokens typically don't have it, so the button surfaces a clear message ("Archive requires operator.admin scope…") rather than silently no-op'ing. Needs gateway-side follow-up to expose a user-scope `sessions.archive` RPC.
- [ ] Disconnected state shows "Not connected to gateway"

## Talk (Telegraph)

- [ ] `talk.catalog` text reflects whether a realtime provider is configured
- [ ] **Handoff banner** appears at top when arriving from a Chat "Switch to voice" click; shows the source session name; **dismiss** button hides it
- [ ] Banner is one-shot — refresh the page or re-mount and it stays gone (consumed from localStorage)
- [ ] Mic tap → permission prompt → granted → waveform draws and `talk.session.create` succeeds (needs realtime provider; will fail otherwise)
- [ ] Mic denied → "Mic denied" status; lifecycle returns to idle cleanly
- [ ] **Auto-detect:** speaking shows "Listening…"; transcript bubble fills from `transcript.delta`; agent voice plays back through speakers; recent events list shows `output.text.delta`, `output.audio.delta`, `turn.ended`
- [ ] **Push-to-talk:** `CHANGE` toggles mode; press-and-hold mic gates upload; release stops upload; transcript still arrives
- [ ] Mute (🔇) suspends upload without ending session
- [ ] `End` closes session, releases mic, stops playback
- [ ] Session ID + provider + transport print bottom-left while live

## Design (Blueprint)

- [ ] Default HTML renders in iframe on mount when no handoff is pending
- [ ] **Handoff seeding:** when arriving from Chat "Open in Design" with HTML in the latest assistant message, the editor mounts with that HTML and the preview reflects it
- [ ] Status line shows `Loaded HTML from <source>` for a successful handoff, or `Arrived from <source> — no HTML found in latest reply` when the assistant reply was plain text
- [ ] Edit source → preview updates ~350 ms later
- [ ] `auto` checkbox off → preview stops auto-updating; `↻ Refresh` is the only update path
- [ ] Viewport buttons → desktop / tablet (768×1024) / mobile (390×720) iframe sizes
- [ ] Type a label, press Enter or click `Save ↓` → new chip appears in the strip
- [ ] Click a chip → loads that version into editor + preview
- [ ] Right-click a chip → deletes it
- [ ] Reload the page → versions persist (localStorage)
- [ ] `⬇ Export` downloads `<date>-<slug>.html` and `<date>-<slug>.meta.json`; drop both into `~/artifacts/<slug>/` and confirm the gallery picks it up

## Tasks (Works Orders / Directives / Objectives)

- [ ] First visit seeds 8 example cards across columns; column counts match
- [ ] Seed tasks are linked to the "Build & Ship The Helm v1" seed project (one-shot migration applied to pre-existing installs too)
- [ ] Drag card between columns → status updates; commentary log gets a "X → Y" entry
- [ ] Drop target highlights on dragover
- [ ] **Project filter** dropdown — `All projects` / `— No project —` / each project; renamed from the old "Goal" filter
- [ ] When a specific project is filtered, `+ New <Order>` defaults the new task's `goalId` to that project so it lands in the right place
- [ ] Agent filter narrows the visible set
- [ ] `+ New Works Order` prompts for title and opens the detail modal
- [ ] Modal: every field edits + persists on Save (status, priority, **project** (was "goal"), due, agent, cron)
- [ ] Modal project selector shows "— No project —" + each available project
- [ ] Modal: Delete (with confirm) removes the card and its commentary
- [ ] `Esc` closes the modal
- [ ] Move a card to Review → Approve/Requeue form appears; Approve → done + log; Requeue → in_progress + log
- [ ] Sidebar badge on Works Orders = number of Review cards (changes live on drag / Approve / Requeue)
- [ ] Reload page → all cards persist (localStorage)

## Projects (Ventures / Objectives / Expeditions)

- [ ] First visit seeds 3 projects; progress ring reflects linked tasks (38 % for "Build & Ship" given the seeded task statuses)
- [ ] Click card → loads into detail pane
- [ ] **Embedded kanban** inside the detail pane shows only that project's tasks across Backlog / In Progress / Review / Done
- [ ] Drag-and-drop inside the embedded kanban moves cards exactly like the global Works Orders board
- [ ] Click a card → opens the same shared TaskDetailModal
- [ ] **+ New Task** above the kanban prompts for title and creates a task already linked to this project (no need to set the Project field manually)
- [ ] **✦ Plan with AI** (renamed from "Decompose with AI") creates a chat session with the project context as the prompt; the session key is logged as a `decomposition` commentary entry. Switch to Dispatches to view the AI's reply
- [ ] Status dropdown changes project status; commentary logged
- [ ] Narrative textarea saves on blur
- [ ] `+ Note` prompt adds a user-note commentary entry
- [ ] Delete confirm copy says **"Delete this project?"** (was "goal")
- [ ] After delete, linked tasks lose their project link but stay in the cross-project Works Orders view (filterable under "— No project —")
- [ ] `+ New` modal: title required; Esc closes; project lands in the list immediately

## Editor (Cartography)

- [ ] Agent dropdown lists every agent from `agents.list`
- [ ] File tree shows bootstrap files (SOUL / AGENTS / TOOLS / etc.) + MEMORY; missing ones are dimmed
- [ ] Click an existing file → CodeMirror loads with content, markdown highlight active
- [ ] Edit → "Saved" pill flips to "Modified"
- [ ] `Save` (button) or `Cmd/Ctrl+S` → writes via `agents.files.set`; pill flips back to "Saved <time>"
- [ ] `Revert` discards changes back to last loaded
- [ ] Switching files when dirty: **silently drops changes** — gap, no confirm prompt yet
- [ ] Context Assembly Preview: shows present files with rough token estimate (chars / 4); total at bottom

## Skills (Craftsmen / Protocols / Equipment)

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

## Orchestration (Operations / Apparatus / Ranger Network)

- [ ] Agent cards: one per `agents.list` entry; show active session, channel, model, count, last active
- [ ] Status dot pulses (animated) while any agent session has `hasActiveRun`
- [ ] Communication graph: nodes laid out on a circle; edges only appear when sessions have `parentSessionKey` pointing to a session owned by a *different* agent
- [ ] Edges from sessions updated in the last 5 min animate a particle along the line
- [ ] Session timeline: dots appear as `sessions.changed` events arrive, positioned at their wall-clock time within the 2 h window; tooltip on hover shows session key + phase
- [ ] Time axis stays accurate over 30 s+ idle (background tick re-renders)

## Plan

- [ ] Renders identically in all 3 themes — purely static markup

## Themes (Phase 4 polish)

### Assay (Brass Birmingham)

- [ ] **No corner-frame overlay** — topbar and main pane unobstructed (the decorative SVG was removed)
- [ ] Nav menu items are larger (13 px) and brighter (~78 % gold opacity) than before
- [ ] "Handwritten" italic (IM Fell English) accents — session previews, info values, message timestamps render at **21 px** (Sprint 1: bumped again +50 %); user-message body at 18 px
- [ ] No regressions in the chat/editor/skills sub-panels

### Politburo

- [ ] **Compact Context button text is visible without hover** (was invisible cream-on-cream); hovers cleanly to white-on-red
- [ ] Other `.btn-ghost` buttons (Reset Session, Archive Session, Refresh, etc.) all show red text on cream at rest
- [ ] Cyrillic header strip "УДАРНИК · СИСТЕМА v2.1" stays legible at top of sidebar
- [ ] **Topbar "Default model" + value + "Connected" all render cream on black** (Sprint 1 fix — was black-on-black)
- [ ] **Composer frame is beige** (`#F2EDD5`); textarea surface is soft red (`rgba(204,17,17,.08)`) with dark text (Sprint 1 fix — was a black box)

### Blizzard (First Blizzard / Long Dark)

- [ ] **HELM wordmark** reads clearly against the new darker top of the sidebar gradient (was washed out)
- [ ] Tree watermark at the bottom of the sidebar is visible without dominating — bigger silhouette + slightly brighter green
- [ ] Nav menu items are larger (13 px) and brighter (~82 % off-white) than before
- [ ] Survival stats (chat composer) still render under blizzard only
- [ ] **Topbar "Connected" chip is dark navy on light blue** (Sprint 1 fix — was white-on-white)

## Global / cross-cutting

- [ ] Theme switch via topbar dropdown → all tokens swap, no flash, no console errors
- [ ] `Cmd/Ctrl + .` cycles theme (Assay → Politburo → Blizzard); topbar dropdown updates
- [ ] `Cmd/Ctrl + B` toggles sidebar collapse
- [ ] `Cmd/Ctrl + 1…0` jumps to correct screen
- [ ] `?` opens shortcuts overlay; `Esc` closes
- [ ] Keyboard shortcuts ignored while typing in an input / textarea / select / contentEditable / CodeMirror
- [ ] Topbar clock ticks every second
- [ ] Connection chip in topbar → inline input → paste + Enter saves token + immediately reconnects
- [ ] Storage event: open two tabs → mutate Tasks in one → other tab's Works Orders badge updates

## Cross-screen handoff (new in Batch 4)

- [ ] Chat → Design: navigate-then-consume via `localStorage[helm:handoff:design]`; payload is read and cleared on Design mount
- [ ] Chat → Talk: same pattern via `localStorage[helm:handoff:talk]`; banner appears once, dismiss button hides for the session
- [ ] Navigation event (`helm:nav`) flips the active screen in App without round-tripping through the sidebar click

## Responsive

- [ ] 1440 px: full layout (default desktop)
- [ ] 1100 px: sidebar becomes icons-only, Assay corner-frame is already gone so no clipping issues
- [ ] 820 px: Chat info panel + Editor context panel hidden; Projects / Skills stack; Design stacks
- [ ] 560 px: Overview cards collapse to single column; kanban columns tighten so two fit per screen with horizontal scroll

## PWA

- [ ] DevTools → Application → Manifest shows correct name / colours / icon
- [ ] iOS Safari / Android Chrome "Add to Home Screen" produces standalone launcher with correct icon + title

## Known gaps (won't pass without follow-up)

- Editor: no dirty-check confirm when switching files
- Talk: needs realtime provider configured to validate audio path end-to-end
- Talk handoff from Chat: banner only — voice is not actually piped through the chat session (talk sessions are independent gateway resources). Full voice-on-chat-session would need gateway-side bridging
- Projects "Plan with AI": opens the chat session and logs the AI's reply but doesn't auto-parse it back into task records — manual copy still required
- No PWA service worker → offline doesn't work, only the install affordance does
- Internal type rename Goal → Project is deferred; UI copy says Project but the store key + interface still use `Goal` / `goalId` for backward-compat with existing localStorage data
