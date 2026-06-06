import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Theme } from '../types';
import { useGateway } from '../context/GatewayContext';
import { navigateTo, extractHTMLFromAssistantText } from '../lib/handoff';
import DesignCanvas from '../components/DesignCanvas';
import {
  createChatModelOverride,
  type ChatModelOverride,
} from '../lib/chat/chat-model-ref';
import { resolveChatModelSelectState } from '../lib/chat/chat-model-select-state';
import { listThinkingLevelLabels, normalizeThinkLevel } from '../lib/chat/thinking';
import type { ModelCatalogEntry, SessionsDefaults } from '../lib/chat/types';
import { PinnedMessages } from '../lib/chat/pinned-messages';
import { exportChatMarkdown } from '../lib/chat/export';
import {
  handleChatInputHistoryKey,
  recordNonTranscriptInputHistory,
  resetChatInputHistoryNavigation,
  type ChatInputHistoryState,
} from '../lib/chat/input-history';
import {
  executeSlashCommand,
  matchSlashCommands,
  parseSlashInput,
  type SlashCommandDef,
} from '../lib/chat/slash-commands-native';
import {
  getCachedSessions,
  setCachedSessions,
  getCachedHistory,
  setCachedHistory,
} from '../lib/chat/session-cache';

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
  modelProvider?: string;
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
  /** Tool calls embedded in an assistant message's content blocks. */
  toolCalls?: Array<{ name: string; input?: unknown }>;
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

function extractToolBlocks(content: unknown): Array<{ name: string; input?: unknown }> {
  if (!Array.isArray(content)) return [];
  const blocks: Array<{ name: string; input?: unknown }> = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'tool_use' && typeof b.name === 'string') {
      blocks.push({ name: b.name, input: b.input });
    }
  }
  return blocks;
}

function summarizeToolBlock(block: { name: string; input?: unknown }): string {
  const args = block.input;
  if (!args || typeof args !== 'object') return block.name;
  // One-line preview of the first 1-2 meaningful arg values.
  const entries = Object.entries(args as Record<string, unknown>).slice(0, 2);
  const preview = entries
    .map(([k, v]) => {
      if (typeof v === 'string') {
        const trimmed = v.length > 60 ? `${v.slice(0, 60)}…` : v;
        return `${k}=${JSON.stringify(trimmed)}`;
      }
      if (typeof v === 'number' || typeof v === 'boolean') return `${k}=${v}`;
      return `${k}=…`;
    })
    .join(' ');
  return preview ? `${block.name}(${preview})` : block.name;
}

function projectMsg(
  raw: RawMessage,
  fallbackKey: string,
  envelopeId?: string,
  envelopeSeq?: number,
): DisplayMsg | null {
  const role = normalizeRole(raw.role);
  const text = (raw.text ?? extractText(raw.content)).trim();
  if (role === 'tool' || role === 'system') {
    // Project tool/system messages so the "show tools" toggle can surface them.
    // Empty text is OK — render the role label instead.
    const seq = envelopeSeq ?? raw._openclaw?.seq;
    const stableId = envelopeId ?? raw._openclaw?.id;
    const id = stableId
      ?? (seq !== undefined ? `${fallbackKey}-seq-${seq}` : `${fallbackKey}-${Math.random().toString(36).slice(2, 8)}`);
    const tsRaw = raw.timestamp;
    const ts =
      typeof tsRaw === 'number' ? tsRaw :
      typeof tsRaw === 'string' ? Date.parse(tsRaw) || undefined :
      undefined;
    return { id, role, text: text || `[${role}]`, ts };
  }
  // For assistant messages with tool_use blocks, expose the tool calls inline
  // so the "show tools" toggle has something to render. Text part stays in `text`.
  const toolBlocks = role === 'assistant' ? extractToolBlocks(raw.content) : [];
  if (!text && toolBlocks.length === 0) return null;
  const seq = envelopeSeq ?? raw._openclaw?.seq;
  const stableId = envelopeId ?? raw._openclaw?.id;
  const id = stableId
    ?? (seq !== undefined ? `${fallbackKey}-seq-${seq}` : `${fallbackKey}-${Math.random().toString(36).slice(2, 8)}`);
  const tsRaw = raw.timestamp;
  const ts =
    typeof tsRaw === 'number' ? tsRaw :
    typeof tsRaw === 'string' ? Date.parse(tsRaw) || undefined :
    undefined;
  return { id, role, text, ts, toolCalls: toolBlocks.length > 0 ? toolBlocks : undefined };
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

/** Render a short, human-friendly label for a session row.
 *  The raw key (`agent:main:dashboard:<uuid>`) is too long for the
 *  sidebar — peel the prefix and shrink the uuid to its first 6 chars.
 *  Prefer the server-provided displayName / derivedTitle when present. */
function shortenSessionLabel(row: { key: string; displayName?: string; derivedTitle?: string; lastMessagePreview?: string }): string {
  if (row.displayName && row.displayName.trim()) return row.displayName.trim();
  if (row.derivedTitle && row.derivedTitle.trim()) return row.derivedTitle.trim();
  // Fall back to a snippet of the last message if available — usually more
  // useful than the opaque key.
  const preview = row.lastMessagePreview?.trim();
  if (preview) {
    return preview.length > 48 ? `${preview.slice(0, 48)}…` : preview;
  }
  // Last resort: derive from the key. agent:main:dashboard:<uuid> →
  // dashboard:<uuid-prefix>.
  const parts = row.key.split(':');
  const tail = parts[parts.length - 1];
  const shortUuid = tail.length > 8 ? tail.slice(0, 6) : tail;
  const channel = parts.length >= 3 ? parts[parts.length - 2] : '';
  return channel ? `${channel}:${shortUuid}` : shortUuid;
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
const SHOW_TOOLS_STORAGE = 'helm:chat:showTools';
const SHOW_EMPTY_STORAGE = 'helm:chat:showEmpty';
const CANVAS_WIDTH_STORAGE = 'helm:chat:canvasWidth';
const canvasOpenStorage = (key: string) => `helm:chat:canvasOpen:${key}`;
/** Last HTML we auto-seeded into a session's canvas. Lets us pick up *new*
 *  chat HTML on open without re-clobbering the user's saved edits when nothing
 *  newer has appeared. */
const canvasLastSeedStorage = (key: string) => `helm:chat:canvasLastSeed:${key}`;
const CANVAS_MIN_WIDTH = 360;
const CANVAS_DEFAULT_WIDTH = 620;

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
  // Seed from the in-memory cache so a re-mount renders instantly while
  // the background refresh chases the gateway.
  const [sessions, setSessions] = useState<SessionRow[] | null>(
    () => getCachedSessions<SessionRow>()?.rows ?? null,
  );
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
  const [showTools, setShowToolsState] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_TOOLS_STORAGE) === '1'; } catch { return false; }
  });
  const setShowTools = useCallback((v: boolean) => {
    setShowToolsState(v);
    try { localStorage.setItem(SHOW_TOOLS_STORAGE, v ? '1' : '0'); } catch { /* quota */ }
  }, []);
  // Default: hide empty stub sessions. Tris's gateway accumulates them
  // every time the user clicks `+ New` without sending anything.
  const [showEmpty, setShowEmptyState] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_EMPTY_STORAGE) === '1'; } catch { return false; }
  });
  const setShowEmpty = useCallback((v: boolean) => {
    setShowEmptyState(v);
    try { localStorage.setItem(SHOW_EMPTY_STORAGE, v ? '1' : '0'); } catch { /* quota */ }
  }, []);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogEntry[]>([]);
  /** Local override cache — reflects in-flight `sessions.patch` calls before
   *  the next sessions.list refresh. Values: ChatModelOverride to set, `null`
   *  to clear (back to default). Missing key = inherit from server row. */
  const [modelOverrides, setModelOverrides] = useState<Record<string, ChatModelOverride | null>>({});
  const [sessionsDefaults, setSessionsDefaults] = useState<SessionsDefaults | null>(null);
  /** Same idea, for thinking level. `null` = explicit clear, missing = inherit. */
  const [thinkingOverrides, setThinkingOverrides] = useState<Record<string, string | null>>({});
  const [pinnedTick, setPinnedTick] = useState(0);
  const pinnedRef = useRef<PinnedMessages | null>(null);
  const inputHistoryStateRef = useRef<ChatInputHistoryState>({
    sessionKey: '',
    chatLoading: false,
    chatMessage: '',
    chatMessages: [],
    chatLocalInputHistoryBySession: {},
    chatInputHistorySessionKey: null,
    chatInputHistoryItems: null,
    chatInputHistoryIndex: -1,
    chatDraftBeforeHistory: null,
  });
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  /** Forward-declared so handleSend (defined earlier) can call into the
   *  slash-command executor (defined below after model/thinking handlers). */
  const runSlashIfApplicableRef = useRef<((input: string) => Promise<boolean>) | null>(null);
  /** Run id of the most recent send that we're still waiting on. Drives the
   *  "thinking…" placeholder while the gateway hasn't emitted any text yet.
   *  Cleared on agent.lifecycle.end for the matching run. */
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  /* ── slide-out design canvas ──────────────────────────────────── */
  // Open state is per session (persisted); width is shared across sessions.
  const [canvasOpen, setCanvasOpenState] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(CANVAS_WIDTH_STORAGE);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) ? n : CANVAS_DEFAULT_WIDTH;
    } catch { return CANVAS_DEFAULT_WIDTH; }
  });
  const [resizingCanvas, setResizingCanvas] = useState(false);
  // One-shot HTML seed for the canvas, scoped to the session it was pulled
  // from so a session switch can't replay a stale seed over saved edits.
  const [canvasSeed, setCanvasSeed] = useState<{ key: string; html: string; label: string } | null>(null);
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
      const result = await client.call<{ sessions: SessionRow[]; defaults?: SessionsDefaults | null }>('sessions.list');
      const rows = result.sessions ?? [];
      rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setSessions(rows);
      setCachedSessions(rows);
      if (result.defaults !== undefined) {
        setSessionsDefaults(result.defaults ?? null);
      }
      // Keep the persisted selection if it's still a known session; otherwise
      // try to resolve a client-side alias to its canonical row (Sprint 1
      // fix — was falling back to row[0] when the alias didn't match
      // exactly), and only as a last resort silently swap to the newest row.
      setActiveKey(prev => {
        if (!prev) return rows[0]?.key ?? null;
        if (rows.some(r => r.key === prev)) return prev;
        // Alias lookup: match by the trailing UUID-ish segment of the key,
        // which survives the canonical/alias rename.
        const prevTail = prev.split(':').pop() ?? prev;
        const aliasMatch = rows.find(r => r.key.endsWith(prevTail));
        if (aliasMatch) return aliasMatch.key;
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
    // Model catalog rarely changes — pull once per connect.
    client.call<{ models?: ModelCatalogEntry[] }>('models.list')
      .then(r => setModelCatalog(r.models ?? []))
      .catch(() => { /* gateway may not have models endpoint */ });
    const unsubs = [
      client.on('sessions.changed', () => { refreshSessions(); }),
    ];
    return () => unsubs.forEach(u => u());
  }, [client, status, refreshSessions]);

  // Load history + subscribe to messages when active session changes
  useEffect(() => {
    if (!client || status !== 'connected' || !activeKey) return;
    let cancelled = false;
    acceptedKeysRef.current = new Set([activeKey]);
    finalizedRunsRef.current = new Set();

    // Render any cached history immediately so switching sessions feels
    // instant. The background refresh below keeps the thread current.
    const cached = getCachedHistory<RawMessage>(activeKey);
    if (cached) {
      const projected = cached
        .map(m => projectMsg(m, activeKey))
        .filter((m): m is DisplayMsg => m !== null);
      setMessages(projected);
      setLoadingMsgs(false);
    } else {
      setMessages([]);
      setLoadingMsgs(true);
    }

    (async () => {
      try {
        // Use chat.history rather than sessions.get — sessions.get only reads
        // the local transcript file, which is empty/header-only for dashboard
        // sessions (the CLI runtime keeps its own log). chat.history merges
        // CLI imports and returns display-projected messages.
        const res = await client.call<{ messages: RawMessage[] }>('chat.history', { sessionKey: activeKey, limit: 200 });
        if (cancelled) return;
        const raw = res.messages ?? [];
        setCachedHistory(activeKey, raw);
        const msgs = raw
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

  // Per-session PinnedMessages instance — recreate when activeKey changes so
  // pinned indices match the messages currently in the thread.
  useEffect(() => {
    if (!activeKey) {
      pinnedRef.current = null;
      return;
    }
    pinnedRef.current = new PinnedMessages(activeKey);
    setPinnedTick(t => t + 1);
  }, [activeKey]);

  // Auto-focus composer when switching to / creating a session — saves a click
  // before the user can start typing.
  useEffect(() => {
    if (!activeKey) return;
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [activeKey]);

  // Mirror the React state the input-history module reads through. It mutates
  // its argument in place, so we keep a single ref instead of bouncing through
  // setState — pinnedTick re-runs the read paths.
  useEffect(() => {
    inputHistoryStateRef.current.sessionKey = activeKey ?? '';
    inputHistoryStateRef.current.chatLoading = loadingMsgs || sending;
    inputHistoryStateRef.current.chatMessage = composer;
    inputHistoryStateRef.current.chatMessages = messages;
  }, [activeKey, loadingMsgs, sending, composer, messages]);

  const handleSend = async () => {
    const text = composer.trim();
    if (!text || !client || !activeKey || sending) return;
    // Intercept slash commands before optimistic insert + RPC send.
    if (text.startsWith('/')) {
      const consumed = await runSlashIfApplicableRef.current?.(text);
      if (consumed) {
        recordNonTranscriptInputHistory(inputHistoryStateRef.current, text);
        resetChatInputHistoryNavigation(inputHistoryStateRef.current);
        return;
      }
      // Not a known command → fall through and send as a plain message.
    }
    setSending(true);
    setErrorMsg(null);
    recordNonTranscriptInputHistory(inputHistoryStateRef.current, text);
    // Optimistic insert so the user's message appears immediately. The real
    // echo from session.message will replace this row (matched by text in
    // the session.message handler above).
    const optimisticId = `local:user:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ts = Date.now();
    setMessages(prev => [...prev, { id: optimisticId, role: 'user', text, ts }]);
    setComposer('');
    resetChatInputHistoryNavigation(inputHistoryStateRef.current);
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

  // Persist open/closed per session; reload it when the active session changes.
  const setCanvasOpen = useCallback((v: boolean) => {
    setCanvasOpenState(v);
    if (!activeKey) return;
    try { localStorage.setItem(canvasOpenStorage(activeKey), v ? '1' : '0'); } catch { /* quota */ }
  }, [activeKey]);

  useEffect(() => {
    if (!activeKey) { setCanvasOpenState(false); return; }
    try { setCanvasOpenState(localStorage.getItem(canvasOpenStorage(activeKey)) === '1'); }
    catch { setCanvasOpenState(false); }
  }, [activeKey]);

  // Persist width on change (cheap — it's a single integer).
  useEffect(() => {
    try { localStorage.setItem(CANVAS_WIDTH_STORAGE, String(Math.round(canvasWidth))); } catch { /* quota */ }
  }, [canvasWidth]);

  // Drag the left edge of the panel to resize. Dragging left widens it.
  const startCanvasResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = canvasWidth;
    setResizingCanvas(true);
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const max = Math.max(CANVAS_MIN_WIDTH, window.innerWidth - 420);
      setCanvasWidth(Math.min(Math.max(startW + delta, CANVAS_MIN_WIDTH), max));
    };
    const onUp = () => {
      setResizingCanvas(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [canvasWidth]);

  const visibleMessages = useMemo(() => {
    if (showTools) return messages;
    // When tools are hidden, drop role=tool/system rows entirely, and drop
    // assistant rows whose body is empty and only carry tool_use blocks.
    return messages.filter(m => {
      if (m.role === 'tool' || m.role === 'system') return false;
      if (m.role === 'assistant' && !m.text.trim() && m.toolCalls?.length) return false;
      return true;
    });
  }, [messages, showTools]);

  const modelSelectState = useMemo(() => resolveChatModelSelectState({
    sessionKey: activeKey ?? '',
    chatModelOverrides: modelOverrides,
    chatModelCatalog: modelCatalog,
    sessionsResult: sessions ? { sessions, defaults: sessionsDefaults } : null,
  }), [activeKey, modelOverrides, modelCatalog, sessions, sessionsDefaults]);

  const thinkingLevels = useMemo(() => listThinkingLevelLabels(), []);
  const activeRowForControls = activeKey ? sessions?.find(s => s.key === activeKey) ?? null : null;
  const currentThinking = useMemo(() => {
    if (!activeKey) return '';
    const override = thinkingOverrides[activeKey];
    if (override !== undefined) return override ?? '';
    return normalizeThinkLevel(activeRowForControls?.thinkingLevel) ?? '';
  }, [activeKey, thinkingOverrides, activeRowForControls]);

  const handleModelChange = useCallback(async (qualifiedValue: string) => {
    if (!client || !activeKey) return;
    const prevOverride = modelOverrides[activeKey];
    const nextOverride = qualifiedValue ? createChatModelOverride(qualifiedValue) : null;
    setModelOverrides(prev => ({ ...prev, [activeKey]: nextOverride }));
    try {
      await client.call('sessions.patch', {
        key: activeKey,
        model: qualifiedValue || null,
      });
      refreshSessions();
    } catch (e) {
      setModelOverrides(prev => ({ ...prev, [activeKey]: prevOverride ?? null }));
      setErrorMsg(e instanceof Error ? e.message : 'model patch failed');
    }
  }, [client, activeKey, modelOverrides, refreshSessions]);

  const handleThinkingChange = useCallback(async (level: string) => {
    if (!client || !activeKey) return;
    const prev = thinkingOverrides[activeKey];
    const next = level ? level : null;
    setThinkingOverrides(p => ({ ...p, [activeKey]: next }));
    try {
      await client.call('sessions.patch', {
        key: activeKey,
        thinkingLevel: next,
      });
      refreshSessions();
    } catch (e) {
      setThinkingOverrides(p => ({ ...p, [activeKey]: prev ?? null }));
      setErrorMsg(e instanceof Error ? e.message : 'thinking patch failed');
    }
  }, [client, activeKey, thinkingOverrides, refreshSessions]);

  const slashMatches = useMemo<SlashCommandDef[]>(() => {
    if (!composer.startsWith('/')) return [];
    return matchSlashCommands(composer);
  }, [composer]);
  const [slashHover, setSlashHover] = useState(0);
  useEffect(() => { setSlashHover(0); }, [slashMatches.length]);

  const runSlashIfApplicable = useCallback(async (input: string): Promise<boolean> => {
    if (!parseSlashInput(input)) return false;
    if (!activeKey || !client) return false;
    const result = await executeSlashCommand(input, {
      setModel: handleModelChange,
      setThinking: handleThinkingChange,
      compact: () => client.call('sessions.compact', { key: activeKey }).then(() => undefined),
      reset: () => client.call('sessions.reset', { key: activeKey }).then(() => setMessages([])),
      clearLocal: () => setMessages([]),
      exportChat: () => {
        const name = activeRowForControls?.displayName ?? activeRowForControls?.derivedTitle ?? activeRowForControls?.agentRuntime?.agentId ?? 'assistant';
        exportChatMarkdown(messages, name);
      },
      newSession: () => handleNewSession(),
    });
    if (!result.consumed) return false;
    setComposer('');
    if (result.message) {
      // Render the result as a synthetic system message so the user sees it.
      const id = `local:slash:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setMessages(prev => [...prev, { id, role: 'system', text: `/${parseSlashInput(input)?.command} → ${result.message}`, ts: Date.now() }]);
    }
    return true;
  }, [client, activeKey, handleModelChange, handleThinkingChange, messages, activeRowForControls, handleNewSession]);

  // Plug the forward-declared ref so handleSend can invoke the executor.
  useEffect(() => {
    runSlashIfApplicableRef.current = runSlashIfApplicable;
  }, [runSlashIfApplicable]);

  const handleExport = useCallback(() => {
    if (!activeRowForControls) return;
    const assistantName =
      activeRowForControls.displayName
      ?? activeRowForControls.derivedTitle
      ?? activeRowForControls.agentRuntime?.agentId
      ?? 'assistant';
    // exportChatMarkdown expects raw upstream-style messages; our DisplayMsg
    // already has `text` so it serialises cleanly via the simplified extractor.
    exportChatMarkdown(messages, assistantName);
  }, [activeRowForControls, messages]);

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
    const q = search.trim().toLowerCase();
    return list.filter(s => {
      // Hide empty stub sessions unless the user opts in, but always keep the
      // currently-active row visible so a brand-new session doesn't vanish
      // before the first message lands.
      if (!showEmpty && s.key !== activeKey) {
        const preview = (s.lastMessagePreview ?? '').trim();
        if (!preview) return false;
      }
      if (agentFilter !== 'all' && (s.agentRuntime?.agentId ?? '') !== agentFilter) return false;
      if (channelFilter !== 'all' && normalizeChannel(s.lastChannel ?? s.channel) !== channelFilter) return false;
      if (q) {
        const meta = (
          (s.displayName ?? '').toLowerCase().includes(q) ||
          (s.derivedTitle ?? '').toLowerCase().includes(q) ||
          (s.lastMessagePreview ?? '').toLowerCase().includes(q) ||
          (s.agentRuntime?.agentId ?? '').toLowerCase().includes(q) ||
          (s.model ?? '').toLowerCase().includes(q) ||
          (s.lastChannel ?? s.channel ?? '').toLowerCase().includes(q) ||
          s.key.toLowerCase().includes(q)
        );
        if (meta) return true;
        // Best-effort content search: scan cached history if we have it.
        // No fetch is triggered here — only sessions the user has visited
        // recently (LRU cap 10) will be in cache. This widens search
        // coverage without hammering the gateway.
        if (q.length >= 3) {
          const cached = getCachedHistory<RawMessage>(s.key);
          if (cached) {
            for (const m of cached) {
              const t = typeof m.text === 'string' ? m.text : extractText(m.content);
              if (t.toLowerCase().includes(q)) return true;
            }
          }
        }
        return false;
      }
      return true;
    });
  }, [sessions, search, agentFilter, channelFilter, showEmpty, activeKey]);

  const active = activeKey ? sessions?.find(s => s.key === activeKey) ?? null : null;

  // Most recent assistant HTML in the thread (if any). Walks back so a
  // trailing "Done!" reply doesn't shadow the HTML message.
  const latestSessionHTML = useCallback((): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      const found = extractHTMLFromAssistantText(m.text);
      if (found) return found;
    }
    return null;
  }, [messages]);

  // Seed the canvas from the latest assistant HTML in the active session.
  //  - force (explicit "Open in Canvas"): always seed when HTML exists.
  //  - plain open (Canvas toggle): only seed when the latest HTML differs from
  //    what we last auto-seeded, so reopening the canvas doesn't overwrite the
  //    user's saved edits when no newer HTML has arrived.
  const seedCanvasFromSession = useCallback((force = false) => {
    if (!activeKey) return;
    const html = latestSessionHTML();
    if (!html) return;
    let lastSeed: string | null = null;
    try { lastSeed = localStorage.getItem(canvasLastSeedStorage(activeKey)); } catch { /* ignore */ }
    if (!force && html === lastSeed) return;
    const label = active?.displayName ?? active?.derivedTitle ?? activeKey;
    setCanvasSeed({ key: activeKey, html, label: `Chat session: ${label}` });
    try { localStorage.setItem(canvasLastSeedStorage(activeKey), html); } catch { /* quota */ }
  }, [activeKey, latestSessionHTML, active]);

  // Open the canvas, picking up the latest session HTML as it opens.
  const openCanvasWithLatestHTML = useCallback(() => {
    seedCanvasFromSession(true);
    setCanvasOpen(true);
  }, [seedCanvasFromSession, setCanvasOpen]);

  // If the canvas is already open (persisted) when we switch into / finish
  // loading a session, pick up its latest HTML too — otherwise the canvas
  // would sit on its default placeholder despite HTML being in the thread.
  // The "only if new" guard inside seedCanvasFromSession protects saved edits.
  useEffect(() => {
    if (!canvasOpen || loadingMsgs) return;
    seedCanvasFromSession();
    // Intentionally not depending on seedCanvasFromSession/messages: we only
    // want this on session-switch / load-complete, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, canvasOpen, loadingMsgs]);

  // Context-usage bar.
  //
  // Sprint 1 fix: the prior fallback chain (contextTokens ?? totalTokens ??
  // estimate) meant a session with no live contextTokens fell through to
  // *cumulative* totalTokens — that's how Tris was seeing 1,048,576/200,000.
  // And the denominator was a hardcoded 200k regardless of model. Now:
  //
  //   numerator   = contextTokens (live) → char/4 estimate (offline fallback)
  //                 totalTokens is NOT used — it's cumulative lifetime usage.
  //   denominator = model's contextWindow from the catalog, else 200k.
  const charEstimateTokens = useMemo(
    () => Math.ceil(messages.reduce((n, m) => n + m.text.length, 0) / 4),
    [messages],
  );
  const activeModelEntry = useMemo(() => {
    if (!active?.model) return null;
    const wanted = active.model;
    return modelCatalog.find(m => m.id === wanted || m.alias === wanted) ?? null;
  }, [active?.model, modelCatalog]);
  const contextMax = activeModelEntry?.contextWindow ?? 200_000;
  const contextUsed = active?.contextTokens ?? charEstimateTokens;
  const ctxPct = Math.min(100, (contextUsed / contextMax) * 100);
  const ctxIsEstimate = active?.contextTokens == null;

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
                {/* Sprint 1: dropdown replaces chip row. Future multi-user
                 *  phase will need to lock this to the current user's agents. */}
                <select
                  className="session-filter-select"
                  value={agentFilter}
                  onChange={e => setAgentFilter(e.target.value)}
                  title="Filter sessions by agent"
                >
                  <option value="all">All agents</option>
                  {agentOptions.map(id => {
                    const agent = agents.find(a => a.id === id);
                    const label = agent?.identity?.name ?? agent?.name ?? id;
                    return <option key={id} value={id}>{label}</option>;
                  })}
                </select>
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
        {sessions && sessions.length > 0 && (
          <div className="session-filters" style={{ borderTop: 0 }}>
            <div className="session-filter-row">
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--ink2)', cursor: 'pointer' }}
                title="Stub sessions with no messages are hidden by default to keep the list focused"
              >
                <input
                  type="checkbox"
                  checked={showEmpty}
                  onChange={e => setShowEmpty(e.target.checked)}
                  style={{ margin: 0 }}
                />
                Show empty stubs
              </label>
            </div>
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
                title={s.key}
              >
                <div className="session-title">
                  {shortenSessionLabel(s)}
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
            <div className="chat-welcome">
              <div style={{ color: 'var(--ink2)', fontSize: '11px', marginBottom: '8px' }}>
                Ready when you are.
              </div>
              <div className="welcome-suggestions">
                {[
                  'Summarize my recent sessions',
                  'What can you do?',
                  'Check system health',
                ].map(suggestion => (
                  <button
                    key={suggestion}
                    className="chip"
                    onClick={() => setComposer(suggestion)}
                  >{suggestion}</button>
                ))}
              </div>
            </div>
          )}
          {(() => { void pinnedTick; return null; })()}
          {visibleMessages.map((m, idx) => {
            const isPinned = pinnedRef.current?.has(idx) ?? false;
            const isTool = m.role === 'tool' || m.role === 'system';
            const avatarLabel = m.role === 'user' ? 'U' : isTool ? '🔧' : 'D';
            return (
              <div key={m.id} className={`msg ${m.role === 'user' ? 'user' : ''} ${isPinned ? 'pinned' : ''} ${isTool ? 'tool' : ''}`}>
                <div className="msg-avatar">{avatarLabel}</div>
                <div>
                  {m.text && (
                    <div className="msg-body" style={{ whiteSpace: 'pre-wrap', opacity: isTool ? 0.75 : 1, fontFamily: isTool ? 'var(--fm)' : undefined, fontSize: isTool ? '11px' : undefined }}>
                      {m.text}
                      {m.streaming && <span className="streaming-cursor" />}
                    </div>
                  )}
                  {m.toolCalls?.map((tc, i) => (
                    <div
                      key={`${m.id}:tool:${i}`}
                      style={{
                        marginTop: '4px',
                        padding: '4px 8px',
                        background: 'var(--bg2, rgba(255,255,255,0.04))',
                        border: '1px solid var(--bord)',
                        borderRadius: '3px',
                        fontFamily: 'var(--fm)',
                        fontSize: '11px',
                        color: 'var(--ink2)',
                      }}
                    >
                      <span style={{ color: 'var(--acc)', marginRight: '6px' }}>🔧</span>
                      {summarizeToolBlock(tc)}
                    </div>
                  ))}
                  <div className="msg-time">
                    {m.ts ? fmtTime(m.ts) : ''}
                    {m.streaming ? (m.ts ? ' · streaming…' : 'streaming…') : ''}
                    {activeKey && (
                      <button
                        className="msg-pin"
                        onClick={() => {
                          pinnedRef.current?.toggle(idx);
                          setPinnedTick(t => t + 1);
                        }}
                        title={isPinned ? 'Unpin' : 'Pin this message'}
                        style={{
                          marginLeft: '8px',
                          background: 'transparent',
                          border: 'none',
                          color: isPinned ? 'var(--acc)' : 'var(--ink2)',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: '11px',
                        }}
                      >{isPinned ? '★' : '☆'}</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
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
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>Model:</span>
              <select
                value={modelSelectState.currentOverride}
                onChange={e => handleModelChange(e.target.value)}
                disabled={!activeKey}
                style={{
                  background: 'transparent',
                  color: 'var(--acc)',
                  fontFamily: 'var(--fm)',
                  border: '1px solid var(--bord)',
                  padding: '2px 4px',
                  fontSize: '11px',
                  maxWidth: '180px',
                }}
                title={modelSelectState.currentOverride || modelSelectState.defaultLabel}
              >
                <option value="">{modelSelectState.defaultLabel}</option>
                {modelSelectState.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}>
              <span>Thinking:</span>
              <select
                value={currentThinking}
                onChange={e => handleThinkingChange(e.target.value)}
                disabled={!activeKey}
                style={{
                  background: 'transparent',
                  color: 'var(--acc)',
                  border: '1px solid var(--bord)',
                  padding: '2px 4px',
                  fontSize: '11px',
                }}
              >
                <option value="">default</option>
                {thinkingLevels.map(level => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
            <label
              style={{ marginLeft: '8px', display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', cursor: 'pointer' }}
              title="Show or hide tool-call messages in the thread"
            >
              <input
                type="checkbox"
                checked={showTools}
                onChange={e => setShowTools(e.target.checked)}
                style={{ margin: 0 }}
              />
              Show Tools
            </label>
            {errorMsg && (
              <span style={{ marginLeft: '8px', color: 'var(--err)' }}>{errorMsg}</span>
            )}
            {active && (
              <span
                style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                title={`Context used: ${contextUsed.toLocaleString()} / ${contextMax.toLocaleString()} tokens${ctxIsEstimate ? ' (estimated)' : ''}`}
              >
                <span style={{ color: 'var(--ink2)' }}>ctx</span>
                <span style={{ width: '64px', height: '6px', background: 'var(--surf2)', borderRadius: '3px', overflow: 'hidden', display: 'inline-block' }}>
                  <span style={{ display: 'block', height: '100%', width: `${ctxPct}%`, background: 'var(--acc)' }} />
                </span>
                <span style={{ color: 'var(--ink2)' }}>{ctxPct.toFixed(0)}%{ctxIsEstimate ? ' est' : ''}</span>
              </span>
            )}
            <button
              className="btn"
              style={{ marginLeft: active ? '8px' : 'auto', padding: '3px 8px', fontSize: '10px' }}
              onClick={handleExport}
              disabled={messages.length === 0}
              title="Download conversation as Markdown"
            >⤓ Export</button>
            <button
              className="btn"
              style={{ padding: '3px 8px', fontSize: '10px' }}
              onClick={handleAbort}
              disabled={!active?.hasActiveRun}
            >✕ Abort</button>
            <button
              className={`btn ${canvasOpen ? 'btn-on' : ''}`}
              style={{ padding: '3px 8px', fontSize: '10px' }}
              onClick={() => {
                // Opening pulls in the latest HTML from the thread; closing just hides it.
                if (!canvasOpen) seedCanvasFromSession();
                setCanvasOpen(!canvasOpen);
              }}
              disabled={!activeKey}
              title="Toggle the design canvas alongside this chat (picks up the latest HTML from the thread)"
            >⬚ Canvas</button>
          </div>
          <div className="survival-stats">
            <div className="surv-stat"><div className="surv-dot h"></div><div className="surv-bar"><div className="surv-fill h"></div></div></div>
            <div className="surv-stat"><div className="surv-dot w"></div><div className="surv-bar"><div className="surv-fill w"></div></div></div>
            <div className="surv-stat"><div className="surv-dot c"></div><div className="surv-bar"><div className="surv-fill c"></div></div></div>
            <div className="surv-stat"><div className="surv-dot f"></div><div className="surv-bar"><div className="surv-fill f"></div></div></div>
          </div>
          <div className="composer-row" style={{ position: 'relative' }}>
            {slashMatches.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  background: 'var(--bg, #1a1a1a)',
                  border: '1px solid var(--bord)',
                  borderRadius: '3px',
                  maxHeight: '240px',
                  overflowY: 'auto',
                  fontSize: '11px',
                  zIndex: 10,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}
              >
                {slashMatches.map((cmd, i) => (
                  <div
                    key={cmd.key}
                    onMouseEnter={() => setSlashHover(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setComposer(`/${cmd.key}${cmd.args ? ' ' : ''}`);
                      composerRef.current?.focus();
                    }}
                    style={{
                      padding: '6px 10px',
                      cursor: 'pointer',
                      background: i === slashHover ? 'var(--bord)' : 'transparent',
                      display: 'flex',
                      gap: '12px',
                      alignItems: 'baseline',
                    }}
                  >
                    <span style={{ color: 'var(--acc)', fontFamily: 'var(--fm)' }}>
                      /{cmd.key}{cmd.args ? ` ${cmd.args}` : ''}
                    </span>
                    <span style={{ color: 'var(--ink2)' }}>{cmd.description}</span>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={composerRef}
              placeholder={activeKey ? 'Message Deltron… (Enter to send, Shift+Enter for newline, ↑ for history, / for commands)' : 'Select a session to chat…'}
              value={composer}
              onChange={e => {
                setComposer(e.target.value);
                resetChatInputHistoryNavigation(inputHistoryStateRef.current);
              }}
              disabled={!activeKey || sending}
              onKeyDown={e => {
                // Slash palette navigation takes precedence when open.
                if (slashMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashHover(h => Math.min(h + 1, slashMatches.length - 1));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashHover(h => Math.max(h - 1, 0));
                    return;
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const cmd = slashMatches[slashHover];
                    if (cmd) {
                      setComposer(`/${cmd.key}${cmd.args ? ' ' : ''}`);
                    }
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setComposer('');
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                  // Keep focus on the composer so the user can keep typing
                  // without re-clicking. handleSend clears the value but a
                  // disabled→re-enabled cycle during `sending` can drop focus.
                  requestAnimationFrame(() => composerRef.current?.focus());
                  return;
                }
                if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && activeKey) {
                  const target = e.currentTarget;
                  const result = handleChatInputHistoryKey(inputHistoryStateRef.current, {
                    key: e.key,
                    selectionStart: target.selectionStart ?? 0,
                    selectionEnd: target.selectionEnd ?? 0,
                    valueLength: target.value.length,
                    altKey: e.altKey,
                    ctrlKey: e.ctrlKey,
                    metaKey: e.metaKey,
                    shiftKey: e.shiftKey,
                    isComposing: e.nativeEvent.isComposing,
                    keyCode: (e.nativeEvent as KeyboardEvent).keyCode ?? 0,
                  });
                  if (result.preventDefault) {
                    e.preventDefault();
                  }
                  if (result.handled) {
                    const recalled = inputHistoryStateRef.current.chatMessage;
                    setComposer(recalled);
                    // Move caret to end on up-recall, start on down-clear.
                    requestAnimationFrame(() => {
                      if (composerRef.current) {
                        const pos = result.restoreCaret === 'up' ? recalled.length : 0;
                        composerRef.current.setSelectionRange(pos, pos);
                      }
                    });
                  }
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

      {canvasOpen && activeKey ? (
        <div
          className={`chat-canvas-panel ${resizingCanvas ? 'resizing' : ''}`}
          style={{ width: `${canvasWidth}px` }}
        >
          <div className="chat-canvas-resize" onMouseDown={startCanvasResize} title="Drag to resize" />
          <DesignCanvas
            key={activeKey}
            storageId={activeKey}
            seedHTML={canvasSeed && canvasSeed.key === activeKey ? canvasSeed.html : null}
            seedLabel={canvasSeed && canvasSeed.key === activeKey ? canvasSeed.label : undefined}
            onClose={() => setCanvasOpen(false)}
            compact={canvasWidth < 560}
          />
        </div>
      ) : (
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
            <div style={{ marginTop: '4px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button
                className="btn btn-ghost"
                style={{ width: '100%', fontSize: '11px' }}
                title="Open the design canvas alongside this chat, seeded with the latest assistant HTML"
                onClick={openCanvasWithLatestHTML}
              >⬚ Open in Canvas</button>
              <button
                className="btn btn-ghost"
                style={{ width: '100%', fontSize: '11px' }}
                title="Switch to voice mode; the Talk screen will show this session as the source"
                onClick={() => {
                  navigateTo('talk', {
                    fromSessionKey: active.key,
                    fromDisplayName: active.displayName ?? active.derivedTitle ?? active.key,
                    ts: new Date().toISOString(),
                  });
                }}
              >◉ Switch to voice</button>
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
                    setErrorMsg(null);
                    refreshSessions();
                  } catch (e) {
                    // The gateway requires operator.admin scope for sessions.delete. UI
                    // tokens won't have it — surface a clear message instead of silently
                    // swallowing the error (which was making the button look broken).
                    const raw = e instanceof Error ? e.message : String(e);
                    const friendly = /operator\.admin|missing scope/i.test(raw)
                      ? 'Archive requires operator.admin scope on the gateway token. Ask the gateway admin to grant it, or use the CLI to archive.'
                      : `Archive failed: ${raw}`;
                    setErrorMsg(friendly);
                  }
                }}
              >Archive Session</button>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}
