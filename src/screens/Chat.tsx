import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Theme } from '../types';
import { useGateway } from '../context/GatewayContext';

interface SessionMessageEvent {
  sessionKey?: string;
  message?: RawMessage;
  messageId?: string;
  messageSeq?: number;
}

interface ChatProps {
  theme: Theme;
}

interface SessionRow {
  key: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  model?: string;
  lastMessagePreview?: string;
  displayName?: string;
  derivedTitle?: string;
  updatedAt?: number | null;
  totalTokens?: number;
  contextTokens?: number;
  estimatedCostUsd?: number;
  channel?: string;
  lastChannel?: string;
  agentRuntime?: { agentId?: string };
  kind?: string;
  hasActiveRun?: boolean;
  thinkingLevel?: string;
}

interface AgentRow {
  id: string;
  name?: string;
  identity?: { name?: string; emoji?: string };
}

interface RawMessage {
  role?: string;
  content?: unknown;
  text?: string;
  timestamp?: string | number;
  _openclaw?: { id?: string; seq?: number };
}

interface DisplayMsg {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  ts?: number;
  streaming?: boolean;
  /** Run id this message is associated with, used to swap a streaming
   *  placeholder for the final projected message when chat.final arrives. */
  runId?: string;
}

interface AgentEvent {
  runId?: string;
  sessionKey?: string;
  stream?: 'assistant' | 'lifecycle' | 'tool' | 'thinking' | string;
  data?: {
    text?: string;
    delta?: string;
    phase?: 'start' | 'end' | string;
    startedAt?: number;
    endedAt?: number;
  };
}

interface ChatStreamEvent {
  runId?: string;
  sessionKey?: string;
  seq?: number;
  state?: 'delta' | 'final';
  deltaText?: string;
  message?: RawMessage;
  messageId?: string;
}

/* ── helpers ──────────────────────────────────────────────────── */

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') { parts.push(block); continue; }
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (typeof b.text === 'string') parts.push(b.text);
        else if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      }
    }
    return parts.join('');
  }
  return '';
}

function normalizeRole(r: unknown): DisplayMsg['role'] {
  const s = typeof r === 'string' ? r.toLowerCase() : '';
  if (s === 'user' || s === 'human') return 'user';
  if (s === 'assistant' || s === 'model') return 'assistant';
  if (s === 'tool' || s === 'tool_use' || s === 'tool_result') return 'tool';
  return 'system';
}

function projectMsg(
  raw: RawMessage,
  fallbackKey: string,
  envelopeId?: string,
  envelopeSeq?: number,
): DisplayMsg | null {
  const role = normalizeRole(raw.role);
  const text = (raw.text ?? extractText(raw.content)).trim();
  if (!text) return null;
  if (role === 'tool' || role === 'system') return null;
  const seq = envelopeSeq ?? raw._openclaw?.seq;
  const stableId = envelopeId ?? raw._openclaw?.id;
  const id = stableId
    ?? (seq !== undefined ? `${fallbackKey}-seq-${seq}` : `${fallbackKey}-${Math.random().toString(36).slice(2, 8)}`);
  const tsRaw = raw.timestamp;
  const ts =
    typeof tsRaw === 'number' ? tsRaw :
    typeof tsRaw === 'string' ? Date.parse(tsRaw) || undefined :
    undefined;
  return { id, role, text, ts };
}

function fmtTime(ts?: number) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtRelative(ms: number | null | undefined): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function channelIcon(ch?: string): string {
  if (!ch) return '⚡';
  const lc = ch.toLowerCase();
  if (lc.includes('telegram')) return '📱';
  if (lc.includes('slack')) return '💬';
  if (lc.includes('email')) return '✉';
  if (lc.includes('direct') || lc.includes('webchat') || lc.includes('ui')) return '⚡';
  return '◇';
}

/** Normalise raw channel strings so the filter chips have a stable set
 *  rather than one chip per casing/variant ("Direct" / "direct" / "ui"). */
function normalizeChannel(ch: string | undefined): string {
  if (!ch) return 'Direct';
  const lc = ch.toLowerCase();
  if (lc.includes('telegram')) return 'Telegram';
  if (lc.includes('slack')) return 'Slack';
  if (lc.includes('email')) return 'Email';
  if (lc.includes('webchat')) return 'WebChat';
  if (lc.includes('direct') || lc.includes('ui')) return 'Direct';
  return ch;
}

/* ── Chat ─────────────────────────────────────────────────────── */

const CHAT_ACTIVE_KEY_STORAGE = 'helm:chat:activeKey';

function readStoredActiveKey(): string | null {
  try { return localStorage.getItem(CHAT_ACTIVE_KEY_STORAGE) || null; }
  catch { return null; }
}

function persistActiveKey(key: string | null) {
  try {
    if (key) localStorage.setItem(CHAT_ACTIVE_KEY_STORAGE, key);
    else localStorage.removeItem(CHAT_ACTIVE_KEY_STORAGE);
  } catch { /* quota */ }
}

export default function Chat({ theme: _theme }: ChatProps) {
  const { client, status } = useGateway();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  // Seeded from localStorage so the selection survives navigation away from
  // the Chat screen. setActiveKey is wrapped so every change syncs back.
  const [activeKeyState, setActiveKeyState] = useState<string | null>(() => readStoredActiveKey());
  const setActiveKey = useCallback((next: string | null | ((prev: string | null) => string | null)) => {
    setActiveKeyState(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      persistActiveKey(resolved);
      return resolved;
    });
  }, []);
  const activeKey = activeKeyState;
  const [messages, setMessages] = useState<DisplayMsg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState('');
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Run id of the most recent send that we're still waiting on. Drives the
   *  "thinking…" placeholder while the gateway hasn't emitted any text yet.
   *  Cleared on agent.lifecycle.end for the matching run. */
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  /** Keys we'll accept session.message events for. Populated with both the
   *  client-side activeKey and the canonical key returned by the gateway's
   *  sessions.messages.subscribe response — the two can diverge when
   *  activeKey is an agent-scoped alias and the gateway broadcasts under
   *  the canonical store key. */
  const acceptedKeysRef = useRef<Set<string>>(new Set());
  /** Run IDs whose stream has already been finalised. The gateway sometimes
   *  emits trailing agent.assistant events after lifecycle.end / chat.final,
   *  and without this guard they would re-create a streaming placeholder
   *  next to the freshly committed canonical message. */
  const finalizedRunsRef = useRef<Set<string>>(new Set());

  const refreshSessions = useCallback(async () => {
    if (!client || status !== 'connected') return;
    try {
      const result = await client.call<{ sessions: SessionRow[] }>('sessions.list');
      const rows = result.sessions ?? [];
      rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setSessions(rows);
      // Keep the persisted selection if it's still a known session; otherwise
      // fall back to the most-recently-updated one. Without this fallback,
      // an obsolete stored key would silently render an empty thread.
      setActiveKey(prev => {
        if (prev && rows.some(r => r.key === prev)) return prev;
        return rows[0]?.key ?? null;
      });
    } catch (e) {
      console.warn('[chat] sessions.list failed', e);
    }
  }, [client, status]);

  useEffect(() => {
    if (!client || status !== 'connected') return;
    refreshSessions();
    client.call<{ agents: AgentRow[] }>('agents.list').then(r => setAgents(r.agents ?? [])).catch(() => {});
    const unsubs = [
      client.on('sessions.changed', () => { refreshSessions(); }),
    ];
    return () => unsubs.forEach(u => u());
  }, [client, status, refreshSessions]);

  // Load history + subscribe to messages when active session changes
  useEffect(() => {
    if (!client || status !== 'connected' || !activeKey) return;
    let cancelled = false;
    setLoadingMsgs(true);
    setMessages([]);
    acceptedKeysRef.current = new Set([activeKey]);
    finalizedRunsRef.current = new Set();

    (async () => {
      try {
        // Use chat.history rather than sessions.get — sessions.get only reads
        // the local transcript file, which is empty/header-only for dashboard
        // sessions (the CLI runtime keeps its own log). chat.history merges
        // CLI imports and returns display-projected messages.
        const res = await client.call<{ messages: RawMessage[] }>('chat.history', { sessionKey: activeKey, limit: 200 });
        if (cancelled) return;
        const msgs = (res.messages ?? [])
          .map(m => projectMsg(m, activeKey))
          .filter((m): m is DisplayMsg => m !== null);
        setMessages(msgs);
      } catch (e) {
        console.warn('[chat] chat.history failed', e);
      } finally {
        if (!cancelled) setLoadingMsgs(false);
      }

      try {
        const sub = await client.call<{ subscribed: boolean; key?: string }>(
          'sessions.messages.subscribe',
          { key: activeKey },
        );
        if (!cancelled && sub.key) acceptedKeysRef.current.add(sub.key);
      } catch (e) {
        console.warn('[chat] subscribe failed', e);
      }
    })();

    const upsert = (msg: DisplayMsg) => {
      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === msg.id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = msg;
          return next;
        }
        return [...prev, msg];
      });
    };

    // User-message echo + any non-streamed assistant content arrives here.
    const offMsg = client.on('session.message', (payload) => {
      const p = payload as SessionMessageEvent;
      const incomingKey = p?.sessionKey;
      if (!p?.message || !incomingKey) return;
      if (!acceptedKeysRef.current.has(incomingKey)) {
        console.log('[chat] dropped session.message for', incomingKey, '— expecting one of', [...acceptedKeysRef.current]);
        return;
      }
      const projected = projectMsg(p.message, activeKey, p.messageId, p.messageSeq);
      if (!projected) return;
      setMessages(prev => {
        // Drop any matching optimistic local user echo so we don't double-render.
        const trimmed = projected.role === 'user'
          ? prev.filter(m => !(m.id.startsWith('local:user:') && m.text === projected.text))
          : prev;
        const idx = trimmed.findIndex(m => m.id === projected.id);
        if (idx >= 0) {
          const next = trimmed.slice();
          next[idx] = projected;
          return next;
        }
        return [...trimmed, projected];
      });
      refreshSessions();
    });

    // Live assistant streaming. `agent` events with stream='assistant' carry
    // the cumulative text under data.text, so we keep replacing it as
    // tokens arrive. We key by `run:<runId>` so successive deltas update
    // the same bubble.
    const offAgent = client.on('agent', (payload) => {
      const p = payload as AgentEvent;
      if (!p?.sessionKey || !p.runId || !acceptedKeysRef.current.has(p.sessionKey)) return;
      if (finalizedRunsRef.current.has(p.runId)) return;
      if (p.stream === 'assistant' && typeof p.data?.text === 'string' && p.data.text.length > 0) {
        upsert({
          id: `run:${p.runId}`,
          role: 'assistant',
          text: p.data.text,
          streaming: true,
          runId: p.runId,
        });
      } else if (p.stream === 'lifecycle' && p.data?.phase === 'end') {
        const runId = p.runId;
        finalizedRunsRef.current.add(runId);
        setMessages(prev => prev.map(m => m.runId === runId ? { ...m, streaming: false } : m));
        setPendingRunId(prev => prev === runId ? null : prev);
        // The gateway flips hasActiveRun on lifecycle end; pull a fresh
        // sessions.list so the info panel reflects it.
        refreshSessions();
      }
    });

    // The gateway emits a `chat` event with state='final' once the run is
    // committed. Use it to swap the streaming placeholder for the canonical
    // projected message (which carries the real message id from the store).
    const offChat = client.on('chat', (payload) => {
      const p = payload as ChatStreamEvent;
      if (!p?.sessionKey || !p.runId || !acceptedKeysRef.current.has(p.sessionKey)) return;
      if (p.state !== 'final' || !p.message) return;
      finalizedRunsRef.current.add(p.runId);
      setPendingRunId(prev => prev === p.runId ? null : prev);
      const projected = projectMsg(p.message, activeKey, p.messageId, p.seq);
      if (!projected) {
        // No projectable text — still clear the streaming placeholder.
        setMessages(prev => prev.filter(m => m.runId !== p.runId));
        refreshSessions();
        return;
      }
      setMessages(prev => {
        const withoutPlaceholder = prev.filter(m => m.runId !== p.runId);
        const idx = withoutPlaceholder.findIndex(m => m.id === projected.id);
        if (idx >= 0) {
          const next = withoutPlaceholder.slice();
          next[idx] = projected;
          return next;
        }
        return [...withoutPlaceholder, projected];
      });
      refreshSessions();
    });

    return () => {
      cancelled = true;
      offMsg();
      offAgent();
      offChat();
      client.call('sessions.messages.unsubscribe', { key: activeKey }).catch(() => {});
    };
  }, [client, status, activeKey, refreshSessions]);

  // Auto-scroll thread on new messages
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    const text = composer.trim();
    if (!text || !client || !activeKey || sending) return;
    setSending(true);
    setErrorMsg(null);
    // Optimistic insert so the user's message appears immediately. The real
    // echo from session.message will replace this row (matched by text in
    // the session.message handler above).
    const optimisticId = `local:user:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ts = Date.now();
    setMessages(prev => [...prev, { id: optimisticId, role: 'user', text, ts }]);
    setComposer('');
    try {
      const resp = await client.call<{ runId?: string }>('sessions.send', { key: activeKey, message: text });
      if (resp?.runId) setPendingRunId(resp.runId);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'send failed');
      // Drop the optimistic message on failure so it's clear the send didn't go.
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      setComposer(text);
    } finally {
      setSending(false);
    }
  };

  const handleAbort = async () => {
    if (!client || !activeKey) return;
    try { await client.call('sessions.abort', { key: activeKey }); } catch { /* ignore */ }
  };

  const handleNewSession = async () => {
    if (!client || agents.length === 0) return;
    try {
      const res = await client.call<{ key?: string; sessionKey?: string }>('sessions.create', {
        agentId: agents[0].id,
      });
      const newKey = res.key ?? res.sessionKey;
      if (newKey) setActiveKey(newKey);
      refreshSessions();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'create failed');
    }
  };

  // Filter chips
  const agentOptions = useMemo(() => {
    const s = new Set<string>();
    (sessions ?? []).forEach(row => {
      const id = row.agentRuntime?.agentId;
      if (id) s.add(id);
    });
    return [...s].sort();
  }, [sessions]);

  const channelOptions = useMemo(() => {
    const s = new Set<string>();
    (sessions ?? []).forEach(row => {
      const ch = row.lastChannel ?? row.channel;
      if (ch) s.add(normalizeChannel(ch));
    });
    return [...s].sort();
  }, [sessions]);

  const filtered = useMemo(() => {
    const list = sessions ?? [];
    return list.filter(s => {
      if (agentFilter !== 'all' && (s.agentRuntime?.agentId ?? '') !== agentFilter) return false;
      if (channelFilter !== 'all' && normalizeChannel(s.lastChannel ?? s.channel) !== channelFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!(
          (s.displayName ?? '').toLowerCase().includes(q) ||
          (s.derivedTitle ?? '').toLowerCase().includes(q) ||
          (s.lastMessagePreview ?? '').toLowerCase().includes(q) ||
          s.key.toLowerCase().includes(q)
        )) return false;
      }
      return true;
    });
  }, [sessions, search, agentFilter, channelFilter]);

  const active = activeKey ? sessions?.find(s => s.key === activeKey) ?? null : null;

  // Context-usage bar — prefer the gateway's contextTokens, fall back to
  // totalTokens, fall back to a rough char/4 estimate over the visible
  // thread so the bar moves with the live conversation even when the
  // gateway hasn't refreshed sessionRow stats yet.
  const charEstimateTokens = useMemo(
    () => Math.ceil(messages.reduce((n, m) => n + m.text.length, 0) / 4),
    [messages],
  );
  const contextUsed = active?.contextTokens ?? active?.totalTokens ?? charEstimateTokens;
  const contextMax = 200_000;
  const ctxPct = Math.min(100, (contextUsed / contextMax) * 100);
  const ctxIsEstimate = (active?.contextTokens ?? active?.totalTokens) == null;

  /* ── render ──────────────────────────────────────────────────── */

  return (
    <div id="screen-chat" className="screen">
      <div className="chat-sessions">
        <div className="chat-sessions-head">
          <input
            placeholder="Search sessions…"
            style={{ flex: 1 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button
            className="btn"
            style={{ padding: '5px 8px', fontSize: '10px' }}
            onClick={handleNewSession}
            disabled={status !== 'connected' || agents.length === 0}
          >+ New</button>
        </div>
        {(agentOptions.length > 1 || channelOptions.length > 1) && (
          <div className="session-filters">
            {agentOptions.length > 1 && (
              <div className="session-filter-row">
                <span className="session-filter-label">Agent</span>
                <button
                  className={`chip ${agentFilter === 'all' ? 'chip-on' : ''}`}
                  onClick={() => setAgentFilter('all')}
                >All</button>
                {agentOptions.map(id => (
                  <button
                    key={id}
                    className={`chip ${agentFilter === id ? 'chip-on' : ''}`}
                    onClick={() => setAgentFilter(id)}
                  >{id}</button>
                ))}
              </div>
            )}
            {channelOptions.length > 1 && (
              <div className="session-filter-row">
                <span className="session-filter-label">Channel</span>
                <button
                  className={`chip ${channelFilter === 'all' ? 'chip-on' : ''}`}
                  onClick={() => setChannelFilter('all')}
                >All</button>
                {channelOptions.map(ch => (
                  <button
                    key={ch}
                    className={`chip ${channelFilter === ch ? 'chip-on' : ''}`}
                    onClick={() => setChannelFilter(ch)}
                  >{channelIcon(ch)} {ch}</button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="session-list">
          {status !== 'connected' && (
            <div style={{ padding: '12px', fontSize: '11px', color: 'var(--ink2)' }}>
              {status === 'connecting' ? 'Connecting…' : 'Not connected to gateway'}
            </div>
          )}
          {status === 'connected' && sessions == null && (
            <div style={{ padding: '12px', fontSize: '11px', color: 'var(--ink2)' }}>Loading sessions…</div>
          )}
          {status === 'connected' && sessions != null && filtered.length === 0 && (
            <div style={{ padding: '12px', fontSize: '11px', color: 'var(--ink2)' }}>
              {search ? 'No matches' : 'No sessions yet'}
            </div>
          )}
          {filtered.map(s => {
            const ch = s.lastChannel ?? s.channel ?? 'Direct';
            return (
              <div
                key={s.key}
                className={`session-item ${s.key === activeKey ? 'active' : ''}`}
                onClick={() => setActiveKey(s.key)}
              >
                <div className="session-title">
                  {s.displayName ?? s.derivedTitle ?? s.key}
                </div>
                {s.lastMessagePreview && (
                  <div className="session-preview">{s.lastMessagePreview}</div>
                )}
                <div className="session-meta">
                  <span className="chan-badge">{channelIcon(ch)} {ch}</span>
                  <span>{fmtRelative(s.updatedAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="chat-main">
        <div className="chat-thread" ref={threadRef}>
          {!activeKey && status === 'connected' && (
            <div style={{ color: 'var(--ink2)', fontSize: '12px', padding: '24px' }}>
              Select or create a session to begin.
            </div>
          )}
          {activeKey && loadingMsgs && (
            <div style={{ color: 'var(--ink2)', fontSize: '11px' }}>Loading history…</div>
          )}
          {activeKey && !loadingMsgs && messages.length === 0 && (
            <div style={{ color: 'var(--ink2)', fontSize: '11px' }}>No messages yet — send the first.</div>
          )}
          {messages.map(m => (
            <div key={m.id} className={`msg ${m.role === 'user' ? 'user' : ''}`}>
              <div className="msg-avatar">{m.role === 'user' ? 'U' : 'D'}</div>
              <div>
                <div className="msg-body" style={{ whiteSpace: 'pre-wrap' }}>
                  {m.text}
                  {m.streaming && <span className="streaming-cursor" />}
                </div>
                {m.ts ? (
                  <div className="msg-time">{fmtTime(m.ts)}{m.streaming ? ' · streaming…' : ''}</div>
                ) : m.streaming ? (
                  <div className="msg-time">streaming…</div>
                ) : null}
              </div>
            </div>
          ))}
          {pendingRunId && !messages.some(m => m.runId === pendingRunId) && (
            <div className="msg">
              <div className="msg-avatar">D</div>
              <div>
                <div className="msg-body"><span className="streaming-cursor" /></div>
                <div className="msg-time">thinking…</div>
              </div>
            </div>
          )}
        </div>

        <div className="composer">
          <div className="composer-top">
            <span>Model:</span>
            <span style={{ color: 'var(--acc)', fontFamily: 'var(--fm)' }}>{active?.model ?? '—'}</span>
            {active?.thinkingLevel != null && (
              <>
                <span style={{ marginLeft: '8px' }}>Thinking:</span>
                <span style={{ color: 'var(--acc)' }}>{String(active.thinkingLevel)}</span>
              </>
            )}
            {errorMsg && (
              <span style={{ marginLeft: '8px', color: 'var(--err)' }}>{errorMsg}</span>
            )}
            <button
              className="btn"
              style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: '10px' }}
              onClick={handleAbort}
              disabled={!active?.hasActiveRun}
            >✕ Abort</button>
          </div>
          <div className="survival-stats">
            <div className="surv-stat"><div className="surv-dot h"></div><div className="surv-bar"><div className="surv-fill h"></div></div></div>
            <div className="surv-stat"><div className="surv-dot w"></div><div className="surv-bar"><div className="surv-fill w"></div></div></div>
            <div className="surv-stat"><div className="surv-dot c"></div><div className="surv-bar"><div className="surv-fill c"></div></div></div>
            <div className="surv-stat"><div className="surv-dot f"></div><div className="surv-bar"><div className="surv-fill f"></div></div></div>
          </div>
          <div className="composer-row">
            <textarea
              placeholder={activeKey ? 'Message Deltron… (Enter to send, Shift+Enter for newline)' : 'Select a session to chat…'}
              value={composer}
              onChange={e => setComposer(e.target.value)}
              disabled={!activeKey || sending}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              className="btn"
              style={{ alignSelf: 'flex-end', padding: '8px 14px' }}
              onClick={handleSend}
              disabled={!composer.trim() || !activeKey || sending}
            >{sending ? 'Sending…' : 'Send'}</button>
          </div>
        </div>
      </div>

      <div className="chat-info">
        <div className="card-title">Session Info</div>
        {!active && (
          <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>No session selected.</div>
        )}
        {active && (
          <>
            <div className="info-row"><span className="info-label">Session</span><span className="info-val" title={active.key} style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{active.key}</span></div>
            <div className="info-row"><span className="info-label">Agent</span><span className="info-val">{active.agentRuntime?.agentId ?? '—'}</span></div>
            <div className="info-row"><span className="info-label">Model</span><span className="info-val">{active.model ?? '—'}</span></div>
            <div className="info-row"><span className="info-label">Channel</span><span className="info-val">{active.lastChannel ?? active.channel ?? 'Direct'}</span></div>
            <div className="info-row"><span className="info-label">Status</span><span className="info-val">{active.status ?? '—'}</span></div>
            <div className="info-row"><span className="info-label">Updated</span><span className="info-val">{fmtRelative(active.updatedAt)}</span></div>
            <div style={{ marginTop: '4px' }}>
              <div className="card-title">
                Context Used
                {ctxIsEstimate && (
                  <span style={{ marginLeft: '6px', fontSize: '9px', color: 'var(--ink2)', textTransform: 'none', letterSpacing: 'normal' }}>
                    (est.)
                  </span>
                )}
              </div>
              <div className="token-bar"><div className="token-fill" style={{ width: `${ctxPct}%` }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ink2)', marginTop: '3px' }}>
                <span>{contextUsed.toLocaleString()} / {contextMax.toLocaleString()}</span>
                <span>{ctxPct.toFixed(1)}%</span>
              </div>
            </div>
            <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                className="btn btn-ghost"
                style={{ width: '100%' }}
                onClick={() => client?.call('sessions.compact', { key: active.key }).catch(() => {})}
              >Compact Context</button>
              <button
                className="btn btn-ghost"
                style={{ width: '100%' }}
                onClick={() => client?.call('sessions.reset', { key: active.key }).then(() => setMessages([])).catch(() => {})}
              >Reset Session</button>
              <button
                className="btn btn-ghost"
                style={{ width: '100%' }}
                title="Removes from the active list; transcript is moved to the gateway archive (recoverable)"
                onClick={async () => {
                  if (!client) return;
                  if (!confirm('Archive this session? It will be removed from the list but the transcript is kept in the gateway archive.')) return;
                  try {
                    // sessions.delete with default deleteTranscript=true archives the transcript
                    // (gateway calls archiveSessionTranscriptsForSessionDetailed under the hood).
                    await client.call('sessions.delete', { key: active.key });
                    setActiveKey(null);
                    refreshSessions();
                  } catch { /* ignore */ }
                }}
              >Archive Session</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
