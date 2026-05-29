# Talk Mode v0 — Deployment Plan

Date: 2026-05-24 (revised after openclaw infrastructure survey)
Status: planning, awaiting go-ahead on revised scope
Companion: `docs/talk-mode-research.md` (design + decisions)

---

## TL;DR

**Openclaw already implements our architecture.** Its `talk.session.create` `stt-tts` mode is pipelined STT→LLM→TTS, brain=`agent-consult` runs a normal openclaw session so voice turns appear in the text session log. The provider plugin interfaces exist, are well-defined, and have multiple cloud implementations. Our work is much smaller than originally scoped.

**Two real gaps:**
1. No local Whisper transcription provider. We ship one.
2. No local high-quality TTS provider. We ship one (or extend the existing `tts-local-cli` to drive Kokoro via a sidecar).

**Helm-side change** is a small extension to `Talk.tsx` (currently hardcodes `mode: 'realtime'`; needs to pick `stt-tts` when available) + managed-room transport support in `talk-audio.ts`.

**Sidecar topology** is still right — torch + GPU models stay out of the gateway. But the sidecar's consumer is now openclaw plugins, not Helm directly.

---

## Corrected architecture

### What openclaw exposes today

`talk.session.create` supports three modes (`src/gateway/server-methods/talk-session.ts`):

| Mode | Flow | Providers needed | Transport |
|---|---|---|---|
| `realtime` | Client mic → Provider realtime API → Client speaker. End-to-end on provider side. | `RealtimeVoiceProvider` | `gateway-relay` or client-native |
| `transcription` | Client mic → STT → transcript events. No LLM, no audio out. | `RealtimeTranscriptionProvider` | `gateway-relay` |
| **`stt-tts`** | **Client mic → STT → openclaw chat session → TTS → Client speaker.** Brain=`agent-consult` means it's a normal session: tools, memory, approvals all work. | Speech provider (TTS) + Transcription provider (STT) | `managed-room` |

`stt-tts` mode is **exactly** our architecture from `[[project-talk-mode-architecture]]`. Turns end up in the normal session log (`talk-agent-consult.ts:179` → `chat.send`). Memory's "voice continues a text session" model is what openclaw natively does in this mode.

### Provider plugin interfaces

All defined in `~/openclaw-src/src/plugins/types.ts`:

| Type | Interface | Methods | File line |
|---|---|---|---|
| TTS | `SpeechProviderPlugin` | `synthesize`, `streamSynthesize?`, `listVoices?`, `isConfigured` | 1828 |
| STT | `RealtimeTranscriptionProviderPlugin` | `createSession` (returns object with `connect`/`sendAudio`/callbacks), `isConfigured` | 1863 |
| Realtime | `RealtimeVoiceProviderPlugin` | `createBridge`, `createBrowserSession?`, `isConfigured` | 1881 |

Providers register via `openclaw.plugin.json` files in `extensions/`. `talk.catalog` returns the configured set (`isConfigured()` true) for client UI to enumerate.

### Provider audit (what ships today)

| | Cloud providers | Local providers |
|---|---|---|
| TTS | OpenAI, ElevenLabs, Mistral, XAI, Azure Speech, DeepInfra, Vydra, … | **`tts-local-cli`** (shells to any CLI: piper, espeak, etc.) |
| STT | OpenAI Whisper API, Deepgram, ElevenLabs, Google Cloud Speech | **None** ← gap |
| Realtime | OpenAI Realtime, Google Live | **None** (and architecture rejects realtime mode anyway) |

### Implications for our plan

- The "Helm↔sidecar direct protocol" from the original plan is **deleted**. Helm talks to openclaw using existing `talk.*` methods. The sidecar's job is to provide inference behind openclaw provider plugins.
- The "build voice-client.ts" task is **already done** as `src/lib/talk-audio.ts` (mic capture, resampling, base64 PCM, playback queue).
- Helm needs `stt-tts` mode + managed-room transport support — currently hardcoded to `realtime`.
- TTS may not need new openclaw code at all: `tts-local-cli` can shell to Piper for the CPU fallback path with **zero new lines**. The Kokoro GPU path needs a sidecar.

---

## Revised pre-work

| # | Task | Status | Why |
|---|------|--------|-----|
| 0.1 | Confirm GPU + uv toolchain. WSL2 `nvidia-smi` works (not on PATH; lives at `/usr/lib/wsl/lib/nvidia-smi`). 8188 MiB total / 5944 MiB free. uv 0.11.13, python 3.12.3. | ✅ done | Hardware baseline for any GPU work. |
| 0.2 | Sidecar repo scaffold at `~/projects/openclaw-voice-sidecar/`. `~/models/`, `~/.openclaw-voice/token` (44 bytes). | ✅ done | Repo skeleton + paths created during initial pre-work. Empty git init, no code yet. |
| 0.3 | Check current openclaw config for voice providers. Result: **nothing configured** — `voice-call`, `openai-whisper-api`, `sherpa-onnx-tts` all disabled, and the latter two are *skills*, not Talk providers. Talk screen has been a silent no-op. | ✅ done | Confirms there's no working baseline to regress; clean slate. |
| 0.4 | Plugin repo location: **out-of-tree** at `~/projects/openclaw-voice-plugins/{transcription-local-whisper,tts-local-kokoro}/`, installed via `openclaw plugins install ./path` (pattern documented at `~/openclaw-src/docs/prose.md:30`). No modifications to `~/openclaw-src/extensions/`. | ✅ done | Locked. |
| 0.5 | Sidecar protocol: **WebSocket**. Enables faster-whisper streaming partials for the live transcription UX. | ✅ done | Locked. |

### Locked decisions (carried from prior rounds)

- Sidecar repo at `~/projects/openclaw-voice-sidecar/` (sibling of helm).
- Independent voice token (`~/.openclaw-voice/token`), separate from openclaw token.
- Headphones required for v0 — no AEC work.
- TTS: do both Piper-via-`tts-local-cli` (B2a, zero code) AND Kokoro plugin (B2b) up front.
- Sherpa-onnx-tts CLI is an alternative for B2a if Piper has issues; flagged but not the default.

---

## Revised phases

### Phase A — Sidecar inference services (Python) ✅ DONE 2026-05-24

**Built:** `~/projects/openclaw-voice-sidecar/`. FastAPI + uvicorn on `:18790`. WebSocket-only protocol (one endpoint `/v1/voice?token=…`), JSON+base64 frames, methods: `health` / `stt.stream.start` / `stt.stream.end` / `tts.speak` / `tts.cancel` / `tts.voices`. HTTP `/health` for non-WS pings. Lazy model loading. Bearer token at `~/.openclaw-voice/token`.

**Stack:** faster-whisper distil-large-v3 int8_float16 on CUDA, kokoro-onnx v1.0 (onnxruntime-gpu). No torch.

**Smoke results:**
- ✅ GPU detected via WSL `nvidia-smi` (8188 MiB total, 5105 MiB free with both engines loaded — used ~1 GB).
- ✅ Kokoro loaded in 1.14 s (cold).
- ✅ Whisper distil-large-v3 downloaded + loaded in 112.75 s (one-time; cached in `~/.cache/huggingface/`, 1.5 GB).
- ✅ TTS round-trip works. Warm-cache latencies: 13-char input → 413 ms; 40 chars → 741 ms; 105 chars → 1626 ms.
- ✅ STT round-trip works. 1 s of silence → empty transcript, VAD filter active.

**Issues surfaced (carry into Phase B):**
- **Kokoro `create_stream` does not stream for short–medium text.** Returns a single chunk regardless of length, so first-chunk latency ≈ total latency (~15 ms / char). Defeats the streaming benefit. **Fix path:** text-chunk on the openclaw provider side per the research doc's hybrid (first-phrase then sentence) algorithm — issue one `tts.speak` per sentence so the user hears the first phrase fast. Sidecar code unchanged.
- **Whisper batched only** (no partials) as planned for v0. Final-only `stt.final` emission. Streaming partials remain a v1 enhancement.

**Effort:** ~2 hours actual (vs 1–2 day estimate). Mostly waiting on `uv sync` + first model download.

### Phase B — Openclaw provider plugins ✅ DONE 2026-05-24

**Built:** `~/projects/openclaw-voice-plugins/{tts-local-kokoro,transcription-local-whisper}/`. Out-of-tree, `npm pack` → `openclaw plugins install <tgz>`. Both written against the published `openclaw` SDK (`openclaw/plugin-sdk/<subpath>` exports). Both installed to `~/.openclaw/extensions/` and live-linked to `/home/tris/.npm-global/lib/node_modules/openclaw` for peer resolution.

| Plugin | Contract | Status after restart | Direct test |
|---|---|---|---|
| `tts-local-kokoro` | `speech: tts-local-kokoro` | loaded, registered | synthesize() round-trip: 931 ms / 155 KB WAV for 55-char input |
| `transcription-local-whisper` | `realtime-transcription: transcription-local-whisper` | loaded, registered | createSession→connect (12 ms) → 15 silence frames → close → onTranscript fired (empty, correct) |

**B2a (Piper via existing `tts-local-cli`)** — deferred to Phase D (it's the fallback path; Phase D's "Piper fallback" item is its real home). Bundled `tts-local-cli` is already enabled but not configured; flipping it on needs the Piper binary + a voice + tts-local-cli config — none of which are required for the Phase B gate.

**Smoke gate results:**
1. ✅ Gateway restarted, both plugins loaded.
2. ✅ Plugin capability registration confirmed via `openclaw plugins inspect --runtime`.
3. ⏸️ `talk.catalog` / `talk.speak` / `talk.session.create stt-tts` from a connected client — deferred to Phase C. Auth path for Node-side smoke scripts needs a paired device token; rather than going through that ceremony, verification happens naturally when Helm itself drives the flow (browser has the token already).

**Issues surfaced (carry forward):**
- **Auth blocker for non-browser RPC smoke.** `controlUi.allowInsecureAuth: true` does *not* exempt loopback Node clients from device identity — error: "device identity required". Helm browser is paired, scripts aren't. Worked around by direct-importing the plugin code in a Node test (bypasses gateway routing but proves the plugin's actual code path including sidecar round-trip).
- **Plugin install nuance:** `openclaw plugins install ./path` fails if the source dir has a local `node_modules/openclaw` (the install can't replace it with a symlink). Workaround: `npm pack` and install the tarball. Documented above.

**Effort:** ~2 hours actual.

### Phase C — Helm orchestrates the STT→LLM→TTS pipeline

**Plan revised 2026-05-24** after investigating managed-room: it is built for *server-side* audio sources (Discord voice bot, etc.), not browser mics. `appendAudio` is explicitly rejected for managed-room (`talk-session.ts:443`) and no client-audio equivalent exists. So the "use stt-tts mode" path doesn't work for our use case. The doc's previously-noted "fallback" is in fact the only viable path — and it matches the architecture memory ("openclaw doesn't know voice exists; voice continues the text session") even better than stt-tts mode would.

**Goal:** Helm orchestrates the pipeline using `transcription` mode for STT, the regular `sessions.send` API for the LLM brain, and `talk.speak` for per-chunk TTS. Same end-user experience.

**Sub-tasks:**
- **C1 — Mode detection + UI badge.** `Talk.tsx` reads `talk.catalog` on connect, computes whether a "pipelined" stack is available (configured transcription provider AND configured speech provider). Surfaces in the mode badge. No behaviour change yet — observable gate before C2.
- **C2 — Pipeline orchestration.** New `talk-pipeline.ts` module: create `mode: 'transcription'` session, push mic via existing `talk.session.appendAudio`, await `transcript.final`, push to a regular openclaw session via `sessions.send`, watch streaming response, sentence-chunk on Helm side, call `talk.speak({ provider: 'tts-local-kokoro' })` per chunk, decode + enqueue audio.
- **C3 — Session selection.** Voice turns enter the Chat screen's currently-selected session (matches "voice continues the text session"). If none selected, create one on first Talk press.
- **C4 — TTS chunking.** Hybrid first-phrase-then-sentence chunker per research doc, in `talk-pipeline.ts`. Target: first audio chunk within ~1 s of mic release.
- **C5 — Light barge-in.** On user speech onset during playback: stop playback, drain queue, send `tts.cancel` to sidecar, abort the in-flight openclaw turn. Heavy barge-in (Silero VAD worker) is Phase D.

**Smoke gate:**
1. Sidecar + openclaw + Helm all running. Helm at `:5174`, openclaw at `:18789`, sidecar at `:18790`.
2. Open Talk — badge says "Pipelined (local)".
3. Hold mic, say "what's two plus two." Within ~1 s transcript bubble appears. Within ~1.5 s audio reply starts. Chat shows the exchange as text.
4. Toggle to Chat, type a follow-up — same session continues.

**Risk:** state-machine complexity across STT→session→TTS plus cancellation paths. Components themselves are all proven (Phase A sidecar, Phase B plugins, `transcription` mode is the simplest of the three talk modes).

**Effort:** 2–3 days estimate holds.

### Phase D — Polish

**Goal:** the user-facing finish items from the original plan.

**Deliverables:**
- **D1 — Themed Talk screen polish:** Per-theme visual treatment. Talk.tsx already has theme-aware agent name; expand to backdrop / waveform color / copy register.
- **D2 — Chat mic shortcut:** Mic button on Chat screen → switches to Talk preserving session selection.
- **D3 — Piper fallback path:** If Kokoro is unavailable or VRAM is tight, sidecar transparently falls back to Piper. Or expose as a separate provider so openclaw routes to Piper for short utterances.
- **D4 — Barge-in:** Silero VAD as a web worker → on speech onset, stop playback, send `talk.session.cancel` (verify exists) or similar.

**Smoke gate:** themes look right per `[[project-theme-decisions]]`; mic shortcut works; barge-in cancels mid-sentence cleanly.

**Effort:** 2–3 days.

---

## Operational concerns (unchanged from prior plan)

### Repo layout
```
~/projects/
  helm/                          ← this repo
  openclaw-voice-sidecar/        ← new; Python; sibling of helm
  openclaw-voice-plugins/        ← maybe — depends on pre-work 0.4
~/openclaw-src/                  ← consumes new plugins; modified only if 0.4 says so
~/models/                        ← shared model weights, gitignored everywhere
~/.openclaw-voice/token          ← sidecar bearer token
```

### Process lifecycle
- **Dev:** four terminals (Helm `npm run dev`, openclaw, sidecar `uv run python -m sidecar`, plus any test client). Document the bring-up order in sidecar README.
- **Prod (same machine):** defer systemd until Phase D is stable. Then a user-level systemd unit for the sidecar.

### Model storage
- `~/models/` shared across projects. Sidecar reads `OPENCLAW_VOICE_MODELS_DIR` env var (default `~/models/`).
- Models gitignored. First-run script (`scripts/download-models.sh`) idempotently fetches missing ones.
- Disk budget: ~2 GB total.

### Logging
- Sidecar logs to stdout in dev; structured JSON. Latency fields (`stt_ms`, `tts_first_chunk_ms`, `tts_total_ms`) for later perf review.

### Feature isolation
- The new openclaw plugins must be configurable off via `openclaw.config.json`. If Kokoro plugin regresses the gateway, disable in config → fall back to whatever else is registered.

---

## Risks (revised)

| Risk | Mitigation |
|------|------------|
| Helm's `Talk.tsx` change to use `stt-tts` + managed-room is harder than expected | Fallback to `transcription` mode + `talk.speak` chained, using simpler `gateway-relay`. |
| Whisper streaming partials don't fit openclaw's `RealtimeTranscriptionProvider` shape cleanly | Ship final-only for v0. Partials = v1. |
| WSL2 + CUDA + torch / ctranslate2 breakage on kernel update | Pin versions in `pyproject.toml`. Document working versions. |
| Kokoro license blocks distribution | Verify in pre-work; fall back to Piper as primary if blocked. |
| Sidecar OOM with LLM + Whisper + Kokoro all on the same GPU | Health endpoint exposes VRAM headroom; plugin's `isConfigured` returns false if insufficient. Openclaw then routes to fallback. |
| Modifying `~/openclaw-src/extensions/` directly means PRs to openclaw repo | Pre-work 0.4 decides this. If a hassle, plugins live out-of-tree and we add a load path. |

---

## Open questions to resolve before starting

All pre-work decisions resolved (see table above). Ready to begin Phase A on the user's go.
