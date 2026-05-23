/**
 * Talk audio pipe — captures the user's mic, downsamples to PCM16 at the
 * provider's target rate, base64-encodes 100 ms frames, and ships them
 * via talk.session.appendAudio. A parallel queue receives output.audio
 * deltas from the gateway and schedules contiguous playback.
 */
import { OpenClawClient } from './openclaw-client';

export interface AudioFormatHint {
  inputSampleRateHz?: number;
  outputSampleRateHz?: number;
}

const DEFAULT_INPUT_RATE = 16_000;
const DEFAULT_OUTPUT_RATE = 24_000;
const FRAME_MS = 100; // 100 ms frames keep latency low without flooding the WS

/** Coerce talk.session.create audio metadata into the rates we need. */
export function resolveAudioRates(raw: unknown): { input: number; output: number } {
  let input = DEFAULT_INPUT_RATE;
  let output = DEFAULT_OUTPUT_RATE;
  if (raw && typeof raw === 'object') {
    const a = raw as AudioFormatHint;
    if (typeof a.inputSampleRateHz === 'number' && a.inputSampleRateHz > 0) input = a.inputSampleRateHz;
    if (typeof a.outputSampleRateHz === 'number' && a.outputSampleRateHz > 0) output = a.outputSampleRateHz;
  }
  return { input, output };
}

/** Resample mono Float32 audio from sourceRate to targetRate (linear). */
function resampleFloat32(src: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return src;
  const ratio = sourceRate / targetRate;
  const outLen = Math.floor(src.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const t = i * ratio;
    const i0 = Math.floor(t);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const frac = t - i0;
    out[i] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}

function float32ToPCM16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // chunk to avoid call-stack issues for large frames
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
}

function pcm16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

/* ── capture ──────────────────────────────────────────────── */

export interface CaptureHandle {
  /** Toggle whether captured frames are uploaded (PTT gating). True = stream. */
  setActive: (on: boolean) => void;
  /** Stop the mic and release the audio context. */
  stop: () => void;
  /** Underlying mic stream — handy for sharing with a waveform analyser. */
  stream: MediaStream;
  /** AudioContext used by the capture pipeline. */
  audioCtx: AudioContext;
}

/**
 * Start mic capture and pipe PCM16 frames to talk.session.appendAudio.
 * Throws if mic permission is denied.
 */
export async function startMicCapture(opts: {
  client: OpenClawClient;
  sessionId: string;
  targetSampleRateHz: number;
  initiallyActive?: boolean;
  onError?: (err: Error) => void;
}): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new Ctor();
  const sourceRate = audioCtx.sampleRate;
  const src = audioCtx.createMediaStreamSource(stream);

  // ScriptProcessorNode is deprecated but ubiquitous and avoids a separate
  // worklet file. 4096 samples ≈ 85 ms at 48 kHz — close to our frame size.
  const node = audioCtx.createScriptProcessor(4096, 1, 1);
  let active = opts.initiallyActive ?? true;
  const pending: Float32Array[] = [];
  let pendingLen = 0;
  const targetSamplesPerFrame = Math.round((opts.targetSampleRateHz * FRAME_MS) / 1000);
  const sourceSamplesPerFrame = Math.round(targetSamplesPerFrame * (sourceRate / opts.targetSampleRateHz));

  node.onaudioprocess = (e) => {
    if (!active) return;
    const ch = e.inputBuffer.getChannelData(0);
    // Copy because the ArrayBuffer is reused
    pending.push(new Float32Array(ch));
    pendingLen += ch.length;

    while (pendingLen >= sourceSamplesPerFrame) {
      // Coalesce one source-rate frame
      const frame = new Float32Array(sourceSamplesPerFrame);
      let off = 0;
      while (off < sourceSamplesPerFrame && pending.length > 0) {
        const head = pending[0];
        const need = sourceSamplesPerFrame - off;
        if (head.length <= need) {
          frame.set(head, off);
          off += head.length;
          pending.shift();
        } else {
          frame.set(head.subarray(0, need), off);
          pending[0] = head.subarray(need);
          off += need;
        }
      }
      pendingLen -= sourceSamplesPerFrame;

      const resampled = resampleFloat32(frame, sourceRate, opts.targetSampleRateHz);
      const pcm = float32ToPCM16(resampled);
      const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      const b64 = bytesToBase64(bytes);
      opts.client.call('talk.session.appendAudio', {
        sessionId: opts.sessionId,
        audioBase64: b64,
      }).catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        opts.onError?.(error);
      });
    }
  };

  src.connect(node);
  node.connect(audioCtx.destination); // ScriptProcessor only fires if connected; gain=0 avoids feedback
  const muteGain = audioCtx.createGain();
  muteGain.gain.value = 0;
  // Reroute node output to the mute gain instead of speakers
  node.disconnect(audioCtx.destination);
  node.connect(muteGain);
  muteGain.connect(audioCtx.destination);

  return {
    setActive: (on) => { active = on; },
    stop: () => {
      try { node.disconnect(); } catch { /* ignore */ }
      try { src.disconnect(); } catch { /* ignore */ }
      try { muteGain.disconnect(); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
      audioCtx.close().catch(() => {});
    },
    stream,
    audioCtx,
  };
}

/* ── playback ─────────────────────────────────────────────── */

export interface PlaybackHandle {
  enqueue: (base64: string) => void;
  flush: () => void;
  stop: () => void;
}

/**
 * Maintains a contiguous playback queue for output.audio.delta frames.
 * Each enqueue schedules a buffer at the tail of the queue so the audio
 * plays back without gaps.
 */
export function startPlaybackQueue(outputSampleRateHz: number): PlaybackHandle {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor({ sampleRate: outputSampleRateHz });
  let nextStart = ctx.currentTime;

  return {
    enqueue: (b64: string) => {
      try {
        const pcm = base64ToInt16(b64);
        if (pcm.length === 0) return;
        const float = pcm16ToFloat32(pcm);
        const buf = ctx.createBuffer(1, float.length, outputSampleRateHz);
        buf.getChannelData(0).set(float);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        const startAt = Math.max(ctx.currentTime, nextStart);
        src.start(startAt);
        nextStart = startAt + buf.duration;
      } catch { /* ignore malformed deltas */ }
    },
    flush: () => {
      nextStart = ctx.currentTime;
    },
    stop: () => {
      ctx.close().catch(() => {});
    },
  };
}
