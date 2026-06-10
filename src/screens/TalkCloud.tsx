import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VoiceProvider, useVoice, type ToolCallHandler } from '@humeai/voice-react';
import { type Theme } from '../types';
import { useGateway } from '../context/GatewayContext';
import {
  EVI_CONFIG_BY_THEME,
  OpenclawVoiceBridge,
  resolveHumeAuth,
  type TalkMode,
} from '../lib/talk-evi';
import { TalkModeToggle } from './TalkModeToggle';

interface Props {
  theme: Theme;
  mode: TalkMode;
  onModeChange: (m: TalkMode) => void;
}

const AGENT_NAME: Record<Theme, string> = {
  assay: 'DELTRON',
  politburo: 'UNIT-7',
  blizzard: 'THE VOICE',
};

interface ToolEntry { id: number; name: string; ok: boolean; ms: number; detail: string }

/* ── inner: lives inside VoiceProvider, owns the gateway client + bridge ── */

function Inner({ theme, mode, onModeChange, bridgeRef }: Props & {
  bridgeRef: React.MutableRefObject<ToolCallHandler | null>;
}) {
  const { client, status: gw } = useGateway();
  const { connect, disconnect, status, messages, micFft, isMuted, mute, unmute, error, sendAssistantInput } = useVoice();
  // Latest sendAssistantInput, so the (memoized) bridge can stream the agent's
  // reply into EVI's voice without being rebuilt each render. Synced in an
  // effect (post-commit) — onSpeak only reads it from a bridge callback.
  const speakRef = useRef(sendAssistantInput);
  useEffect(() => { speakRef.current = sendAssistantInput; });
  const [agentId, setAgentId] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const toolSeq = useRef(0);

  // Stable callbacks the bridge holds; both read refs at call time, not render,
  // so the bridge isn't rebuilt when sendAssistantInput changes each render.
  const speak = useCallback((text: string) => { speakRef.current?.(text); }, []);
  const pushTool = useCallback((e: Omit<ToolEntry, 'id'>) => {
    setTools((prev) => [{ id: ++toolSeq.current, ...e }, ...prev].slice(0, 12));
  }, []);

  const configId = EVI_CONFIG_BY_THEME[theme];
  const agentName = AGENT_NAME[theme];

  // Resolve an agent for the ask_openclaw passthrough (same as the local pipeline).
  useEffect(() => {
    if (!client || gw !== 'connected' || agentId) return;
    client.call<{ agents?: Array<{ id: string }> }>('agents.list')
      .then((res) => { const id = res?.agents?.[0]?.id; if (id) setAgentId(id); })
      .catch((e) => console.warn('[talk-cloud] agents.list failed', e));
  }, [client, gw, agentId]);

  // One bridge per (client, agent). Publish its handler to the ref VoiceProvider reads.
  const bridge = useMemo(() => {
    if (!client || !agentId) return null;
    // speak/pushTool are stable callbacks that read refs only at call time; the
    // rule flags them escaping into the long-lived bridge, but reading at call
    // time is the point — it keeps the bridge from rebuilding each render.
    // eslint-disable-next-line react-hooks/refs
    return new OpenclawVoiceBridge(client, agentId, {
      onTool: pushTool,
      onSpeak: speak,
    });
  }, [client, agentId, speak, pushTool]);
  useEffect(() => {
    bridgeRef.current = bridge?.onToolCall ?? null;
    return () => { bridge?.dispose(); };
  }, [bridge, bridgeRef]);

  const connected = status.value === 'connected';
  const busy = connecting || status.value === 'connecting';

  // "Mic stays on" intent + reconnect bookkeeping. wantOn = the user tapped the
  // mic and hasn't pressed End, so an inactivity/transport drop should silently
  // reconnect rather than going dark. State (not a ref) because the status text
  // and buttons render from it; wantOnRef mirrors it for timer callbacks and the
  // unmount path. retries backs off; the timer is the pending reconnect. EVI
  // doesn't greet on connect, so reconnects are seamless.
  const [wantOn, setWantOn] = useState(false);
  const wantOnRef = useRef(wantOn);
  useEffect(() => { wantOnRef.current = wantOn; });
  const [gaveUp, setGaveUp] = useState(false);
  const retries = useRef(0);
  const reTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(async () => {
    if (!configId || connected || status.value === 'connecting') return;
    setWantOn(true);
    setGaveUp(false);
    setAuthError(null);
    setConnecting(true);
    try {
      const auth = await resolveHumeAuth();
      await connect({ auth, configId });
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [configId, connected, status.value, connect]);
  // Latest-ref so the reconnect timer always calls the current start without the
  // reconnect effect depending on start's identity (which changes every status
  // transition because voice-react's connect does).
  const startRef = useRef(start);
  useEffect(() => { startRef.current = start; });

  // Explicit stop (End / mic toggle-off / unmount): clear intent + pending retry.
  const stop = useCallback(() => {
    setWantOn(false);
    if (reTimer.current) { clearTimeout(reTimer.current); reTimer.current = null; }
    disconnect();
  }, [disconnect]);

  // Auto-reconnect: when EVI drops while the user still wants the mic on, retry
  // with backoff (cap 6 attempts ≈ a couple minutes) instead of forcing a re-tap.
  useEffect(() => {
    if (status.value === 'connected') { retries.current = 0; return; }
    if ((status.value === 'disconnected' || status.value === 'error')
        && wantOn && reTimer.current == null) {
      if (retries.current >= 6) { setWantOn(false); setGaveUp(true); return; }
      const delay = Math.min(500 * 2 ** retries.current, 8000);
      retries.current += 1;
      reTimer.current = setTimeout(() => { reTimer.current = null; if (wantOnRef.current) startRef.current(); }, delay);
    }
  }, [status.value, wantOn]);
  useEffect(() => () => { if (reTimer.current) clearTimeout(reTimer.current); }, []);

  // Ensure the EVI socket is closed if this screen unmounts mid-call (e.g. nav
  // away, or the theme-keyed remount on a theme switch). Use a latest-ref so this
  // fires ONLY on unmount — depending on [disconnect] would re-run every render
  // (voice-react returns a fresh disconnect each time) and spin into a loop.
  const disconnectRef = useRef(disconnect);
  useEffect(() => { disconnectRef.current = disconnect; });
  useEffect(() => () => { wantOnRef.current = false; disconnectRef.current().catch(() => {}); }, []);

  const transcript = useMemo(
    () => messages.filter(
      (m): m is Extract<typeof m, { type: 'user_message' | 'assistant_message' }> =>
        m.type === 'user_message' || m.type === 'assistant_message',
    ),
    [messages],
  );

  const level = micFft.length
    ? Math.min(1, micFft.reduce((a, b) => a + b, 0) / micFft.length / 40)
    : 0;

  const statusText = (() => {
    if (gw !== 'connected') return 'Gateway disconnected';
    if (!configId) return 'No EVI config for this theme';
    if (busy) return wantOn ? 'Reconnecting…' : 'Connecting…';
    if (connected) return isMuted ? 'Muted' : (level > 0.04 ? 'Listening…' : 'Live');
    if (wantOn) return 'Reconnecting…';
    if (gaveUp) return 'Reconnect failed — tap the mic to retry';
    return 'Tap to begin';
  })();

  return (
    <div id="screen-talk" className="screen">
      <div className="talk-mode-badge">
        <span className={`dot ${connected ? 'dot-ok' : 'dot-idle'}`} />
        <span>CLOUD · EVI</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{agentName}</span>
        <TalkModeToggle mode={mode} onChange={onModeChange} />
      </div>

      <div className="talk-agent">{agentName}</div>

      <div style={{ width: 'min(560px, 70vw)', height: '60px', display: 'flex', alignItems: 'center', gap: '3px' }}>
        {Array.from({ length: 48 }).map((_, i) => {
          const v = micFft[i % Math.max(1, micFft.length)] ?? 0;
          const h = connected ? Math.max(2, Math.min(54, v * 1.4)) : 2;
          return <div key={i} style={{ flex: 1, height: `${h}px`, background: 'var(--acc)', opacity: connected ? 0.85 : 0.25, borderRadius: '1px', transition: 'height 80ms' }} />;
        })}
      </div>

      <div className="talk-status">{statusText}</div>

      {(authError || error) && (
        <div style={{ fontSize: '11px', color: 'var(--err)', textAlign: 'center', maxWidth: '440px' }}>
          {authError ?? error?.message}
        </div>
      )}

      {!configId && (
        <div style={{ fontSize: '11px', color: 'var(--ink2)', textAlign: 'center', maxWidth: '440px' }}>
          Run <code>node scripts/setup-evi-configs.mjs</code> and set
          <code> VITE_HUME_CONFIG_{theme.toUpperCase()}</code> in <code>.env.local</code>.
        </div>
      )}

      <div className="talk-transcript">
        {transcript.length === 0 && (
          <div className="t-user" style={{ color: 'var(--ink2)' }}>
            Native speech-to-speech via Hume EVI. {agentName} can read live status directly
            and delegate everything else to the OpenClaw agent. Tap the mic and speak.
          </div>
        )}
        {transcript.map((m, i) => (
          <div key={i} className={m.type === 'user_message' ? 't-user' : 't-agent'} style={i ? { marginTop: '6px' } : undefined}>
            {m.type === 'user_message' ? 'You' : agentName}: {m.message.content}
          </div>
        ))}
        {tools.length > 0 && (
          <div style={{ marginTop: '10px', borderTop: '1px solid var(--brd)', paddingTop: '8px', fontSize: '10px', color: 'var(--ink2)', fontFamily: 'var(--fm)' }}>
            {tools.map((t) => (
              <div key={t.id} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: t.ok ? 'var(--acc)' : 'var(--err)' }}>{t.ok ? '✓' : '✗'} {t.name}</span>
                <span> · {t.ms}ms · {t.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="talk-controls">
        <button
          className="btn btn-ghost"
          style={{ padding: '10px 16px' }}
          disabled={!connected}
          onClick={() => (isMuted ? unmute() : mute())}
          title="Mute mic"
        >{isMuted ? '🔇' : '🎙'}</button>

        <button
          className="mic-btn"
          style={{ transform: level > 0.05 ? 'scale(1.06)' : undefined, boxShadow: connected ? '0 0 24px var(--acc)' : undefined }}
          disabled={gw !== 'connected' || !configId || (busy && !wantOn)}
          onClick={() => { if (connected || wantOn) { stop(); } else { retries.current = 0; start(); } }}
        >🎙</button>

        <button
          className="btn btn-ghost"
          style={{ padding: '10px 16px', color: 'var(--err)', borderColor: 'var(--err)' }}
          disabled={!connected && !wantOn}
          onClick={() => stop()}
        >End</button>
      </div>
    </div>
  );
}

/* ── outer: provides the EVI socket; delegates tool calls to the live bridge ── */

export default function TalkCloud({ theme, mode, onModeChange }: Props) {
  const bridgeRef = useRef<ToolCallHandler | null>(null);
  const onToolCall = useCallback<ToolCallHandler>((msg, send) => {
    if (bridgeRef.current) return bridgeRef.current(msg, send);
    return Promise.resolve(
      send.error({ error: 'bridge not ready', code: 'not_ready', level: 'warn', content: 'one moment' }),
    );
  }, []);

  return (
    <VoiceProvider
      onToolCall={onToolCall}
      onError={(e) => console.error('[evi] error:', e.message)}
    >
      <Inner theme={theme} mode={mode} onModeChange={onModeChange} bridgeRef={bridgeRef} />
    </VoiceProvider>
  );
}
