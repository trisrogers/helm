# The Helm

Control surface for the OpenClaw AI gateway. Vite + React + TypeScript SPA.

## Dev server

```bash
npm run dev       # starts at http://localhost:5174
npx tsc --noEmit  # typecheck
```

## Architecture

- **`src/App.tsx`** — Shell: sidebar, nav, theme selector, `GatewayProvider` wrapper
- **`src/lib/openclaw-client.ts`** — WebSocket JSON-RPC client for the gateway
- **`src/context/GatewayContext.tsx`** — React context exposing `client`, `status`, `snapshot`
- **`src/screens/`** — One file per screen (Overview, Chat, Tasks, Goals, …)
- **`src/index.css`** — All styling; theme tokens via `[data-theme="x"]` on `<html>`
- **`src/types.ts`** — `Theme`, `ScreenId`, per-theme nav copy (`NAV_LABELS`), `THEME_META`

## Gateway connection

The app connects to the OpenClaw gateway at `ws://localhost:18789`.

**Auth flow:**
1. Gateway sends `connect.challenge` event (nonce)
2. Client responds with `{ type:"req", id, method:"connect", params: ConnectParams }`
3. Gateway sends `{ type:"res", ok:true, payload: HelloOk }` on success
4. Subsequent calls: `{ type:"req", id, method, params }` → `{ type:"res", id, ok, payload }`

**Protocol version:** 4  
**Client ID:** `openclaw-control-ui`  
**Client mode:** `ui`

**Token:** stored in `localStorage` under key `helm:token`. User pastes it via the connection status chip in the sidebar footer.

**Gateway config required** (`~/.openclaw/openclaw.json`):
```json
"controlUi": {
  "allowInsecureAuth": true,
  ...
}
```
This allows localhost connections without device identity pairing (loopback-only, no security impact on remote access).

## Themes

Three approved themes — tokens in `index.css`, structural elements in `App.tsx`:

| Key | Name | Style |
|-----|------|-------|
| `assay` | Assay Office | Dark gold/black, ornamental SVG certificate border, Cinzel + Playfair Display |
| `politburo` | Politburo | Cream/red Soviet constructivist, diagonal clip-path, Anton ghost counters |
| `blizzard` | First Blizzard | Ice blue, layered SVG tree sidebar motif, Special Elite |

Theme applied via `document.documentElement.setAttribute('data-theme', theme)`.

Per-theme nav copy is in `NAV_LABELS` in `types.ts` (e.g. Assay uses "Engine Room", Politburo uses "Central Command").

## Screens

| ID | Name | Status |
|----|------|--------|
| `overview` | Overview / Camp Status | Live gateway data (channels, sessions, agents, approvals, crons) |
| `chat` | Chat / Dispatches | Static shell |
| `talk` | Talk / Telegraph | Static shell |
| `design` | Design Bureau / Blueprint | Static shell |
| `tasks` | Tasks / Works Orders / Directives | Static shell |
| `goals` | Goals / Ventures / Expeditions | Static shell |
| `orch` | Orchestration / Apparatus | Static shell |
| `editor` | Editor / Cartography / Field Docs | Static shell |
| `skills` | Skills / Craftsmen / Equipment | Static shell |
| `plan` | Plan / Build Plan | Phase plan doc |

## Phase plan

**Phase 0 (done):** Shell, themes, nav, WS client  
**Phase 1 (next):** Chat streaming, Overview live data, Editor with CodeMirror 6  
**Phase 2:** Talk (Web Audio), Design canvas, Skills management  
**Phase 3:** Tasks/Goals (kanban, AI decomposition, SQLite)  
**Phase 4:** Orchestration graph, multi-user, PWA

## Useful RPC methods

```
sessions.list / sessions.create / sessions.send / sessions.messages.subscribe
agents.list / agents.files.list / agents.files.get / agents.files.set
channels.status
usage.status
exec.approvals.get / exec.approval.resolve
cron.list
```

Events: `sessions.changed`, `session.message`, `health`, `exec.approval.requested`
