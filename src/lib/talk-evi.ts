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

// Returned as the ask_openclaw tool result so EVI's supplemental LLM stays quiet
// instead of reading the answer back. We voice the answer ourselves (one
// sendAssistantInput) AFTER resolving the tool — see onToolCall.
const SILENCE_SENTINEL =
  '[Delivered out-of-band. The answer is being spoken to the user directly. Do NOT ' +
  'repeat, summarize, paraphrase, or read any of it back — reply with nothing, or at ' +
  'most one short natural closing remark if clearly warranted.]';

export interface BridgeCallbacks {
  /** Each tool invocation, for the on-screen activity log. */
  onTool?: (entry: { name: string; ok: boolean; ms: number; detail: string }) => void;
  /** When set, the ask_openclaw answer is voiced through here (wired to EVI's
   *  sendAssistantInput) as a single utterance AFTER the tool call resolves, so
   *  EVI is idle and actually synthesizes it. Streaming mid-turn doesn't work:
   *  assistant_input sent while EVI's tool call is pending lands in the transcript
   *  but its audio is dropped/clipped. */
  onSpeak?: (text: string) => void;
}

/**
 * Bridges EVI tool calls to the live gateway. Fast reads hit a single RPC;
 * ask_openclaw runs a full agent turn on a persistent session and returns the
 * agent's text for EVI to voice. One bridge per EVI session; call dispose() on teardown.
 */
export class OpenclawVoiceBridge {
  private sessionKey: string | null = null;
  // One unsubscribe per in-flight ask_openclaw — EVI can chain tool calls, so a
  // single slot would get stomped by a concurrent ask and leak its listener.
  private readonly offAgents = new Set<() => void>();
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
      if (msg.name === 'ask_openclaw') {
        const request = typeof args.request === 'string' ? args.request : '';
        if (!request) return fail('ask_openclaw called without a request', 'bad_args');
        const answer = await this.askOpenclaw(request);
        const ms = Math.round(performance.now() - started);
        if (this.cb.onSpeak) {
          // Resolve the tool FIRST (sentinel → EVI stays quiet), THEN voice the
          // whole answer as one utterance into the now-idle session. Voicing
          // before the tool resolves (mid-turn streaming) gets the audio dropped.
          this.cb.onTool?.({ name: msg.name, ok: true, ms, detail: 'voiced after resolve' });
          const res = send.success(SILENCE_SENTINEL);
          this.cb.onSpeak(answer);
          return res;
        }
        this.cb.onTool?.({ name: msg.name, ok: true, ms, detail: answer.slice(0, 300) });
        return send.success(answer);
      }
      if (FAST_TOOLS[msg.name]) {
        const content = JSON.stringify(await this.client.call(FAST_TOOLS[msg.name]));
        this.cb.onTool?.({ name: msg.name, ok: true, ms: Math.round(performance.now() - started), detail: content.slice(0, 300) });
        return send.success(content);
      }
      return fail(`no bridge for tool "${msg.name}"`, 'unknown_tool');
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e), 'rpc_error');
    }
  };

  /** Run one full agent turn on a persistent session and resolve with the agent's
   *  final reply text. The caller voices it (see onToolCall) after resolving the
   *  EVI tool call — mid-turn streaming into a pending tool call gets audio-dropped. */
  private async askOpenclaw(request: string): Promise<string> {
    await this.ensureSession();
    const key = this.sessionKey!;
    return new Promise<string>((resolve, reject) => {
      let runId: string | null = null;
      let text = '';
      let settled = false;
      const finish = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); off(); this.offAgents.delete(off); fn(); };

      const off = this.client.on('agent', (payload) => {
        const p = payload as AgentEventFrame;
        if (p.sessionKey !== key || !runId || p.runId !== runId) return;
        if (p.stream === 'assistant' && typeof p.data?.text === 'string') {
          text = p.data.text;
        } else if (p.stream === 'lifecycle' && p.data?.phase === 'end') {
          finish(() => resolve(text.trim() || 'The agent completed without a reply.'));
        }
      });
      this.offAgents.add(off); // so dispose() can cancel a mid-flight ask

      const timer = setTimeout(() => {
        finish(() => resolve(text.trim() || 'The request is taking too long; still working on it.'));
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
    for (const off of this.offAgents) off();
    this.offAgents.clear();
  }
}
