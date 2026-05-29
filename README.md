# The Helm

Control surface for the **OpenClaw** AI gateway — a single-page app for driving
chat sessions, voice, design work, tasks, and orchestration against a local
gateway. Vite + React + TypeScript, themed three ways, talks to the gateway over
a WebSocket JSON-RPC connection.

> Solo project. Develops on `main`. The dev box is also the prod box — same
> machine, different ports/processes (see [Deployment](#deployment)).

---

## Quick start

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npx tsc --noEmit   # typecheck
npm run build      # tsc -b + vite build (production bundle)
npm run lint       # eslint
```

You also need the **OpenClaw gateway** running locally (`ws://localhost:18789`)
and a control-UI token (see [Gateway connection](#gateway-connection)).

---

## Architecture

| Path | Role |
|------|------|
| `src/App.tsx` | Shell: sidebar nav, theme selector, screen routing, `GatewayProvider` wrapper |
| `src/context/GatewayContext.tsx` | React context exposing `client`, `status`, `snapshot` |
| `src/lib/openclaw-client.ts` | WebSocket JSON-RPC client for the gateway |
| `src/screens/` | One file per screen (Overview, Chat, Talk, Tasks, …) |
| `src/components/` | Cross-screen building blocks (`DesignCanvas`, `TaskBoard`) |
| `src/lib/` | Client utilities: chat helpers, handoff, talk audio/pipeline, session cache |
| `src/index.css` | All styling; theme tokens via `[data-theme="x"]` on `<html>` |
| `src/types.ts` | `Theme`, `ScreenId`, per-theme nav copy (`NAV_LABELS`), `THEME_META` |

Single bundle, no router library — the active screen is React state in `App.tsx`,
and a lightweight `helm:nav` event (`src/lib/handoff.ts`) lets one screen send the
user to another with a payload.

---

## Gateway connection

The app connects to the OpenClaw gateway at `ws://localhost:18789`.

**Auth flow**
1. Gateway sends a `connect.challenge` event (nonce).
2. Client responds with `{ type:"req", id, method:"connect", params: ConnectParams }`.
3. Gateway replies `{ type:"res", ok:true, payload: HelloOk }` on success.
4. Subsequent calls: `{ type:"req", id, method, params }` → `{ type:"res", id, ok, payload }`.

- **Protocol version:** 4 · **Client ID:** `openclaw-control-ui` · **Client mode:** `ui`
- **Token:** stored in `localStorage` under `helm:token`. Paste it via the
  connection status chip in the sidebar footer.
- **Gateway config required** (`~/.openclaw/openclaw.json`):
  ```json
  "controlUi": { "allowInsecureAuth": true }
  ```
  Allows localhost connections without device-identity pairing (loopback-only;
  no impact on remote access).

**Useful RPC methods**
```
sessions.list / sessions.create / sessions.send / sessions.patch
sessions.messages.subscribe / sessions.abort / sessions.compact / sessions.reset
chat.history          agents.list / agents.files.{list,get,set}
channels.status       usage.status        models.list
exec.approvals.get / exec.approval.resolve      cron.list
talk.session.create / talk.session.close / talk.speak / talk.catalog
```
Events: `sessions.changed`, `session.message`, `agent`, `chat`, `health`,
`exec.approval.requested`, `talk.event`.

---

## Themes

Three approved themes — tokens in `index.css`, structural elements in `App.tsx`,
per-theme nav copy in `NAV_LABELS` (`types.ts`). Applied via
`document.documentElement.setAttribute('data-theme', theme)`.

| Key | Name | Style |
|-----|------|-------|
| `assay` | Assay Office | Dark gold/black, ornamental certificate motif, Cinzel + Playfair Display |
| `politburo` | Politburo | Cream/red Soviet constructivist, diagonal clip-path, Anton ghost counters |
| `blizzard` | First Blizzard | Ice blue, layered SVG tree sidebar motif, Special Elite |

Each theme renames the nav (e.g. Overview → "Engine Room" / "Central Command" /
"Camp Status").

---

## Screens

| ID | Name (varies by theme) | Status |
|----|------------------------|--------|
| `overview` | Overview / Camp Status | **Live** — channels, sessions, agents, approvals, crons |
| `chat` | Chat / Dispatches / Transmissions | **Live** — streaming, model/thinking controls, slash commands, pins, export, **inline design canvas** |
| `talk` | Talk / Telegraph / Broadcast | **WIP** — pipelined voice (see [Talk mode](#talk-mode)) |
| `tasks` | Tasks / Works Orders / Directives | Kanban shell |
| `goals` | Goals / Ventures / Expeditions | Static shell |
| `orch` | Orchestration / Apparatus | Static shell |
| `editor` | Editor / Cartography / Field Docs | CodeMirror shell |
| `skills` | Skills / Craftsmen / Equipment | Static shell |
| `plan` | Plan / Build Plan | Phase-plan doc |

### Chat + the inline design canvas

Chat is the most built-out screen: cached session list, live message streaming
(`agent` deltas + `chat` final), per-session model/thinking overrides, native
slash commands, pinned messages, markdown export, and a context-usage bar in the
composer top.

The **design canvas** (`src/components/DesignCanvas.tsx`) slides out from the
right edge of Chat instead of being a separate page — a chat session keeps its
context, composer focus and scroll while you edit HTML beside it.

- **⬚ Canvas** toggles a blank canvas; **Open in Canvas** seeds it with the latest
  assistant HTML from the thread.
- Editor (CodeMirror 6) + sandboxed iframe preview + viewport switcher + saved
  versions + export to an `~/artifacts/<slug>/` file pair.
- State is **per chat session** (`localStorage` key `helm:design:canvas:<sessionKey>`);
  panel width and open-state persist. Below 820px it floats full-width; below
  560px it stacks editor-over-preview.
- The canvas replaces the session-info rail while open. On first open it offers a
  one-time import of any legacy global versions.

### Talk mode

Voice is **pipelined STT → openclaw LLM → TTS**, local-first, where a voice turn
*continues the existing text session* rather than being a parallel channel.
Implementation lives in `src/lib/talk-audio.ts` (mic capture/resampling) and
`src/lib/talk-pipeline.ts` (turn orchestration), driving a local Python sidecar
(`~/projects/openclaw-voice-sidecar`, faster-whisper + Kokoro) behind two
out-of-tree openclaw provider plugins. See `docs/talk-mode-research.md` and
`docs/talk-mode-deployment.md` for the full design and phase status.

---

## Deployment

Solo-dev, same host for dev and prod:

| Env | Process | URL |
|-----|---------|-----|
| Dev | `npm run dev` | `http://localhost:5173` |
| Prod | long-running `vite --host 127.0.0.1 --port 5174 --strictPort` | `https://vostok-wsl.tail3aeb2d.ts.net:5174` (tailnet, via `tailscale serve`) |

Prod serves live source through vite (no `dist/` in the serving path). The `:443`
tailscale entry proxies the **OpenClaw gateway** (`:18789`), not Helm.

**Promote:** `npm run build` (validates the bundle) → restart the `:5174` vite →
smoke the prod URL.

> ⚠️ The prod vite is a bare manually-launched process — no systemd/pm2, so a
> reboot leaves it down. Putting it under a user-level systemd unit
> (`helm-prod.service`) is a planned follow-up.

---

## Phase plan

- **Phase 0 (done):** Shell, themes, nav, WS client.
- **Phase 1 (done):** Chat streaming, Overview live data, Editor with CodeMirror 6.
- **Phase 2 (in progress):** Talk (Web Audio pipeline), inline design canvas, Skills.
- **Phase 3:** Tasks/Goals (kanban, AI decomposition, SQLite).
- **Phase 4:** Orchestration graph, multi-user, PWA, prod hardening (systemd).

See the in-app **Plan** screen and `docs/` for detail.
