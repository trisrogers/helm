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
  const { connect, disconnect, status, messages, micFft, isMuted, mute, unmute, error } = useVoice();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const toolSeq = useRef(0);

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
    return new OpenclawVoiceBridge(client, agentId, {
      onTool: (e) => setTools((prev) => [{ id: ++toolSeq.current, ...e }, ...prev].slice(0, 12)),
    });
  }, [client, agentId]);
  useEffect(() => {
    bridgeRef.current = bridge?.onToolCall ?? null;
    return () => { bridge?.dispose(); };
  }, [bridge, bridgeRef]);

  const connected = status.value === 'connected';

  const start = useCallback(async () => {
    if (!configId) return;
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
  }, [configId, connect]);

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
    if (connecting) return 'Connecting…';
    if (connected) return isMuted ? 'Muted' : (level > 0.04 ? 'Listening…' : 'Live');
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
          disabled={gw !== 'connected' || !configId || connecting}
          onClick={() => (connected ? disconnect() : start())}
        >🎙</button>

        <button
          className="btn btn-ghost"
          style={{ padding: '10px 16px', color: 'var(--err)', borderColor: 'var(--err)' }}
          disabled={!connected}
          onClick={() => disconnect()}
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
    <VoiceProvider onToolCall={onToolCall}>
      <Inner theme={theme} mode={mode} onModeChange={onModeChange} bridgeRef={bridgeRef} />
    </VoiceProvider>
  );
}
