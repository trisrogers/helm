import { useCallback, useMemo, useRef, useState } from 'react';
import { VoiceProvider, useVoice, type ToolCallHandler } from '@humeai/voice-react';
import { GatewayProvider, useGateway } from '../../src/context/GatewayContext';
import type { OpenClawClient } from '../../src/lib/openclaw-client';

/**
 * Hume EVI spike — tests the "all-in-one" path: one session that is
 *   (1) integrated with openclaw (tool calls bridged to the live gateway),
 *   (2) fluid (native-ish S2S, barge-in), and
 *   (3) themed (persona prompt + Hume voice set in the EVI config).
 *
 * Throwaway. Lives outside src/ so it can be deleted in one `rm -rf spikes/hume-evi`.
 */

const API_KEY = import.meta.env.VITE_HUME_API_KEY as string | undefined;
const CONFIG_ID = import.meta.env.VITE_HUME_CONFIG_ID as string | undefined;

// Bridge registry: EVI tool name → openclaw RPC. Keep names in sync with setup.mjs.
const BRIDGE: Record<string, (c: OpenClawClient, args: Record<string, unknown>) => Promise<unknown>> = {
  get_camp_status: (c) => c.call('channels.status'),
  list_sessions: (c) => c.call('sessions.list'),
};

interface ToolLog {
  id: string;
  name: string;
  args: string;
  result?: string;
  error?: string;
  ms?: number;
}

// Shared ref so VoiceProvider (which must mount above the gateway-aware Console to
// own the socket) can delegate tool calls down to the live-client handler.
const bridgeHandlerRef: { current: ToolCallHandler | null } = { current: null };

function Console() {
  const { client, status: gw, token, setToken } = useGateway();
  const [tokenDraft, setTokenDraft] = useState(token);
  const {
    connect, disconnect, status, messages, micFft, isMuted, mute, unmute, error,
  } = useVoice();
  const [tools, setTools] = useState<ToolLog[]>([]);
  const clientRef = useRef(client);
  clientRef.current = client;

  const onToolCall = useCallback<ToolCallHandler>(async (msg, send) => {
    const c = clientRef.current;
    const started = performance.now();
    const fn = BRIDGE[msg.name];
    let args: Record<string, unknown> = {};
    try { args = msg.parameters ? JSON.parse(msg.parameters) : {}; } catch { /* ignore */ }
    const entry: ToolLog = { id: msg.toolCallId, name: msg.name, args: msg.parameters || '{}' };
    setTools((prev) => [entry, ...prev].slice(0, 12));

    if (!fn || !c) {
      const error = !c ? 'openclaw gateway not connected' : `no bridge for "${msg.name}"`;
      setTools((prev) => prev.map((t) => t.id === entry.id ? { ...t, error } : t));
      return send.error({ error, code: 'bridge_error', level: 'warn', content: error });
    }
    try {
      const result = await fn(c, args);
      const ms = Math.round(performance.now() - started);
      const content = JSON.stringify(result);
      setTools((prev) => prev.map((t) => t.id === entry.id ? { ...t, result: content.slice(0, 400), ms } : t));
      return send.success(content);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const ms = Math.round(performance.now() - started);
      setTools((prev) => prev.map((t) => t.id === entry.id ? { ...t, error, ms } : t));
      return send.error({ error, code: 'rpc_error', level: 'warn', content: error });
    }
  }, []);

  // Hand the handler up to VoiceProvider via the shared ref.
  bridgeHandlerRef.current = onToolCall;

  const transcript = useMemo(() => messages.filter(
    (m): m is Extract<typeof m, { type: 'user_message' | 'assistant_message' }> =>
      m.type === 'user_message' || m.type === 'assistant_message',
  ), [messages]);

  const connected = status.value === 'connected';
  const connecting = status.value === 'connecting';

  const startEvi = useCallback(async () => {
    try {
      await connect({ auth: { type: 'apiKey', value: API_KEY! }, configId: CONFIG_ID });
    } catch (e) {
      console.error('[spike] EVI connect failed', e);
    }
  }, [connect]);
  const level = micFft.length ? Math.min(1, micFft.reduce((a, b) => a + b, 0) / micFft.length / 40) : 0;

  return (
    <div style={S.page}>
      <header style={S.header}>
        <div>
          <div style={S.kicker}>HUME EVI · ALL-IN-ONE SPIKE</div>
          <h1 style={S.h1}>Fluid + Themed + openclaw, one session</h1>
        </div>
        <div style={S.badges}>
          <Badge ok={gw === 'connected'} label={`gateway: ${gw}`} />
          <Badge ok={connected} label={`evi: ${status.value}`} />
        </div>
      </header>

      {gw !== 'connected' && (
        <div style={S.warn}>
          Gateway <b>{gw}</b>. This spike runs on its own origin (:5273), so paste your
          <code> helm:token</code> here (it won't inherit from the main app):
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              style={S.input}
              type="password"
              placeholder="helm:token"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
            />
            <button style={S.btn} onClick={() => setToken(tokenDraft.trim())}>Connect</button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ ...S.warn, background: '#3a1f1f', borderColor: '#7f3f3f' }}>
          <b>EVI error</b> ({error.type}{'reason' in error && error.reason ? ` · ${error.reason}` : ''}): {error.message}
        </div>
      )}

      {(!API_KEY || !CONFIG_ID) && (
        <div style={S.warn}>
          Missing <code>VITE_HUME_API_KEY</code> / <code>VITE_HUME_CONFIG_ID</code>.
          Run <code>node spikes/hume-evi/setup.mjs</code>, then add both to repo-root <code>.env.local</code>.
        </div>
      )}

      <div style={S.controls}>
        {!connected ? (
          <button
            style={{ ...S.btn, ...S.btnPrimary }}
            disabled={!API_KEY || !CONFIG_ID || connecting}
            onClick={startEvi}
          >{connecting ? '… connecting' : '▶ Start talking'}</button>
        ) : (
          <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => disconnect()}>■ End</button>
        )}
        <button style={S.btn} disabled={!connected} onClick={() => (isMuted ? unmute() : mute())}>
          {isMuted ? '🔇 unmute' : '🎙 mute'}
        </button>
        <div style={S.meter}><div style={{ ...S.meterFill, width: `${level * 100}%` }} /></div>
      </div>

      <div style={S.cols}>
        <section style={S.col}>
          <h2 style={S.h2}>Conversation</h2>
          <div style={S.scroll}>
            {transcript.length === 0 && <p style={S.dim}>Say hello once connected…</p>}
            {transcript.map((m, i) => (
              <div key={i} style={m.type === 'user_message' ? S.you : S.agent}>
                <b>{m.type === 'user_message' ? 'You' : 'EVI'}:</b> {m.message.content}
              </div>
            ))}
          </div>
        </section>

        <section style={S.col}>
          <h2 style={S.h2}>openclaw tool calls <span style={S.dim}>(the integration test)</span></h2>
          <div style={S.scroll}>
            {tools.length === 0 && <p style={S.dim}>Ask "what's the camp status?" or "list the sessions".</p>}
            {tools.map((t) => (
              <div key={t.id} style={S.tool}>
                <div><span style={S.toolName}>{t.name}</span>{t.ms != null && <span style={S.dim}> · {t.ms}ms</span>}</div>
                <div style={S.code}>args: {t.args}</div>
                {t.result && <div style={{ ...S.code, color: '#7fdca4' }}>→ {t.result}{t.result.length >= 400 ? '…' : ''}</div>}
                {t.error && <div style={{ ...S.code, color: '#ff8a8a' }}>✗ {t.error}</div>}
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer style={S.footer}>
        <b>Judge:</b> (1) does it feel <i>fluid</i> vs the current pipeline? (2) is the
        themed voice/persona <i>demo-worthy</i>? (3) do tool calls hit the live gateway
        and come back fast? If all three land, Daily + Demo collapse into one mode.
      </footer>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ ...S.badge, borderColor: ok ? '#2f6f4f' : '#5a3a3a', color: ok ? '#7fdca4' : '#ff8a8a' }}>
      <span style={{ ...S.dot, background: ok ? '#7fdca4' : '#ff8a8a' }} />{label}
    </span>
  );
}

export default function SpikeEvi() {
  return (
    <GatewayProvider>
      <VoiceProvider onToolCall={(msg, send) => bridgeHandlerRef.current!(msg, send)}>
        <Console />
      </VoiceProvider>
    </GatewayProvider>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1100, margin: '0 auto', padding: 24, fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#e7e7ea' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20 },
  kicker: { fontSize: 11, letterSpacing: 2, color: '#8a8a92', fontFamily: 'ui-monospace, monospace' },
  h1: { fontSize: 22, margin: '4px 0 0' },
  h2: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: '#b8b8c0', margin: '0 0 8px' },
  badges: { display: 'flex', gap: 8, flexShrink: 0 },
  badge: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'ui-monospace, monospace', border: '1px solid', borderRadius: 999, padding: '4px 10px' },
  dot: { width: 7, height: 7, borderRadius: 999, display: 'inline-block' },
  warn: { background: '#3a2f1a', border: '1px solid #6b5320', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 },
  input: { flex: 1, background: '#101014', color: '#e7e7ea', border: '1px solid #3a3a44', borderRadius: 6, padding: '8px 10px', fontFamily: 'ui-monospace, monospace', fontSize: 12 },
  controls: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  btn: { background: '#26262c', color: '#e7e7ea', border: '1px solid #3a3a44', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer' },
  btnPrimary: { background: '#2f6f4f', borderColor: '#3f8f63' },
  btnDanger: { background: '#5a2f2f', borderColor: '#7f3f3f' },
  meter: { flex: 1, height: 8, background: '#26262c', borderRadius: 999, overflow: 'hidden' },
  meterFill: { height: '100%', background: 'linear-gradient(90deg,#3f8f63,#7fdca4)', transition: 'width 80ms' },
  cols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  col: { background: '#1a1a1f', border: '1px solid #2a2a32', borderRadius: 10, padding: 16, minHeight: 280 },
  scroll: { maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
  you: { fontSize: 14, lineHeight: 1.4 },
  agent: { fontSize: 14, lineHeight: 1.4, color: '#bfe0cf' },
  tool: { background: '#101014', border: '1px solid #2a2a32', borderRadius: 8, padding: '8px 10px' },
  toolName: { fontFamily: 'ui-monospace, monospace', color: '#9fb8ff', fontSize: 13 },
  code: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#a8a8b2', marginTop: 4, wordBreak: 'break-all' },
  dim: { color: '#6a6a72', fontSize: 12 },
  footer: { marginTop: 20, padding: '12px 16px', background: '#1a1a1f', border: '1px solid #2a2a32', borderRadius: 10, fontSize: 13, lineHeight: 1.5, color: '#b8b8c0' },
};
