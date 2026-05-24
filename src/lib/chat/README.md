# `lib/chat/` — vendored from openclaw-src

Source of truth: `~/openclaw-src/ui/src/ui/` (and `~/openclaw-src/src/shared/`).

These modules were lifted from the OpenClaw dash UI to give Helm feature parity for the chat surface (model picker, slash commands, input history, pinned messages, export, etc). The dash UI is built with Lit web components; this directory contains only the framework-agnostic TypeScript — the React surface lives in `src/screens/Chat.tsx`.

## When to update

- **Bug fix in Helm's chat behaviour**: fix here.
- **Bug fix that also applies upstream**: fix upstream, then re-sync the file here.
- **New feature from dash**: lift the relevant file, mirror its imports.

## Adaptations made during lift

- `string-coerce.ts` — local copy of the 4 normalize functions actually used (not the full upstream module).
- `message-extract.ts` — simplified: handles `string | array | {text}` content but does NOT strip envelopes, inbound metadata, or thinking tags. If the gateway starts emitting unstripped content to UI clients, vendor `src/shared/chat-envelope.ts`, `src/shared/chat-message-content.ts`, `src/agents/internal-runtime-context.ts`, `src/auto-reply/reply/strip-inbound-meta.ts` and use the upstream version.
- `chat-model-select-state.ts` — `AppViewState` replaced with a local `ChatModelSelectStateInput` interface (we don't want the dash's god-state).
- `types.ts` — only the chat-relevant types (`ModelCatalogEntry`, `GatewayThinkingLevelOption`, `SessionRow`, `SessionsDefaults`, `SessionsListResult`).

## What's NOT lifted yet

- `tool-display.ts` — depends on a JSON config in the macOS app bundle + `src/agents/tool-display-common.ts`. Defer until tool-card rendering is needed.
- `slash-commands.ts` + `slash-command-executor.ts` — depend on `src/auto-reply/commands-registry.shared.ts` (~967 LOC). Phase B.
- The Lit views (`session-controls.ts`, `chat-welcome.ts`, `run-controls.ts`, `copy-as-markdown.ts`) — these are framework-bound; re-implement in React.
