import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Theme } from '../types';
import { useGateway } from '../context/GatewayContext';

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

/* ── waveform via Web Audio + canvas ──────────────────────────── */

function useMicWaveform(active: boolean): {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  micState: 'off' | 'requesting' | 'on' | 'denied' | 'error';
  level: number;
  errorMsg: string | null;
} {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [micState, setMicState] = useState<'off' | 'requesting' | 'on' | 'denied' | 'error'>('off');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) { setMicState('off'); return; }

    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let rafId = 0;
    let cancelled = false;

    setMicState('requesting');
    setErrorMsg(null);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctor();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.7;
        src.connect(analyser);
        setMicState('on');

        const data = new Uint8Array(analyser.frequencyBinCount);
        const draw = () => {
          if (cancelled || !analyser) return;
          analyser.getByteTimeDomainData(data);

          // Compute RMS for level
          let sum = 0;
          for (const v of data) {
            const norm = (v - 128) / 128;
            sum += norm * norm;
          }
          const rms = Math.sqrt(sum / data.length);
          setLevel(rms);

          const canvas = canvasRef.current;
          if (canvas) {
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

              // Read CSS accent so the waveform shifts with the theme
              const accent = getComputedStyle(canvas).getPropertyValue('--acc').trim() || '#D4A830';
              g.strokeStyle = accent;
              g.fillStyle = accent;

              // Draw bars
              const barCount = 64;
              const step = Math.floor(data.length / barCount);
              const barW = cssW / barCount;
              const mid = cssH / 2;
              for (let i = 0; i < barCount; i++) {
                let acc = 0;
                for (let j = 0; j < step; j++) {
                  acc += Math.abs(data[i * step + j] - 128);
                }
                const avg = acc / step;
                const h = Math.max(2, (avg / 128) * (cssH * 0.9));
                const x = i * barW + barW * 0.15;
                g.fillRect(x, mid - h / 2, barW * 0.7, h);
              }
            }
          }
          rafId = requestAnimationFrame(draw);
        };
        rafId = requestAnimationFrame(draw);
      } catch (e) {
        if (cancelled) return;
        const err = e as DOMException;
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          setMicState('denied');
          setErrorMsg('Mic permission denied');
        } else {
          setMicState('error');
          setErrorMsg(err?.message ?? String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close().catch(() => {});
      setLevel(0);
    };
  }, [active]);

  return { canvasRef, micState, level, errorMsg };
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

  const micActive = lifecycle === 'live';
  const { canvasRef, micState, level, errorMsg: micError } = useMicWaveform(micActive);

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
    });
    return () => off();
  }, [client, status, session]);

  const handleStart = useCallback(async () => {
    if (!client || status !== 'connected' || lifecycle !== 'idle') return;
    setErrorMsg(null);
    setLifecycle('creating');
    setEvents([]);
    setTranscript({});
    try {
      const created = await client.call<TalkSessionCreated>('talk.session.create', {
        mode: 'realtime',
      });
      setSession(created);
      setLifecycle('live');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'session.create failed');
      setLifecycle('idle');
    }
  }, [client, status, lifecycle]);

  const handleStop = useCallback(async () => {
    if (!client || !session) return;
    setLifecycle('closing');
    try {
      await client.call('talk.session.close', { sessionId: session.sessionId });
    } catch (e) {
      console.warn('[talk] close failed', e);
    } finally {
      setSession(null);
      setLifecycle('idle');
      setPttActive(false);
    }
  }, [client, session]);

  const handleModeChange = useCallback(async (next: Mode) => {
    setMode(next);
    if (!client || status !== 'connected') return;
    try {
      await client.call('talk.mode', { enabled: next === 'auto-detect', phase: next });
    } catch (e) {
      console.warn('[talk] mode change failed', e);
    }
  }, [client, status]);

  const handlePttStart = async () => {
    if (!client || !session) return;
    setPttActive(true);
    try { await client.call('talk.ptt.start', {}); } catch (e) { console.warn('[talk] ptt.start', e); }
  };
  const handlePttStop = async () => {
    if (!client || !session) return;
    setPttActive(false);
    try { await client.call('talk.ptt.stop', {}); } catch (e) { console.warn('[talk] ptt.stop', e); }
  };

  const statusText = (() => {
    if (status !== 'connected') return 'Disconnected';
    if (lifecycle === 'creating') return 'Creating session…';
    if (lifecycle === 'closing') return 'Closing…';
    if (lifecycle === 'idle') return 'Tap mic to begin';
    if (micState === 'requesting') return 'Asking for mic…';
    if (micState === 'denied') return 'Mic denied';
    if (micState === 'error') return 'Mic error';
    if (mode === 'push-to-talk') return pttActive ? 'Listening…' : 'Push-to-talk ready';
    if (level > 0.04) return 'Listening…';
    return 'Standing by';
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
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '60px', display: 'block' }}
        />
      </div>

      <div className="talk-status">{statusText}</div>

      {(errorMsg || micError) && (
        <div style={{ fontSize: '11px', color: 'var(--err)', textAlign: 'center', maxWidth: '440px' }}>
          {errorMsg ?? micError}
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
          title="Mute (not yet wired)"
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
