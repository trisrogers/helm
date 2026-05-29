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
 * Out of scope for v0 (deferred to C4/C5/D):
 *   - Sentence-chunked TTS during streaming. v0 waits for the full reply.
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

  constructor(
    private readonly client: OpenClawClient,
    private readonly agentId: string,
    private readonly callbacks: PipelineCallbacks,
  ) {}

  getState(): PipelineState {
    return this.state;
  }

  /** Begin recording a new turn. Idempotent if already recording. */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;

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
        onError: (err) => this.callbacks.onError?.(err as Error),
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
    this.captureHandle?.setActive(false);
    this.captureHandle?.stop();
    this.captureHandle = null;
    this.callbacks.onMicHandle?.(null);

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
      }
    }
  }

  /** Hard cancel: stop everything, drop state, back to idle. */
  async cancel(): Promise<void> {
    this.captureHandle?.stop();
    this.captureHandle = null;
    this.callbacks.onMicHandle?.(null);

    this.stopPlayback();

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
    // The relay emits two kinds of `type: "transcript"` events: an empty one
    // from stopTalkTranscriptionRelaySession (synchronous on close) and the
    // real one from onTranscript once Whisper finishes. Forward only frames
    // with non-empty text; ignore the empty-final placeholders.
    if (e.type === 'transcript' && e.final && typeof e.text === 'string' && e.text.trim()) {
      const text = e.text.trim();
      this.talkSessionId = null;
      this.callbacks.onUserTranscript?.(text);
      this.sendToChat(text);
    } else if (e.type === 'close') {
      // Session closed by relay (e.g. stt timeout or error after we requested
      // close). If we're still in finalizing and no transcript ever arrived,
      // drop back to idle so the user can retry.
      if (this.state === 'finalizing') {
        this.talkSessionId = null;
        this.setState('idle');
      }
    } else if (e.type === 'error') {
      const msg = e.message ?? 'transcription error';
      this.callbacks.onError?.(new Error(msg));
      this.talkSessionId = null;
      this.setState('idle');
    }
  }

  private async sendToChat(text: string) {
    if (!this.chatSessionKey) {
      this.setState('idle');
      return;
    }
    this.setState('thinking');
    this.replyTextSoFar = '';
    try {
      const res = await this.client.call<{ runId?: string }>('sessions.send', {
        key: this.chatSessionKey,
        message: text,
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
      this.replyTextSoFar = p.data.text;
      this.callbacks.onAssistantText?.(p.data.text, true);
    } else if (p.stream === 'lifecycle' && p.data?.phase === 'end') {
      const finalText = this.replyTextSoFar.trim();
      this.currentRunId = null;
      this.callbacks.onAssistantText?.(finalText, false);
      this.replyTextSoFar = '';
      if (finalText) {
        this.speakReply(finalText);
      } else {
        this.setState('idle');
      }
    }
  }

  private async speakReply(text: string) {
    this.setState('speaking');
    try {
      const res = await this.client.call<TalkSpeakResult>('talk.speak', {
        text,
        provider: 'tts-local-kokoro',
      });
      if (!res?.audioBase64) {
        this.setState('idle');
        return;
      }
      await this.playAudio(res.audioBase64);
    } catch (err) {
      this.callbacks.onError?.(err as Error);
    } finally {
      this.setState('idle');
    }
  }

  private async playAudio(base64: string): Promise<void> {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const ctx = (this.audioCtx ??= new AudioContext());
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    const buf = await ctx.decodeAudioData(bytes.buffer);
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
