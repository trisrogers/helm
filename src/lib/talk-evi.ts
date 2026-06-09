/**
 * Talk "Cloud" mode — Hume EVI integration.
 *
 * EVI is the fast, themed *mouth and ears* (native speech-to-speech, barge-in).
 * OpenClaw stays the *deep brain*: EVI calls bridged tools, and anything beyond a
 * quick status read is delegated to a real openclaw agent session via ask_openclaw,
 * whose reply EVI then voices. This is the "all-in-one" path the spike validated
 * (see memory project_talk_evi_verdict).
 *
 * Auth: dev serves VITE_HUME_API_KEY (from .env.development.local) and connects
 * with apiKey auth. Prod (vite --mode prod) has no key in the bundle and instead
 * mints a short-lived access token from the sidecar's /hume/token route.
 */

import { useCallback, useState } from 'react';
import type { ToolCallHandler } from '@humeai/voice-react';
import type { Theme } from '../types';
import type { OpenClawClient } from './openclaw-client';

/* ── Cloud/Local mode toggle (persisted) ───────────────────────────── */

export type TalkMode = 'cloud' | 'local';
const MODE_KEY = 'helm:talk-mode';

/** Talk transport preference. Default Cloud (EVI); persisted across reloads. */
export function useTalkMode(): [TalkMode, (m: TalkMode) => void] {
  const [mode, setMode] = useState<TalkMode>(
    () => (localStorage.getItem(MODE_KEY) as TalkMode) || 'cloud',
  );
  const set = useCallback((m: TalkMode) => {
    localStorage.setItem(MODE_KEY, m);
    setMode(m);
  }, []);
  return [mode, set];
}

/* ── config + auth ─────────────────────────────────────────────────── */

export const EVI_CONFIG_BY_THEME: Record<Theme, string | undefined> = {
  assay: import.meta.env.VITE_HUME_CONFIG_ASSAY as string | undefined,
  politburo: import.meta.env.VITE_HUME_CONFIG_POLITBURO as string | undefined,
  blizzard: import.meta.env.VITE_HUME_CONFIG_BLIZZARD as string | undefined,
};

const DEV_API_KEY = import.meta.env.VITE_HUME_API_KEY as string | undefined;

export function eviConfigured(theme: Theme): boolean {
  return !!EVI_CONFIG_BY_THEME[theme];
}

export type HumeAuth = { type: 'apiKey'; value: string } | { type: 'accessToken'; value: string };

/**
 * Resolve EVI credentials. Dev: the inlined API key. Prod: a short-lived access
 * token minted server-side (the API/secret keys never reach the browser). The
 * token route is same-origin in both modes via the vite /hume/token proxy.
 */
export async function resolveHumeAuth(): Promise<HumeAuth> {
  if (DEV_API_KEY) return { type: 'apiKey', value: DEV_API_KEY };
  const res = await fetch('/hume/token');
  if (!res.ok) {
    throw new Error(`token mint failed (${res.status}). Is the sidecar /hume/token route configured?`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('token mint returned no access_token');
  return { type: 'accessToken', value: body.access_token };
}

/* ── openclaw tool bridge ──────────────────────────────────────────── */

interface AgentEventFrame {
  sessionKey?: string;
  runId?: string;
  stream?: 'assistant' | 'lifecycle' | string;
  data?: { text?: string; phase?: string } & Record<string, unknown>;
}

// EVI tool name → direct openclaw RPC for snappy status reads.
const FAST_TOOLS: Record<string, string> = {
  get_camp_status: 'channels.status',
  list_sessions: 'sessions.list',
  get_usage: 'usage.status',
};

// Ceiling on a single agent turn before we give up listening. Generous, because
// ask_openclaw can do a lot of tool work before its first token (first assistant
// text routinely lands 60s+ after send) and EVI voices the reply via
// sendAssistantInput while its tool call stays pending. A too-tight cap (was 60s)
// previously fired before the agent's first token, tore the stream listener down,
// and returned the "already spoken" sentinel — so the real reply was never voiced.
const ASK_TIMEOUT_MS = 180_000;

// Prepended to every ask_openclaw turn so the agent replies in spoken-friendly
// prose (its text is synthesized verbatim, so markdown/lists read badly aloud).
const VOICE_DIRECTIVE =
  '[Voice relay — your reply is spoken aloud by text-to-speech as you write it. Use ' +
  'brief, natural spoken sentences. No markdown, lists, headings, code blocks, ' +
  'asterisks, or emoji. Do not prefix your reply with a name or speaker label.]';

// Returned as the tool result once the answer has already been streamed to EVI's
// voice, so the supplemental LLM doesn't read the whole thing back a second time.
const STREAMED_SENTINEL =
  '[Delivered. The full answer has already been spoken to the user, verbatim, as it ' +
  'streamed. Do NOT repeat, summarize, paraphrase, or read any of it back — reply ' +
  'with nothing, or at most one short natural closing remark if clearly warranted.]';

/** Split newly-arrived cumulative text into complete sentences from `from`.
 *  A sentence is complete only once trailing whitespace/newline follows its
 *  terminator, so we never speak a half-formed token mid-stream. */
function nextSentences(text: string, from: number): { sentences: string[]; consumed: number } {
  const sub = text.slice(from);
  const boundary = /[.!?]+["')\]]*\s+|\n+/g;
  const sentences: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(sub)) !== null) {
    const end = m.index + m[0].length;
    const chunk = sub.slice(last, end).trim();
    if (chunk) sentences.push(chunk);
    last = end;
  }
  return { sentences, consumed: from + last };
}

export interface BridgeCallbacks {
  /** Each tool invocation, for the on-screen activity log. */
  onTool?: (entry: { name: string; ok: boolean; ms: number; detail: string }) => void;
  /** When set, ask_openclaw streams the agent's reply here sentence-by-sentence
   *  (wired to EVI's sendAssistantInput) instead of returning it all at once. */
  onSpeak?: (text: string) => void;
}

/**
 * Bridges EVI tool calls to the live gateway. Fast reads hit a single RPC;
 * ask_openclaw runs a full agent turn on a persistent session and returns the
 * agent's text for EVI to voice. One bridge per EVI session; call dispose() on teardown.
 */
export class OpenclawVoiceBridge {
  private sessionKey: string | null = null;
  private offAgent: (() => void) | null = null;
  private readonly client: OpenClawClient;
  private readonly agentId: string;
  private readonly cb: BridgeCallbacks;

  constructor(client: OpenClawClient, agentId: string, cb: BridgeCallbacks = {}) {
    this.client = client;
    this.agentId = agentId;
    this.cb = cb;
  }

  /** Delegated to VoiceProvider's onToolCall: (message, { success, error }). */
  onToolCall: ToolCallHandler = async (msg, send) => {
    const started = performance.now();
    let args: Record<string, unknown> = {};
    try { args = msg.parameters ? JSON.parse(msg.parameters) : {}; } catch { /* ignore */ }

    const fail = (error: string, code: string) => {
      this.cb.onTool?.({ name: msg.name, ok: false, ms: Math.round(performance.now() - started), detail: error });
      return send.error({ error, code, level: 'warn', content: error });
    };

    try {
      let content: string;
      if (msg.name === 'ask_openclaw') {
        const request = typeof args.request === 'string' ? args.request : '';
        if (!request) return fail('ask_openclaw called without a request', 'bad_args');
        content = await this.askOpenclaw(request);
      } else if (FAST_TOOLS[msg.name]) {
        content = JSON.stringify(await this.client.call(FAST_TOOLS[msg.name]));
      } else {
        return fail(`no bridge for tool "${msg.name}"`, 'unknown_tool');
      }
      const ms = Math.round(performance.now() - started);
      const detail = content === STREAMED_SENTINEL ? 'spoken live (streamed)' : content.slice(0, 300);
      this.cb.onTool?.({ name: msg.name, ok: true, ms, detail });
      return send.success(content);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e), 'rpc_error');
    }
  };

  /** Run one full agent turn on a persistent session. When onSpeak is wired, the
   *  reply is streamed to EVI sentence-by-sentence as it generates and resolves
   *  with a sentinel; otherwise it resolves with the full text (spoken at the end). */
  private async askOpenclaw(request: string): Promise<string> {
    await this.ensureSession();
    const key = this.sessionKey!;
    const onSpeak = this.cb.onSpeak;
    return new Promise<string>((resolve, reject) => {
      let runId: string | null = null;
      let text = '';
      let spokenUpTo = 0;
      let pending = '';     // complete sentences awaiting a big-enough chunk to speak
      let settled = false;
      const finish = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); off(); this.offAgent = null; fn(); };

      // Hand EVI reasonably-sized chunks rather than one tiny sendAssistantInput per
      // sentence: rapid-fire fragments make EVI clip mid-utterance (it starts one,
      // then the next input cuts it off). Coalesce complete sentences until they
      // reach MIN_SPEAK chars, then emit. On `final`, flush whatever's left —
      // pending sentences plus any trailing partial — so the tail always completes.
      const MIN_SPEAK = 120;
      const speakNew = (final: boolean) => {
        if (!onSpeak) return;
        if (text.length < spokenUpTo) spokenUpTo = text.length; // agent rewrote/shrank — don't re-speak
        const { sentences, consumed } = nextSentences(text, spokenUpTo);
        spokenUpTo = consumed;
        for (const s of sentences) {
          pending = pending ? `${pending} ${s}` : s;
          if (pending.length >= MIN_SPEAK) { onSpeak(pending); pending = ''; }
        }
        if (final) {
          const tail = text.slice(spokenUpTo).trim();
          if (tail) pending = pending ? `${pending} ${tail}` : tail;
          spokenUpTo = text.length;
          if (pending) { onSpeak(pending); pending = ''; }
        }
      };

      const off = this.client.on('agent', (payload) => {
        const p = payload as AgentEventFrame;
        if (p.sessionKey !== key || !runId || p.runId !== runId) return;
        if (p.stream === 'assistant' && typeof p.data?.text === 'string') {
          text = p.data.text;
          speakNew(false);
        } else if (p.stream === 'lifecycle' && p.data?.phase === 'end') {
          speakNew(true);
          finish(() => resolve(onSpeak ? STREAMED_SENTINEL : (text.trim() || 'The agent completed without a reply.')));
        }
      });
      this.offAgent = off; // so dispose() can cancel a mid-flight ask

      const timer = setTimeout(() => {
        speakNew(true);
        finish(() => resolve(onSpeak ? STREAMED_SENTINEL : (text.trim() || 'The request is taking too long; still working on it.')));
      }, ASK_TIMEOUT_MS);

      this.client
        .call<{ runId?: string }>('sessions.send', { key, message: `${VOICE_DIRECTIVE}\n\n${request}` })
        .then((r) => { runId = r.runId ?? null; if (!runId) finish(() => reject(new Error('sessions.send returned no runId'))); })
        .catch((err) => finish(() => reject(err as Error)));
    });
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionKey) return;
    const res = await this.client.call<{ key?: string; sessionKey?: string }>('sessions.create', {
      agentId: this.agentId,
    });
    const key = res.key ?? res.sessionKey;
    if (!key) throw new Error('sessions.create returned no key');
    this.sessionKey = key;
    await this.client.call('sessions.messages.subscribe', { key });
  }

  dispose(): void {
    this.offAgent?.();
    this.offAgent = null;
  }
}
