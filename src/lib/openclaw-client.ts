export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'auth_failed'
  | 'error';

export interface GatewaySnapshot {
  presence: unknown[];
  health: unknown;
  stateVersion: { presence: number; health: number };
  uptimeMs: number;
  configPath?: string;
  stateDir?: string;
  sessionDefaults?: {
    defaultAgentId: string;
    mainKey: string;
    mainSessionKey: string;
  };
  authMode?: 'none' | 'token' | 'password' | 'trusted-proxy';
}

type EventHandler = (payload: unknown) => void;
type StatusHandler = (s: ConnectionStatus) => void;

// Connect through Vite's proxy so the request arrives at the gateway as a
// loopback connection — bypasses the WSL2 Windows-browser origin check.
const GATEWAY_WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws-gateway`;
const CLIENT_VERSION = '0.1.0';
const PROTOCOL_VERSION = 4;

// uuid() requires a secure context; over plain HTTP on a tailnet
// host it's undefined. crypto.getRandomValues works everywhere.
function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
}
export const HELM_TOKEN_STORAGE_KEY = 'helm:token';

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private gone = false;

  status: ConnectionStatus = 'disconnected';
  snapshot: GatewaySnapshot | null = null;
  serverVersion: string | null = null;

  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  connect() {
    if (this.ws || this.gone) return;
    this.setStatus('connecting');

    const ws = new WebSocket(GATEWAY_WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      console.log('[helm-ws] open');
    };

    ws.onmessage = (e: MessageEvent<string>) => {
      console.log('[helm-ws] message:', e.data.slice(0, 200));
      let frame: Record<string, unknown>;
      try { frame = JSON.parse(e.data) as Record<string, unknown>; } catch { return; }

      // Gateway sends connect.challenge first; respond with a req frame wrapping ConnectParams.
      // The response arrives as a normal res frame — register it in pending so it's routed below.
      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        const connectId = uuid();
        this.pending.set(connectId, {
          resolve: (payload) => {
            const hello = payload as { type?: string; server?: { version: string }; snapshot?: GatewaySnapshot };
            this.snapshot = hello.snapshot ?? null;
            this.serverVersion = hello.server?.version ?? null;
            this.reconnectDelay = 1000;
            this.setStatus('connected');
          },
          reject: (err) => {
            const msg = err.message ?? '';
            if (msg.includes('unauthorized') || msg.includes('auth') || msg.includes('token')) {
              this.setStatus('auth_failed');
            } else {
              this.setStatus('error');
            }
            ws.close();
          },
        });
        ws.send(JSON.stringify({
          type: 'req',
          id: connectId,
          method: 'connect',
          params: {
            minProtocol: PROTOCOL_VERSION,
            maxProtocol: PROTOCOL_VERSION,
            client: {
              id: 'openclaw-control-ui',
              displayName: 'The Helm',
              version: CLIENT_VERSION,
              platform: 'browser',
              mode: 'ui',
            },
            role: 'operator',
            scopes: ['operator.read', 'operator.write', 'operator.approvals'],
            auth: this.token ? { token: this.token } : undefined,
          },
        }));
        return;
      }

      if (frame.type === 'res') {
        const id = frame.id as string;
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          if (frame.ok) {
            p.resolve(frame.payload);
          } else {
            const err = frame.error as { message?: string } | undefined;
            p.reject(new Error(err?.message ?? 'RPC error'));
          }
        }
        return;
      }

      if (frame.type === 'event') {
        const event = frame.event as string;
        this.eventHandlers.get(event)?.forEach(h => h(frame.payload));
        this.eventHandlers.get('*')?.forEach(h => h(frame));
      }
    };

    ws.onclose = (e) => {
      console.log('[helm-ws] close code=' + e.code + ' reason=' + e.reason);
      this.ws = null;
      this.pending.forEach(({ reject }) => reject(new Error('Connection closed')));
      this.pending.clear();
      if (!this.gone && this.status !== 'auth_failed') {
        this.setStatus('disconnected');
        this.scheduleReconnect();
      }
    };

    ws.onerror = (e) => { console.log('[helm-ws] error', e); this.setStatus('error'); };
  }

  private scheduleReconnect() {
    if (this.gone || this.status === 'auth_failed') return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || this.status !== 'connected') {
      throw new Error('Not connected');
    }
    const id = uuid();
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    return promise;
  }

  on(event: string, handler: EventHandler): () => void {
    let set = this.eventHandlers.get(event);
    if (!set) { set = new Set(); this.eventHandlers.set(event, set); }
    set.add(handler);
    return () => this.eventHandlers.get(event)?.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    this.statusHandlers.forEach(h => h(s));
  }

  destroy() {
    this.gone = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  static getStoredToken(): string {
    return localStorage.getItem(HELM_TOKEN_STORAGE_KEY) ?? '';
  }

  static setStoredToken(token: string) {
    if (token) {
      localStorage.setItem(HELM_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(HELM_TOKEN_STORAGE_KEY);
    }
  }
}
