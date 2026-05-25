# SPRINT 1 - 20260525 

## Chat (Dispatches)

Bug: On pressing enter in the chatbox the cursor doesn't stay in the box. This make continuous chat difficult
Bug: There should be an agent drop down in the sessions list to show just that agents sessions. this is the "- [FAIL] **Agent filter chips** appear above the list when there are 2+ agents in the session set; "All" + one chip per agent; click filters" (in future multi-user phase these agents will need to be locked)
PFR: Session names are long and complex. This should be a short name.
PFR: The Tools tickbox in the chatbox show say "Show Tools [ ] "
PFR: In the search box for the session, it would be good if it was a search of the information in the sessions.
Bug: The selection is not saved on reload "- [FAIL] Selection survives navigation away and back (persisted in `localStorage` under `helm:chat:activeKey`)"
Performance: loading or coming back to the chat screen forces a reload of the sessions that can take ~5-10 secs.
Performance: Changing chat sessions causes the history to reload and can take ~5 secs.
Bug: The list of sessions is long and mostly empty. Like it is keeping all the session stubs but don't have the messages for it. "- [FAIL] If the persisted key no longer exists in the session list (deleted/archived), falls back to most-recent session silently rather than showing an empty thread  - FAILED NOTED as bug."
PFR: when selecting a session (or creating a new one) the cursor should be set in the chatbox.
Bug: The "context Used" seems to only have 3 options 0/200,000 | 200,000/200,000 | 1,048,576/200,000  that don't reflect reality - "- [FAIL] Context bar reflects `contextTokens` from `sessions.list` when available; otherwise falls back to char/4 estimate over the visible thread with an **(est.)** badge next to the title - FAILED NOTED as bug."
Bug: Failed to open html that was in the message " - [FAIL] **⬚ Open in Design** — walks the thread for the most recent assistant reply, extracts HTML (handles ```html fences + bare HTML), navigates to Design with it as the initial source. Status line in Design shows `Loaded HTML from Chat session: <name>` (or "no HTML found" if plain text)"```  Error in interface "Arrived from Chat session: agent:main:dashboard:7a36d0b7-d87e-49f3-a5ef-28f4511988ba — no HTML found in latest reply"
Bug: The Archive button doesn't do anything. - [FAIL] **Archive Session** (renamed from Delete) — confirm dialog explains the transcript moves to the gateway archive (recoverable). Calls `sessions.delete` (which by default archives the transcript via `archiveSessionTranscriptsForSessionDetailed` server-side) error in console: {"type":"res","id":"9b6f81ca-dd9f-4d3d-be09-b5382cd3ccba","ok":false,"error":{"code":"INVALID_REQUEST","message":"missing scope: operator.admin"}}


## Design

Assay:
The handwritting font is difficult to read. Try increasing by 50%.

Politburo:
top bar - model + "connected" font is unreadable black-on-black
I dont' like the black chat box. go with the same biege background colour for the frame aroung the chatbox and the light red (from the ghost numbers for the actual chat surface)


Blizzard:
top bar - "connected" font is unreadable white-on-white

---

## Resolution log

### Group C — State/persistence bugs — ✅ done 2026-05-25

- **activeKey alias mismatch on reload** — `src/screens/Chat.tsx:340` — when the persisted key didn't match any row exactly, refreshSessions silently fell through to row[0]. Now first tries to resolve the alias by matching the trailing segment (UUID) against any row's key, only falling through to row[0] as last resort.
- **Empty stub sessions** — root cause is `+ New` calls `sessions.create` immediately, even if the user never sends. New **Show empty stubs** toggle (defaults OFF) hides rows where `lastMessagePreview` is empty, except for the currently-active session (so a brand-new session doesn't vanish before you can use it). Persisted at `helm:chat:showEmpty`. Cleaner permanent fix would be to defer session creation until first send — flagged as follow-up.
- **Open in Design HTML extraction** — two fixes:
  1. `src/screens/Chat.tsx:1243` now walks **all** assistant messages back-to-front and picks the first that yields HTML, instead of only checking the latest. (A follow-up "done!" reply was shadowing the earlier message that had the HTML.)
  2. `src/lib/handoff.ts:89` extractor now: walks every fenced block (any language tag including bare ```, ~~~), prefers explicit `html`/`htm`, sniffs unlabeled blocks; falls back to slicing `<!doctype>…</html>` / `<html>…</html>` / `<body>…</body>` out of mixed prose; then to the whole-message fallback.
- Typecheck: clean.

### Group B — Session list filtering & search — ✅ done 2026-05-25

- **Agent filter dropdown** — `src/screens/Chat.tsx:781` — replaced the chip row with a `<select>` (uses `identity.name → name → id` for the option label). Future multi-user phase will need to lock this to the current user's agents.
- **Short session names** — added `shortenSessionLabel()` helper in `Chat.tsx:228`; session row now shows `displayName → derivedTitle → preview snippet (≤48 chars) → <channel>:<uuid6>`. Full key still on hover via `title=`.
- **Search expanded** to also match agent id, model name, and channel — so "telegram" or "claude" surfaces relevant sessions. Deeper full-message-content search is deferred to Group F, which will land an LRU history cache that the search can scan opportunistically.
- New CSS: `.session-filter-select` styled to match the rest of the sidebar.
- Typecheck: clean.

### Group E — Archive permission UX — ✅ done 2026-05-25 (partial — gateway follow-up needed)

- The Archive button was failing silently because the handler swallowed all errors with `catch { /* ignore */ }`. The gateway returns `INVALID_REQUEST: missing scope: operator.admin` for `sessions.delete` from a UI token.
- **Fix** — `src/screens/Chat.tsx:1251` — catch the error, set `errorMsg` with a friendly message: "Archive requires operator.admin scope on the gateway token. Ask the gateway admin to grant it, or use the CLI to archive." Generic errors fall through with the raw message prefixed by `Archive failed:`.
- **Gateway-side follow-up (not in this sprint)**: expose a `sessions.archive` RPC that only requires user scope, OR change `sessions.delete` to permit the owning user to archive their own sessions. Filed implicitly via this entry; raise on openclaw next.

### Group D — Context bar — ✅ done 2026-05-25

- **Root cause of the 3 fixed values** Tris saw (0/200k, 200k/200k, 1,048,576/200k):
  - Numerator was falling through `contextTokens ?? totalTokens ?? estimate`. `totalTokens` is **cumulative lifetime usage** for the session, not current-context — that's where 1,048,576 came from.
  - Denominator was a hardcoded `200_000` regardless of model.
- **Fix** — `src/screens/Chat.tsx:741` — dropped `totalTokens` from the chain (`contextTokens` → char/4 estimate only); look up the active session's model in `modelCatalog` and use its `contextWindow` as denominator (200k fallback if catalog entry is missing).
- Typecheck: clean.

### Group G — Theme polish — ✅ done 2026-05-25 (needs visual confirm)

- **Assay handwriting +50%** — `src/index.css:1115` — bumped session-preview / info-val / msg-time from 14 px → 21 px, added 18 px rule for user message body.
- **Politburo topbar contrast** — `src/index.css:1128` — added rules so `Default model:`, the model value, and the Connection chip render cream on black. The black-on-black happened because the politburo body sets `--ink: #111` while the topbar background is also `#111`; inline styles using `var(--ink)` were invisible.
- **Politburo composer** — replaced the black box with a beige (`#F2EDD5`) frame around a soft-red (`rgba(204,17,17,.08)`) textarea surface — matches the ghost-number red Tris referenced.
- **Blizzard topbar contrast** — `.conn-status` was `rgba(224,236,244,.5)` (whitish) on the light-blue topbar; switched to `#1A2E40` (dark navy) so the "Connected" chip reads.
- Typecheck (`tsc --noEmit`): clean. CSS-only changes — visual review required.
- TESTING.md updated under Themes section.

### Group A — Composer ergonomics — ✅ done 2026-05-25

- **Enter keeps cursor in composer** — `src/screens/Chat.tsx:1112` — after `handleSend()`, request animation frame and re-focus `composerRef`. The disabled→re-enabled cycle while `sending` was dropping focus.
- **Auto-focus composer on session select/create** — `src/screens/Chat.tsx:528` — new `useEffect` keyed on `activeKey` focuses the textarea.
- **"Show Tools" label** — `src/screens/Chat.tsx:1003` — checkbox label updated from `Tools` to `Show Tools`.
- Typecheck: clean.
- TESTING.md updated with 3 ticked items under Chat → Thread + composer.

