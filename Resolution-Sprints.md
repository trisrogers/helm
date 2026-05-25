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

### Group A — Composer ergonomics — ✅ done 2026-05-25

- **Enter keeps cursor in composer** — `src/screens/Chat.tsx:1112` — after `handleSend()`, request animation frame and re-focus `composerRef`. The disabled→re-enabled cycle while `sending` was dropping focus.
- **Auto-focus composer on session select/create** — `src/screens/Chat.tsx:528` — new `useEffect` keyed on `activeKey` focuses the textarea.
- **"Show Tools" label** — `src/screens/Chat.tsx:1003` — checkbox label updated from `Tools` to `Show Tools`.
- Typecheck: clean.
- TESTING.md updated with 3 ticked items under Chat → Thread + composer.

