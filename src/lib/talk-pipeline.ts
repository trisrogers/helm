/**
 * Talk pipeline — Helm-side orchestration of STT → chat session → TTS using
 * the local Whisper + Kokoro providers behind the openclaw-voice-sidecar.
 *
 * Lifecycle for one Talk turn:
 *   start()        → creates transcription session, starts mic capture
 *   stopRecord()   → closes transcription session, awaits transcript.done
 *                    → pushes text to a regular openclaw chat session via
 *                      sessions.send, awaits assistant turn end
 *                    → calls talk.speak with the full reply, plays it
 *   start()        → next turn, same chat session
 *
 * State machine:
 *   idle → recording → finalizing → thinking → speaking → idle
 *                                     ↓
 *                                  (cancel) → idle
 *
 * Streaming TTS (C4): sentences are extracted from the assistant stream and
 * spoken as they complete; synthesis runs one chunk ahead of playback. See the
 * "streaming TTS pipeline" region below.
 *
 * Out of scope still (deferred to C5/D):
 *   - Barge-in / cancel on user speech onset.
 *   - Silero VAD; mic capture uses the existing PTT/auto-detect pipeline.
 */

import type { OpenClawClient } from './openclaw-client';
import { startMicCapture, type CaptureHandle } from './talk-audio';

export type PipelineState =
  | 'idle'
  | 'recording'
  | 'finalizing'
  | 'thinking'
  | 'speaking';

export interface PipelineCallbacks {
  onStateChange?: (state: PipelineState) => void;
  onMicHandle?: (handle: CaptureHandle | null) => void;
  onUserTranscript?: (text: string) => void;
  onAssistantText?: (text: string, streaming: boolean) => void;
  onError?: (err: Error) => void;
  /** Fired when the failure is specifically the local voice sidecar being
   *  unreachable (Whisper/Kokoro on :18790 down) rather than a generic per-turn
   *  error, so the UI can show an actionable "Talk offline" state with a fix
   *  instead of surfacing a raw `ECONNREFUSED` string. */
  onStackUnavailable?: (detail: string) => void;
}

// Wire shape emitted by talk-transcription-relay.ts. The outer frame uses
// `transcriptionSessionId` (not `sessionId`) and the transcript text sits at
// the root; the nested `talkEvent` carries the canonical TalkEvent shape.
interface TalkEventFrame {
  transcriptionSessionId?: string;
  type?: string;
  text?: string;
  final?: boolean;
  reason?: string;
  message?: string;
  talkEvent?: {
    sessionId?: string;
    type?: string;
    turnId?: string;
    payload?: { text?: string; message?: string } & Record<string, unknown>;
    final?: boolean;
  };
}

interface AgentEventFrame {
  sessionKey?: string;
  runId?: string;
  stream?: 'assistant' | 'lifecycle' | string;
  data?: { text?: string; phase?: string } & Record<string, unknown>;
}

interface TranscriptionSessionResult {
  sessionId: string;
  audio?: unknown;
}

interface TalkSpeakResult {
  audioBase64: string;
  mimeType?: string;
  outputFormat?: string;
  provider?: string;
}

const SAMPLE_RATE_INPUT = 16_000; // Whisper expects 16k PCM16 mono

// Prepended to each spoken turn so the agent knows it's being voiced. Without
// this the agent replies like a chat turn — markdown/lists (which TTS reads
// awkwardly) and silent tool runs (dead air while a tool executes). The
// pre-tool acknowledgment makes the agent stream a short spoken line BEFORE
// calling a tool, which streaming TTS then voices ~1s in instead of after the
// whole turn. The Helm transcript shows the clean utterance; only the session
// message carries this prefix.
const VOICE_TURN_DIRECTIVE =
  "[Voice conversation — your reply is read aloud by text-to-speech. Answer in " +
  "brief, natural spoken sentences. No markdown, asterisks, bullet points, " +
  "headings, code blocks, or emoji. Do not prefix your reply with a name, " +
  'speaker label, or "VOICE:" — just speak directly as yourself. If you need a ' +
  'tool, first say one short spoken line acknowledging it (e.g. "Let me check ' +
  'that for you"), then use the tool and continue. Keep it concise — this is a ' +
  "conversation, not a document.]";

/** Split streamed text into complete sentences. A sentence ends at .!? (plus
 *  any trailing quotes/brackets) followed by whitespace, or at a newline.
 *  Returns the consumed char count so the caller keeps the trailing partial
 *  unsent until more text arrives (or the run ends). Note: may over-split on
 *  abbreviations like "e.g." — acceptable for v0, speech still reads fine. */
function splitCompleteSentences(pending: string): { sentences: string[]; consumed: number } {
  const sentences: string[] = [];
  const boundary = /[.!?]+["')\]]*\s+|\n+/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(pending)) !== null) {
    const end = m.index + m[0].length;
    const chunk = pending.slice(lastIndex, end).trim();
    if (chunk) sentences.push(chunk);
    lastIndex = end;
  }
  return { sentences, consumed: lastIndex };
}

// First-chunk chunking: speak the opening phrase fast rather than waiting for a
// full sentence. Break on the first clause boundary (, ; : — or sentence end)
// at/after MIN chars; if none appears by MAX chars, break at a word boundary.
const FIRST_CHUNK_MIN = 12;
const FIRST_CHUNK_MAX = 90;

/** Find where the first spoken chunk should end within `pending`, or 0 if we
 *  should wait for more text. When `flushTail` (run ended) speak whatever's left. */
function findFirstChunkBoundary(pending: string, flushTail: boolean): number {
  const re = /[,;:—.!?\n]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pending)) !== null) {
    const ch = m[0];
    const end = m.index + 1;
    if (end < FIRST_CHUNK_MIN) continue;
    const after = pending[end];
    const sentenceEnd = ch === '.' || ch === '!' || ch === '?' || ch === '\n';
    if (after === undefined) {
      // Boundary sits at the end of the text streamed so far. If it's a
      // sentence end, dispatch now — waiting for trailing whitespace would
      // strand the chunk when the model then pauses for a tool call (the
      // acknowledgment "Let me check." would otherwise wait for the tool).
      // Clause punctuation (, ; :) still waits, since it usually continues.
      if (flushTail || sentenceEnd) return end;
      continue;
    }
    if (/\s/.test(after)) return end;
  }
  if (pending.length >= FIRST_CHUNK_MAX) {
    const sp = pending.slice(0, FIRST_CHUNK_MAX).lastIndexOf(' ');
    if (sp >= FIRST_CHUNK_MIN) return sp + 1;
  }
  return flushTail ? pending.length : 0;
}

/** True when an error message indicates the local voice sidecar (Whisper/Kokoro
 *  on 127.0.0.1:18790) is unreachable — connection refused/reset, or the gateway
 *  reporting an unknown transcription session because the relay's sidecar socket
 *  dropped. Lets the UI offer a fix instead of echoing a raw transport error. */
function isStackUnavailable(msg: string): boolean {
  return /ECONNREFUSED|ECONNRESET|18790|connection refused|Unknown transcription Talk session/i.test(
    msg,
  );
}

/** Strip a leading speaker label the model sometimes prepends despite the
 *  voice directive (e.g. "THE VOICE: …", "Assistant: …"). Idempotent and only
 *  matches at the very start, so it's safe to apply to cumulative deltas. */
function stripSpeakerLabel(text: string): string {
  return text.replace(/^\s*(?:the\s+voice|voice|assistant|ai)\s*:\s*/i, '');
}

export class TalkPipeline {
  private state: PipelineState = 'idle';
  private chatSessionKey: string | null = null;
  private talkSessionId: string | null = null;
  private captureHandle: CaptureHandle | null = null;
  private currentRunId: string | null = null;
  private offTalkEvent: (() => void) | null = null;
  private offAgent: (() => void) | null = null;
  private playbackSource: AudioBufferSourceNode | null = null;
  private audioCtx: AudioContext | null = null;
  private replyTextSoFar = ''; // cumulative assistant text for current run
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;

  // ── streaming TTS pipeline (C4) ──────────────────────────────────────
  // Sentences are extracted from the streaming assistant text and spoken as
  // they complete, rather than waiting for the whole reply. Synthesis runs one
  // chunk ahead of playback so sentence N+1 is being synthesized while N plays.
  private ttsQueue: string[] = []; // sentences awaiting synthesis, in order
  private audioQueue: AudioBuffer[] = []; // decoded buffers awaiting playback, in order
  private synthInFlight = false;
  private playInFlight = false;
  private runEnded = false; // assistant run finished; once queues drain we go idle
  private spokenUpTo = 0; // chars of replyTextSoFar already dispatched to TTS
  private sentFirstChunk = false; // first (clause-level) chunk of this turn dispatched
  private lastDispatchedChunk = ''; // re-anchor spokenUpTo if the cumulative text is rewritten mid-turn
  private ttsGen = 0; // bumped on reset; in-flight synth from an old gen is discarded

  private readonly client: OpenClawClient;
  private readonly agentId: string;
  private readonly callbacks: PipelineCallbacks;

  constructor(client: OpenClawClient, agentId: string, callbacks: PipelineCallbacks) {
    this.client = client;
    this.agentId = agentId;
    this.callbacks = callbacks;
  }

  getState(): PipelineState {
    return this.state;
  }

  /** Begin recording a new turn. Idempotent if already recording. */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;

    // Create + resume the playback AudioContext now, while we're still inside
    // the mic-tap user gesture. If we defer this to when the reply audio is
    // ready (mid async response), the browser's autoplay policy leaves the
    // context suspended until the *next* gesture — which made this turn's voice
    // only play after the next mic tap.
    this.ensurePlaybackContext();

    try {
      await this.ensureChatSession();
      await this.ensureGlobalSubscriptions();

      // Explicit provider selection: pipelined mode is specifically the
      // local sidecar path. Without provider, the gateway auto-selects which
      // typically picks a cloud STT provider (g711_ulaw/8k wire format).
      const talkSess = await this.client.call<TranscriptionSessionResult>(
        'talk.session.create',
        { mode: 'transcription', provider: 'transcription-local-whisper' },
      );
      this.talkSessionId = talkSess.sessionId;

      const handle = await startMicCapture({
        client: this.client,
        sessionId: talkSess.sessionId,
        targetSampleRateHz: SAMPLE_RATE_INPUT,
        initiallyActive: true,
        onError: (err) => this.reportFailure(err instanceof Error ? err.message : String(err)),
      });
      this.captureHandle = handle;
      this.callbacks.onMicHandle?.(handle);

      this.setState('recording');
    } catch (err) {
      this.callbacks.onError?.(err as Error);
      await this.cleanupTalkSession();
      this.setState('idle');
    }
  }

  /** Stop mic, finalize STT, run the LLM turn, speak the reply. */
  async stopRecord(): Promise<void> {
    if (this.state !== 'recording') return;
    this.setState('finalizing');

    // Stop pumping audio first so no more frames race in after close.
    this.stopCapture();

    // Closing the transcription session triggers the sidecar to finalize STT,
    // which emits transcript.done on talk.event. The handler picks it up.
    if (this.talkSessionId) {
      try {
        await this.client.call('talk.session.close', {
          sessionId: this.talkSessionId,
        });
      } catch (err) {
        this.callbacks.onError?.(err as Error);
        this.setState('idle');
        this.talkSessionId = null;
        return;
      }
      // Backstop: if transcript.done never arrives (e.g. sidecar dies mid-
      // inference), don't hang in "finalizing" forever.
      this.clearFinalizeTimer();
      this.finalizeTimer = setTimeout(() => {
        this.finalizeTimer = null;
        if (this.state === 'finalizing') {
          this.talkSessionId = null;
          this.callbacks.onError?.(new Error('transcription timed out'));
          this.setState('idle');
        }
      }, 30_000);
    }
  }

  /** Hard cancel: stop everything, drop state, back to idle. */
  async cancel(): Promise<void> {
    this.clearFinalizeTimer();
    this.captureHandle?.stop();
    this.captureHandle = null;
    this.callbacks.onMicHandle?.(null);

    this.stopPlayback();
    this.resetTtsState(); // drop any queued/in-flight TTS chunks

    if (this.currentRunId && this.chatSessionKey) {
      try {
        await this.client.call('sessions.abort', { key: this.chatSessionKey });
      } catch {
        /* best effort */
      }
    }
    this.currentRunId = null;

    if (this.talkSessionId) {
      try {
        await this.client.call('talk.session.close', { sessionId: this.talkSessionId });
      } catch {
        /* best effort */
      }
      this.talkSessionId = null;
    }

    this.setState('idle');
  }

  /** Tear down everything; called on Talk screen unmount. */
  async dispose(): Promise<void> {
    await this.cancel();
    this.offTalkEvent?.();
    this.offTalkEvent = null;
    this.offAgent?.();
    this.offAgent = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  // ── internals ──────────────────────────────────────────────────────

  private setState(next: PipelineState) {
    if (this.state === next) return;
    this.state = next;
    this.callbacks.onStateChange?.(next);
  }

  /** Tear down the mic capture. Idempotent — safe to call when already stopped. */
  private stopCapture() {
    this.captureHandle?.setActive(false);
    this.captureHandle?.stop();
    this.captureHandle = null;
    this.callbacks.onMicHandle?.(null);
  }

  private async ensureChatSession(): Promise<void> {
    if (this.chatSessionKey) return;
    const res = await this.client.call<{ key?: string; sessionKey?: string }>(
      'sessions.create',
      { agentId: this.agentId },
    );
    const key = res.key ?? res.sessionKey;
    if (!key) throw new Error('sessions.create returned no key');
    this.chatSessionKey = key;
    await this.client.call('sessions.messages.subscribe', { key });
  }

  private async ensureGlobalSubscriptions(): Promise<void> {
    if (!this.offTalkEvent) {
      this.offTalkEvent = this.client.on('talk.event', (payload) => {
        this.handleTalkEvent(payload as TalkEventFrame);
      });
    }
    if (!this.offAgent) {
      this.offAgent = this.client.on('agent', (payload) => {
        this.handleAgent(payload as AgentEventFrame);
      });
    }
  }

  private handleTalkEvent(e: TalkEventFrame) {
    if (!e || e.transcriptionSessionId !== this.talkSessionId) return;

    // The relay emits several `type:"transcript"` frames per turn: an empty
    // placeholder on close (talkEvent.type "input.audio.committed") and the real
    // Whisper result (talkEvent.type "transcript.done"), which lands AFTER the
    // "close" event because inference is async. Key off transcript.done so we
    // don't tear down on the early placeholder/close and drop the real result.
    const talkType = e.talkEvent?.type;

    if (talkType === 'transcript.done') {
      const text = (e.text ?? e.talkEvent?.payload?.text ?? '').trim();
      this.clearFinalizeTimer();
      this.talkSessionId = null;
      this.callbacks.onUserTranscript?.(text);
      if (text) {
        this.sendToChat(text);
      } else {
        // Whisper heard nothing — back to idle so the user can retry.
        this.setState('idle');
      }
    } else if (talkType === 'session.error' || e.type === 'error') {
      this.stopCapture();
      const msg = e.message ?? e.talkEvent?.payload?.message ?? 'transcription error';
      this.clearFinalizeTimer();
      this.reportFailure(String(msg));
      this.talkSessionId = null;
      this.setState('idle');
    } else if (e.type === 'close' && e.reason === 'error') {
      // Relay closed the session abnormally (e.g. sidecar error). The normal
      // "completed" close is ignored — transcript.done is still coming.
      this.stopCapture();
      this.clearFinalizeTimer();
      this.reportFailure('transcription session closed');
      this.talkSessionId = null;
      this.setState('idle');
    }
  }

  /** Route a failure to the right callback: a sidecar-unreachable condition gets
   *  the actionable onStackUnavailable (if the consumer wired it); everything
   *  else falls through to the generic onError. */
  private reportFailure(msg: string) {
    if (isStackUnavailable(msg) && this.callbacks.onStackUnavailable) {
      this.callbacks.onStackUnavailable(msg);
    } else {
      this.callbacks.onError?.(new Error(msg));
    }
  }

  private clearFinalizeTimer() {
    if (this.finalizeTimer !== null) {
      clearTimeout(this.finalizeTimer);
      this.finalizeTimer = null;
    }
  }

  private async sendToChat(text: string) {
    if (!this.chatSessionKey) {
      this.setState('idle');
      return;
    }
    this.setState('thinking');
    this.resetTtsState();
    try {
      const res = await this.client.call<{ runId?: string }>('sessions.send', {
        key: this.chatSessionKey,
        message: `${VOICE_TURN_DIRECTIVE}\n\n${text}`,
      });
      this.currentRunId = res.runId ?? null;
    } catch (err) {
      this.callbacks.onError?.(err as Error);
      this.setState('idle');
    }
  }

  private handleAgent(p: AgentEventFrame) {
    if (!p) return;
    if (p.sessionKey !== this.chatSessionKey) return;
    if (!this.currentRunId || p.runId !== this.currentRunId) return;

    if (p.stream === 'assistant' && typeof p.data?.text === 'string') {
      this.replyTextSoFar = stripSpeakerLabel(p.data.text);
      this.callbacks.onAssistantText?.(this.replyTextSoFar, true);
      this.flushSentences(false); // speak any newly-completed sentences now
    } else if (p.stream === 'lifecycle' && p.data?.phase === 'end') {
      this.currentRunId = null;
      this.callbacks.onAssistantText?.(this.replyTextSoFar.trim(), false);
      this.flushSentences(true); // dispatch the trailing partial sentence
      this.runEnded = true;
      this.maybeFinish();
    }
  }

  // ── streaming TTS pipeline ───────────────────────────────────────────

  /** Extract complete sentences from the streamed text and enqueue them.
   *  When `flushTail` is set (run ended) the trailing partial is enqueued too. */
  private flushSentences(flushTail: boolean) {
    // Re-anchor spokenUpTo by searching for the last chunk we actually
    // dispatched. The openclaw agent has been observed to rewrite the
    // cumulative reply mid-turn (e.g. stripping a pre-tool acknowledgment once
    // the tool finishes). With a static index we'd then start the tail from
    // mid-word; anchoring on what we've spoken survives any prefix rewrite.
    if (this.lastDispatchedChunk) {
      const idx = this.replyTextSoFar.lastIndexOf(this.lastDispatchedChunk);
      if (idx >= 0) {
        let next = idx + this.lastDispatchedChunk.length;
        while (next < this.replyTextSoFar.length && /\s/.test(this.replyTextSoFar[next])) next++;
        this.spokenUpTo = next;
      }
    }

    // First chunk: break on the opening clause so the reply starts speaking
    // fast, instead of waiting for the first full sentence.
    if (!this.sentFirstChunk) {
      const head = this.replyTextSoFar.slice(this.spokenUpTo);
      const end = findFirstChunkBoundary(head, flushTail);
      if (end > 0) {
        const chunk = head.slice(0, end).trim();
        if (chunk) this.enqueueTts(chunk);
        this.spokenUpTo += end;
        this.sentFirstChunk = true;
      } else if (!flushTail) {
        return; // not enough text yet for a first chunk
      }
    }

    const pending = this.replyTextSoFar.slice(this.spokenUpTo);
    const { sentences, consumed } = splitCompleteSentences(pending);
    for (const s of sentences) this.enqueueTts(s);
    this.spokenUpTo += consumed;
    if (flushTail) {
      const tail = this.replyTextSoFar.slice(this.spokenUpTo).trim();
      if (tail) this.enqueueTts(tail);
      this.spokenUpTo = this.replyTextSoFar.length;
    }
  }

  private enqueueTts(text: string) {
    this.lastDispatchedChunk = text;
    this.ttsQueue.push(text);
    this.pumpSynth();
  }

  /** Synthesize one chunk at a time, running ahead of playback. */
  private pumpSynth() {
    if (this.synthInFlight) return;
    const text = this.ttsQueue.shift();
    if (text === undefined) return;
    this.synthInFlight = true;
    const gen = this.ttsGen;
    // talk.speak resolves the TTS provider server-side from gateway config
    // (talk.provider → tts-local-kokoro); the schema rejects a `provider` field.
    this.client
      .call<TalkSpeakResult>('talk.speak', { text })
      .then((res) => {
        if (!res?.audioBase64) {
          console.warn('[talk] talk.speak returned no audio for chunk:', JSON.stringify(text));
          return null;
        }
        return this.decodeChunk(res.audioBase64);
      })
      .then((buf) => {
        if (gen !== this.ttsGen) return; // turn was reset/cancelled mid-flight
        if (!buf) {
          console.warn('[talk] decode failed; dropping chunk:', JSON.stringify(text));
          return;
        }
        this.audioQueue.push(buf);
        this.pumpPlay();
      })
      .catch((err) => {
        if (gen === this.ttsGen) this.callbacks.onError?.(err as Error);
      })
      .finally(() => {
        if (gen !== this.ttsGen) return; // stale: a newer turn owns the pipeline
        this.synthInFlight = false;
        this.pumpSynth(); // next chunk
        this.maybeFinish();
      });
  }

  /** Play decoded buffers strictly in order, one at a time. */
  private pumpPlay() {
    if (this.playInFlight) return;
    const buf = this.audioQueue.shift();
    if (!buf) return;
    if (this.state !== 'speaking') this.setState('speaking');
    this.playInFlight = true;
    this.playBuffer(buf)
      .catch(() => {})
      .finally(() => {
        this.playInFlight = false;
        this.pumpPlay(); // next buffer
        this.maybeFinish();
      });
  }

  /** When queues drain: go idle if the run ended, else fall back to "thinking"
   *  (we spoke an acknowledgment and are now waiting on a tool / more text). */
  private maybeFinish() {
    const drained =
      !this.synthInFlight &&
      !this.playInFlight &&
      this.ttsQueue.length === 0 &&
      this.audioQueue.length === 0;
    if (!drained) return;
    if (this.runEnded) {
      this.resetTtsState();
      this.setState('idle');
    } else if (this.state === 'speaking') {
      // Acknowledgment finished but the turn is still running (tool in flight).
      this.setState('thinking');
    }
  }

  private resetTtsState() {
    this.stopPlayback(); // hard-stop any lingering source so it can't bleed into the next turn
    this.ttsGen++; // invalidate any in-flight synth from the previous turn
    this.ttsQueue = [];
    this.audioQueue = [];
    this.synthInFlight = false;
    this.playInFlight = false;
    this.runEnded = false;
    this.spokenUpTo = 0;
    this.sentFirstChunk = false;
    this.lastDispatchedChunk = '';
    this.replyTextSoFar = '';
  }

  /** Get the playback context, creating it and kicking a resume if suspended.
   *  Called from start() (within the mic gesture) so the context is running
   *  before any audio needs to play; resume() is fire-and-forget (not awaited)
   *  so a stale autoplay block can't stall the synth pipeline. */
  private ensurePlaybackContext(): AudioContext {
    const ctx = (this.audioCtx ??= new AudioContext());
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  private async decodeChunk(base64: string): Promise<AudioBuffer | null> {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // decodeAudioData works on a suspended context; no need to await resume.
    const ctx = this.ensurePlaybackContext();
    try {
      return await ctx.decodeAudioData(bytes.buffer);
    } catch {
      return null;
    }
  }

  private playBuffer(buf: AudioBuffer): Promise<void> {
    const ctx = this.ensurePlaybackContext();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    this.playbackSource = src;
    return new Promise<void>((resolve) => {
      src.onended = () => {
        if (this.playbackSource === src) this.playbackSource = null;
        resolve();
      };
      src.start(0);
    });
  }

  private stopPlayback() {
    try { this.playbackSource?.stop(0); } catch { /* ignore */ }
    this.playbackSource = null;
  }

  private async cleanupTalkSession() {
    if (this.talkSessionId) {
      try {
        await this.client.call('talk.session.close', { sessionId: this.talkSessionId });
      } catch { /* ignore */ }
      this.talkSessionId = null;
    }
    this.captureHandle?.stop();
    this.captureHandle = null;
    this.callbacks.onMicHandle?.(null);
  }
}
