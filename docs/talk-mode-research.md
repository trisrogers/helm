# Talk Mode v0 — Research & Decisions

Date: 2026-05-24
Status: design phase, no implementation yet
Owner: Tris

---

## TL;DR

Build Talk as a local sidecar process. Pipelined STT → openclaw → TTS. Voice turns continue the existing text session — they are not a parallel channel.

**v0 stack (recommended):**

| Slot | Choice | Why |
|---|---|---|
| STT | **faster-whisper distil-large-v3 (int8)** | ~10× realtime on 4060 Ti, ~1.5 GB VRAM, streaming partials |
| TTS primary | **Kokoro-82M** | Lowest first-chunk latency, ~300 MB VRAM, good stock voices, streaming-friendly |
| TTS fallback | **Piper** | CPU-only, <100 ms latency, used when GPU is busy or for filler phrases |
| TTS v1+ | XTTS-v2 (deferred) | Voice cloning unlocks themed voices later; too slow for v0 perf bar |
| VAD | Silero VAD (ONNX) | Client-side, low CPU, well-supported |
| Chunking | Hybrid: first-phrase, then sentence | Lowest perceived latency without prosody damage |
| Barge-in | Client VAD → `tts.cancel` → `sessions.abort` | Openclaw already exposes `sessions.abort` ✅ |
| UX | Dedicated Talk screen, session-shared with Chat | Theme treatment matters; sharing the session matches the integration model |

Hardware confirmed 2026-05-24: RTX 4060 Ti, 8 GB VRAM (~6 GB free), Ryzen 7 5800X, 16 threads, 11 GB RAM free, WSL2 CUDA passthrough working.

---

## Decisions already locked

1. **Architecture: pipelined**, not end-to-end realtime. Rules out OpenAI Realtime, Gemini Live. Keeps LLM choice + tool calls on openclaw's side.
2. **v0 stack: local self-hosted**, not paid cloud. Sidecar topology (separate Python process, WebSocket on `:18790`).
3. **Integration model: voice is a continuation of the text session.** Same `sessions.send` / `sessions.messages.subscribe` plumbing. Sidecar is a dumb transducer; session state lives in openclaw.

See `memory/project_talk_mode_architecture.md` for the locked rationale.

---

## TTS engine comparison (perf-weighted)

Tris's prior experience: previously played with Kokoro and was happy with tests, but it wasn't compared. Performance is now the primary axis; themed voices are deferred to v1+.

| | **Kokoro-82M** | **XTTS-v2** | **Piper** |
|---|---|---|---|
| Size | 82M params, ~300 MB | ~2 GB on disk + VRAM | ~50–100 MB |
| First-chunk latency (GPU) | **~150–250 ms** | ~400–600 ms | n/a (CPU only, ~50–100 ms) |
| Realtime factor (GPU) | ~10–15× | ~3–5× | ~20× (CPU) |
| Quality (subjective) | Very good — punches above weight | Best in class | Acceptable, robotic prosody |
| Voice variety | ~10 curated voices (no cloning) | Voice clone from 6s sample | ~50 stock voices, no cloning |
| Streaming | Yes, native | Yes, but slower first chunk | Yes |
| Maturity | New (2025), active dev | Mature, Coqui-licensed | Mature, very stable |
| Themed-voice fit | Limited (stock voices only) | **Strong** (clone from clips) | None |

**Verdict for v0: Kokoro primary, Piper fallback, XTTS deferred.**

- Kokoro's first-chunk latency is the killer feature for "fluid conversation." It beats XTTS by ~2–3×.
- Piper as fallback covers two cases: (a) GPU contention with the LLM, (b) very short utterances ("mm-hm", "got it") where the latency overhead of GPU TTS isn't worth it.
- XTTS comes back when we decide themed character voices are worth a ~300 ms latency hit. That's a v1+ decision after we know whether Talk mode actually gets used.

---

## #3 Chunking strategy for streaming TTS

The LLM streams tokens; we need to decide when to flush text to the TTS engine. Goal: minimize first-audio latency without producing choppy prosody.

| Option | First-audio latency | Prosody | Notes |
|---|---|---|---|
| Whole-turn | Bad (waits for full response) | Best | Kills the streaming win — reject |
| Strict sentence (`.!?`) | Medium | Good | Common baseline. Bad on long opening sentences. |
| Phrase (`,;:` + sentence) | Low | Variable | Cuts mid-clause sometimes — odd cadence |
| Token-count (every N) | Very low | Bad | Robotic, breaks pronunciation context |
| **Hybrid: first-phrase, then sentence** | **Lowest viable** | **Good** | First chunk on first phrase boundary (or first 8 words, whichever sooner), then strict sentence boundaries afterwards |

**Recommended: hybrid.** Implementation sketch:

```
buffer = ""
sent_first = false
for token in llm_stream:
  buffer += token
  if not sent_first:
    if has_phrase_boundary(buffer) or word_count(buffer) >= 8:
      tts.speak(buffer); buffer = ""; sent_first = true
  else:
    while sentence = pop_complete_sentence(buffer):
      tts.speak(sentence)
on_stream_end:
  if buffer: tts.speak(buffer)
```

The phrase-boundary first-chunk gets audio playing in <1s after user stops talking (Whisper finalize ~200ms + first-chunk LLM ~300ms + Kokoro ~200ms ≈ 700ms total). Subsequent sentences arrive while the first plays.

---

## #4 Barge-in mechanism

The user must be able to interrupt the assistant mid-sentence and have everything stop cleanly.

**Good news:** openclaw already exposes `sessions.abort` (found at `src/gateway/server-methods/sessions.ts:1743`, scope `operator.write`, tested at `src/gateway/server.chat.gateway-server-chat.test.ts:309`). This was the highest-risk unknown — it's solved.

**Barge-in pipeline:**

```
1. Client VAD detects user speech onset
2. Client immediately: stop playback, flush audio output queue
3. Client → sidecar: tts.cancel  (kill any in-flight synthesis)
4. Client → openclaw: sessions.abort {sessionId, runId}
5. Begin new STT stream for the interrupting utterance
6. (Optional) Prepend "[interrupted]" marker to the next user message so the LLM knows the previous turn was cut short
```

**VAD options:**

| | **Silero VAD (ONNX)** | **WebRTC VAD** | **Energy threshold** |
|---|---|---|---|
| Accuracy | Very high | Medium | Low (false triggers) |
| Runtime | ONNX in web worker, ~5ms per frame | C in browser via WASM | Pure JS, trivial |
| Robustness to noise | Excellent | Decent | Poor |
| Dev effort | Medium | Medium | Low |

**Recommended: Silero VAD in a web worker.** Energy threshold for v0 prototype is acceptable but will produce false interruptions in any room with background noise.

---

## #5 UX surface

| Option | Description | Pros | Cons |
|---|---|---|---|
| A. Dedicated Talk screen | Standalone screen with themed visual (Telegraph, Dispatches, etc. per theme) | Strong product identity, room for visualizer / waveform / character art | User has to "switch modes" |
| B. Mic toggle on Chat | Add mic button to existing Chat screen, voice becomes a mode | Zero context switch, immediately discoverable | Wastes the Telegraph theme work; visual is constrained |
| C. **Both — Talk as dedicated screen, session-shared with Chat; mic icon on Chat as shortcut** | Talk screen operates on whichever session is currently selected; clicking mic in Chat opens Talk with the same session | Best of both | Slightly more UI to build |

**Recommended: C.** The themed Telegraph/Dispatches treatment is part of the product identity (Politburo's "Telegraph" copy is already in the nav labels). But the integration model says voice continues a text session, so we need session-sharing too.

Concrete behavior:
- Talk screen has a session list (same as Chat) and the currently-selected session is the conversation target.
- Chat screen gains a mic button that switches to Talk with the current session preserved.
- Toggling Talk off while a session is active drops back to Chat with the same session selected.
- The session log is shared — voice turns appear as text messages in Chat (transcripts on input, raw text on output), and Chat messages appear above the waveform in Talk.

---

## Sidecar protocol sketch

WebSocket on `ws://localhost:18790`. Bearer token auth (mirrors Helm's openclaw connection pattern, separate `helm:voice-token` key in localStorage).

```
client → server:
  { type: "req", id, method: "stt.stream.start", params: { sampleRate: 16000, language: "en" } }
  { type: "audio", streamId, chunk: <base64 PCM 16kHz mono> }   // many of these
  { type: "req", id, method: "stt.stream.end", params: { streamId } }
  { type: "req", id, method: "tts.speak", params: { text, voice, format: "opus" } }
  { type: "req", id, method: "tts.cancel", params: { ttsId } }
  { type: "req", id, method: "health" }

server → client:
  { type: "event", topic: "stt.partial", streamId, text }
  { type: "event", topic: "stt.final", streamId, text }
  { type: "event", topic: "tts.chunk", ttsId, chunk: <base64 audio> }
  { type: "event", topic: "tts.end", ttsId }
  { type: "res", id, ok, payload }
```

Sidecar is stateless w.r.t. openclaw sessions. The Helm orchestrates: STT result → `sessions.send` → token stream → chunker → `tts.speak`.

---

## v0 build sequence

Each step is independently shippable / testable.

1. **Sidecar scaffolding.** Python project, FastAPI + websockets, `health` endpoint only, runs at `:18790`.
2. **STT path.** Add `stt.stream.start/end` + audio chunk handling. faster-whisper distil-large-v3 int8 on GPU. Smoke-test with a recorded WAV.
3. **TTS path.** Add `tts.speak` + chunked output. Kokoro-82M. Smoke-test by speaking a fixed string.
4. **Helm voice-client.** `src/lib/voice-client.ts` WebSocket client. Mic capture via `getUserMedia` → upload chunks → log transcripts. No openclaw integration yet.
5. **Wire to a session.** Helm sends final transcript to openclaw `sessions.send`, subscribes to stream, sentence-chunks output, sends to `tts.speak`, plays audio. Single-turn working end-to-end.
6. **Barge-in.** Silero VAD in worker → on speech start, cancel TTS + abort openclaw turn.
7. **Talk screen.** Themed visual treatment per active theme (Telegraph for Politburo, etc.). Session list shared with Chat. Mic shortcut on Chat.
8. **Piper fallback.** Add as second TTS engine; route short utterances or GPU-busy turns through it.

Each step ends with a smoke test on the dev port (Helm at `:5174`, openclaw at `:18789`, sidecar at `:18790`).

---

## Deferred to v1+

- **Themed character voices** (XTTS clone from 6s samples — English geezer / Russian spy / gruff woodsman). Re-evaluate after we know if Talk mode is actually used. Sourcing voice samples with consent is a separate concern.
- **Hosted swap.** Same sidecar protocol, swap implementation to ElevenLabs / Deepgram / Cartesia. Decision driven by either (a) themed-voice quality demand, (b) wanting to run on a machine without a GPU.
- **Multi-language.** Russian spy voice actually speaking Russian, etc. Kokoro is English-only currently; XTTS supports ~16 languages.
- **Backchannels** ("mm-hm" while user talks). Probably annoying; skip unless requested.
- **PWA / mobile.** Out of scope until we have a desktop product worth carrying.

---

## Open questions to revisit

- **Voice token persistence.** Sidecar bearer token shape — same as openclaw or independent? Probably independent so sidecar can run without openclaw.
- **Echo cancellation.** `getUserMedia({ audio: { echoCancellation: true } })` works in Chrome but is fragile. May need a real AEC if speakers + mic are used (headphones avoid the issue entirely — assume headphones for v0).
- **VAD threshold tuning.** Silero defaults are good but room-dependent; expose as a setting later.
- **Talk session log rendering.** Voice messages in Chat — do we show them differently (mic icon, audio playback button to re-listen)? Decide when building step 7.
