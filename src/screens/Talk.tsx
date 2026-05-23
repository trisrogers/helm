import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Theme } from '../types';
import { useGateway } from '../context/GatewayContext';
import {
  resolveAudioRates,
  startMicCapture,
  startPlaybackQueue,
  type CaptureHandle,
  type PlaybackHandle,
} from '../lib/talk-audio';

interface Props { theme: Theme; }

const AGENT_NAME: Record<Theme, string> = {
  assay: 'DELTRON',
  politburo: 'UNIT-7',
  blizzard: 'THE VOICE',
};

type Mode = 'auto-detect' | 'push-to-talk';
type LifecycleState = 'idle' | 'creating' | 'live' | 'closing';

interface TalkCatalog {
  modes?: string[];
  transports?: string[];
  brains?: string[];
  speech?: { activeProvider?: string; providers: Array<{ id: string; label: string; configured: boolean }> };
  transcription?: { activeProvider?: string; providers: Array<{ id: string; label: string; configured: boolean }> };
  realtime?: { activeProvider?: string; providers: Array<{ id: string; label: string; configured: boolean }> };
}

interface TalkSessionCreated {
  sessionId: string;
  provider?: string;
  mode: string;
  transport: string;
  brain: string;
  model?: string;
  voice?: string;
  roomId?: string;
  roomUrl?: string;
  expiresAt?: number;
  audio?: unknown;
}

interface TalkEvent {
  id: string;
  type: string;
  sessionId: string;
  turnId?: string;
  seq: number;
  timestamp: string;
  payload?: unknown;
}

/* ── waveform attached to a shared MediaStream ─────────────────── */

function startWaveformOnStream(
  canvas: HTMLCanvasElement | null,
  audioCtx: AudioContext,
  stream: MediaStream,
  setLevel: (v: number) => void,
): () => void {
  if (!canvas) return () => {};
  const src = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.7;
  src.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let rafId = 0;
  let cancelled = false;

  const draw = () => {
    if (cancelled) return;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) {
      const norm = (v - 128) / 128;
      sum += norm * norm;
    }
    setLevel(Math.sqrt(sum / data.length));

    const ratio = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== cssW * ratio || canvas.height !== cssH * ratio) {
      canvas.width = cssW * ratio;
      canvas.height = cssH * ratio;
    }
    const g = canvas.getContext('2d');
    if (g) {
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, cssW, cssH);
      const accent = getComputedStyle(canvas).getPropertyValue('--acc').trim() || '#D4A830';
      g.fillStyle = accent;
      const barCount = 64;
      const step = Math.floor(data.length / barCount);
      const barW = cssW / barCount;
      const mid = cssH / 2;
      for (let i = 0; i < barCount; i++) {
        let acc = 0;
        for (let j = 0; j < step; j++) acc += Math.abs(data[i * step + j] - 128);
        const h = Math.max(2, (acc / step / 128) * (cssH * 0.9));
        const x = i * barW + barW * 0.15;
        g.fillRect(x, mid - h / 2, barW * 0.7, h);
      }
    }
    rafId = requestAnimationFrame(draw);
  };
  rafId = requestAnimationFrame(draw);

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    try { src.disconnect(); analyser.disconnect(); } catch { /* ignore */ }
  };
}

/* ── helpers ──────────────────────────────────────────────────── */

function shortEventLabel(e: TalkEvent): string {
  return e.type.replace(/_/g, '.').replace(/\./g, ' › ');
}

function eventSnippet(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  if (typeof p.text === 'string') return p.text;
  if (typeof p.delta === 'string') return p.delta;
  if (typeof p.transcript === 'string') return p.transcript;
  if (typeof p.message === 'string') return p.message;
  try { return JSON.stringify(p).slice(0, 80); } catch { return ''; }
}

function extractAudioBase64(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.audio === 'string') return p.audio;
  if (typeof p.audioBase64 === 'string') return p.audioBase64;
  if (typeof p.delta === 'string' && /^[A-Za-z0-9+/=]+$/.test(p.delta) && p.delta.length > 32) {
    return p.delta;
  }
  return null;
}

/* ── Talk ─────────────────────────────────────────────────────── */

export default function Talk({ theme }: Props) {
  const { client, status } = useGateway();
  const [mode, setMode] = useState<Mode>('auto-detect');
  const [lifecycle, setLifecycle] = useState<LifecycleState>('idle');
  const [session, setSession] = useState<TalkSessionCreated | null>(null);
  const [events, setEvents] = useState<TalkEvent[]>([]);
  const [catalog, setCatalog] = useState<TalkCatalog | null>(null);
  const [transcript, setTranscript] = useState<{ user?: string; agent?: string }>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pttActive, setPttActive] = useState(false);
  const [micState, setMicState] = useState<'off' | 'requesting' | 'on' | 'denied' | 'error'>('off');
  const [level, setLevel] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureRef = useRef<CaptureHandle | null>(null);
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const waveformCleanupRef = useRef<(() => void) | null>(null);

  // Load catalog/config on connect
  useEffect(() => {
    if (!client || status !== 'connected') return;
    client.call<TalkCatalog>('talk.catalog')
      .then(setCatalog)
      .catch(e => console.warn('[talk] catalog failed', e));
  }, [client, status]);

  // Subscribe to talk.event when in session
  useEffect(() => {
    if (!client || status !== 'connected' || !session) return;
    const off = client.on('talk.event', (payload) => {
      const e = payload as TalkEvent;
      if (!e || typeof e.type !== 'string') return;
      if (e.sessionId && session.sessionId && e.sessionId !== session.sessionId) return;
      setEvents(prev => [...prev.slice(-99), e]);

      // Surface transcript / output text into the visible bubble
      const snippet = eventSnippet(e.payload);
      if (e.type === 'transcript.delta' || e.type === 'transcript.done') {
        setTranscript(prev => ({ ...prev, user: snippet || prev.user }));
      } else if (e.type === 'output.text.delta' || e.type === 'output.text.done') {
        setTranscript(prev => ({ ...prev, agent: snippet || prev.agent }));
      }

      // Pipe model audio into playback queue
      if (e.type === 'output.audio.delta') {
        const b64 = extractAudioBase64(e.payload);
        if (b64) playbackRef.current?.enqueue(b64);
      }
      if (e.type === 'turn.started' || e.type === 'turn.cancelled') {
        // Reset playback alignment when a new turn begins so we don't queue
        // forever behind a stale stream.
        playbackRef.current?.flush();
      }
    });
    return () => off();
  }, [client, status, session]);

  // Tear down audio when leaving "live"
  const teardownAudio = useCallback(() => {
    waveformCleanupRef.current?.();
    waveformCleanupRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    setMicState('off');
    setLevel(0);
  }, []);

  const handleStart = useCallback(async () => {
    if (!client || status !== 'connected' || lifecycle !== 'idle') return;
    setErrorMsg(null);
    setLifecycle('creating');
    setEvents([]);
    setTranscript({});
    let created: TalkSessionCreated;
    try {
      created = await client.call<TalkSessionCreated>('talk.session.create', {
        mode: 'realtime',
      });
      setSession(created);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'session.create failed');
      setLifecycle('idle');
      return;
    }

    // Now start the audio pipeline. Failure here doesn't kill the session —
    // the user still sees events, just without audio in/out.
    const rates = resolveAudioRates(created.audio);
    try {
      setMicState('requesting');
      const handle = await startMicCapture({
        client,
        sessionId: created.sessionId,
        targetSampleRateHz: rates.input,
        initiallyActive: mode === 'auto-detect',
        onError: (err) => console.warn('[talk] appendAudio failed', err),
      });
      captureRef.current = handle;
      playbackRef.current = startPlaybackQueue(rates.output);
      waveformCleanupRef.current = startWaveformOnStream(
        canvasRef.current,
        handle.audioCtx,
        handle.stream,
        setLevel,
      );
      setMicState('on');
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setMicState('denied');
      } else {
        setMicState('error');
      }
      setErrorMsg(err?.message ?? String(e));
    } finally {
      setLifecycle('live');
    }
  }, [client, status, lifecycle, mode]);

  const handleStop = useCallback(async () => {
    if (!session) return;
    setLifecycle('closing');
    teardownAudio();
    try {
      await client?.call('talk.session.close', { sessionId: session.sessionId });
    } catch (e) {
      console.warn('[talk] close failed', e);
    } finally {
      setSession(null);
      setLifecycle('idle');
      setPttActive(false);
    }
  }, [client, session, teardownAudio]);

  // Cleanup audio on unmount
  useEffect(() => () => teardownAudio(), [teardownAudio]);

  // Update capture gating when mode or PTT state changes
  useEffect(() => {
    const cap = captureRef.current;
    if (!cap) return;
    cap.setActive(mode === 'auto-detect' ? true : pttActive);
  }, [mode, pttActive]);

  const handleModeChange = useCallback(async (next: Mode) => {
    setMode(next);
    if (!client || status !== 'connected') return;
    try {
      await client.call('talk.mode', { enabled: next === 'auto-detect', phase: next });
    } catch (e) {
      console.warn('[talk] mode change failed', e);
    }
  }, [client, status]);

  const handlePttStart = () => { if (session) setPttActive(true); };
  const handlePttStop = () => { if (session) setPttActive(false); };

  const statusText = (() => {
    if (status !== 'connected') return 'Disconnected';
    if (lifecycle === 'creating') return 'Creating session…';
    if (lifecycle === 'closing') return 'Closing…';
    if (lifecycle === 'idle') return 'Tap mic to begin';
    if (micState === 'requesting') return 'Asking for mic…';
    if (micState === 'denied') return 'Mic denied — enable in browser settings';
    if (micState === 'error') return 'Mic error';
    if (mode === 'push-to-talk') {
      return pttActive ? 'Streaming…' : 'Push-to-talk ready';
    }
    return level > 0.04 ? 'Listening…' : 'Standing by';
  })();

  const realtimeActive = catalog?.realtime?.activeProvider;
  const realtimeConfigured = catalog?.realtime?.providers?.some(p => p.configured);
  const recentEvents = useMemo(() => events.slice(-6).reverse(), [events]);

  return (
    <div id="screen-talk" className="screen">
      <div className="talk-mode-badge">
        <span className={`dot ${realtimeConfigured ? 'dot-ok' : 'dot-idle'}`} />
        <span>{mode === 'auto-detect' ? 'AUTO-DETECT MODE' : 'PUSH-TO-TALK MODE'}</span>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '9px', padding: '2px 6px' }}
          onClick={() => handleModeChange(mode === 'auto-detect' ? 'push-to-talk' : 'auto-detect')}
        >CHANGE</button>
      </div>

      <div className="talk-agent">{AGENT_NAME[theme]}</div>

      <div style={{ width: 'min(560px, 70vw)', maxWidth: '560px' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '60px', display: 'block' }} />
      </div>

      <div className="talk-status">{statusText}</div>

      {errorMsg && (
        <div style={{ fontSize: '11px', color: 'var(--err)', textAlign: 'center', maxWidth: '440px' }}>
          {errorMsg}
        </div>
      )}

      <div className="talk-transcript">
        {!session && (
          <div className="t-user" style={{ color: 'var(--ink2)' }}>
            {realtimeActive
              ? `Realtime provider configured: ${realtimeActive}.`
              : realtimeConfigured
              ? 'A realtime provider is available — tap the mic to start a session.'
              : 'No realtime provider configured on the gateway.'}
          </div>
        )}
        {transcript.user && (
          <div className="t-user">You: {transcript.user}</div>
        )}
        {transcript.agent && (
          <div className="t-agent" style={{ marginTop: '8px' }}>
            {AGENT_NAME[theme]}: {transcript.agent}
          </div>
        )}
        {session && recentEvents.length > 0 && (
          <div style={{ marginTop: '10px', borderTop: '1px solid var(--brd)', paddingTop: '8px', fontSize: '10px', color: 'var(--ink2)', fontFamily: 'var(--fm)' }}>
            {recentEvents.map(e => (
              <div key={e.id} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--acc)' }}>{shortEventLabel(e)}</span>
                {eventSnippet(e.payload) && <span> · {eventSnippet(e.payload)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="talk-controls">
        <button
          className="btn btn-ghost"
          style={{ padding: '10px 16px' }}
          disabled={!session}
          onClick={() => captureRef.current?.setActive(false)}
          title="Mute mic (stops uploading audio)"
        >🔇</button>

        <button
          className="mic-btn"
          style={{
            transform: pttActive || level > 0.05 ? 'scale(1.06)' : undefined,
            boxShadow: pttActive ? '0 0 24px var(--acc)' : undefined,
          }}
          onClick={() => {
            if (lifecycle === 'idle') handleStart();
            else if (lifecycle === 'live' && mode === 'auto-detect') handleStop();
          }}
          onMouseDown={() => { if (lifecycle === 'live' && mode === 'push-to-talk') handlePttStart(); }}
          onMouseUp={() => { if (lifecycle === 'live' && mode === 'push-to-talk') handlePttStop(); }}
          onMouseLeave={() => { if (pttActive) handlePttStop(); }}
          disabled={lifecycle === 'creating' || lifecycle === 'closing'}
        >🎙</button>

        <button
          className="btn btn-ghost"
          style={{ padding: '10px 16px', color: 'var(--err)', borderColor: 'var(--err)' }}
          onClick={handleStop}
          disabled={!session}
        >End</button>
      </div>

      {session && (
        <div style={{ position: 'absolute', bottom: '12px', left: '12px', fontSize: '10px', color: 'var(--ink2)', fontFamily: 'var(--fm)' }}>
          session: {session.sessionId} · {session.provider ?? '—'} · {session.transport}
        </div>
      )}
    </div>
  );
}
