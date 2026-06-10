import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenClawClient, HELM_TOKEN_STORAGE_KEY } from './openclaw-client';

/**
 * Controllable WebSocket fake. Tests drive the lifecycle by calling the
 * handler props directly (open / message / close), mirroring how the browser
 * fires them.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; }

  // test helpers
  emitChallenge() {
    this.onmessage?.({ data: JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n' } }) });
  }
  lastFrame(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
  respond(id: string, ok: boolean, payloadOrError: unknown) {
    this.onmessage?.({
      data: JSON.stringify(ok
        ? { type: 'res', id, ok: true, payload: payloadOrError }
        : { type: 'res', id, ok: false, error: payloadOrError }),
    });
  }
  emitEvent(event: string, payload: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type: 'event', event, payload }) });
  }
  emitClose(code = 1006, reason = '') {
    this.onclose?.({ code, reason });
  }
}

function authenticate(ws: FakeWebSocket, snapshot: unknown = { stateVersion: { presence: 1, health: 1 } }) {
  ws.emitChallenge();
  const frame = ws.lastFrame();
  ws.respond(frame.id as string, true, { server: { version: '9.9.9' }, snapshot });
  return frame;
}

describe('OpenClawClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('answers connect.challenge with a protocol-4 operator connect frame carrying the token', () => {
    const client = new OpenClawClient('tok-123');
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.emitChallenge();

    const frame = ws.lastFrame();
    expect(frame.type).toBe('req');
    expect(frame.method).toBe('connect');
    const params = frame.params as Record<string, unknown>;
    expect(params.minProtocol).toBe(4);
    expect(params.maxProtocol).toBe(4);
    expect(params.role).toBe('operator');
    expect((params.client as Record<string, unknown>).id).toBe('openclaw-control-ui');
    expect((params.auth as Record<string, unknown>).token).toBe('tok-123');
    client.destroy();
  });

  it('omits auth when constructed with an empty token', () => {
    const client = new OpenClawClient('');
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.emitChallenge();
    expect((ws.lastFrame().params as Record<string, unknown>).auth).toBeUndefined();
    client.destroy();
  });

  it('transitions to connected and exposes snapshot + server version on hello', () => {
    const client = new OpenClawClient('tok');
    const statuses: string[] = [];
    client.onStatus(s => statuses.push(s));
    client.connect();
    authenticate(FakeWebSocket.instances[0]);

    expect(client.status).toBe('connected');
    expect(client.serverVersion).toBe('9.9.9');
    expect(client.snapshot).toMatchObject({ stateVersion: { presence: 1 } });
    expect(statuses).toEqual(['connecting', 'connected']);
    client.destroy();
  });

  it('sets auth_failed on an unauthorized connect response and does NOT reconnect', () => {
    const client = new OpenClawClient('bad');
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.emitChallenge();
    ws.respond(ws.lastFrame().id as string, false, { message: 'unauthorized: bad token' });

    expect(client.status).toBe('auth_failed');
    expect(ws.closed).toBe(true);
    ws.emitClose();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    client.destroy();
  });

  it('resolves call() with the response payload and rejects on RPC error', async () => {
    const client = new OpenClawClient('tok');
    client.connect();
    const ws = FakeWebSocket.instances[0];
    authenticate(ws);

    const p1 = client.call<{ ok: boolean }>('sessions.list');
    let id = ws.lastFrame().id as string;
    ws.respond(id, true, { ok: true });
    await expect(p1).resolves.toEqual({ ok: true });

    const p2 = client.call('sessions.list');
    id = ws.lastFrame().id as string;
    ws.respond(id, false, { message: 'boom' });
    await expect(p2).rejects.toThrow('boom');
    client.destroy();
  });

  it('throws from call() when not connected', async () => {
    const client = new OpenClawClient('tok');
    await expect(client.call('x')).rejects.toThrow('Not connected');
    client.destroy();
  });

  it('rejects pending calls and schedules a backoff reconnect on close', async () => {
    const client = new OpenClawClient('tok');
    client.connect();
    const ws = FakeWebSocket.instances[0];
    authenticate(ws);

    const pending = client.call('sessions.list');
    ws.emitClose();
    await expect(pending).rejects.toThrow('Connection closed');
    expect(client.status).toBe('disconnected');

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // backoff doubles: second drop reconnects after 2s, not 1s
    const ws2 = FakeWebSocket.instances[1];
    ws2.emitClose();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    client.destroy();
  });

  it('resets the backoff after a successful connect', () => {
    const client = new OpenClawClient('tok');
    client.connect();
    const ws = FakeWebSocket.instances[0];
    authenticate(ws);
    ws.emitClose();
    vi.advanceTimersByTime(1000);
    const ws2 = FakeWebSocket.instances[1];
    authenticate(ws2); // success → delay back to 1s
    ws2.emitClose();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    client.destroy();
  });

  it('closes a socket whose connect phase never completes (15s timeout)', () => {
    const client = new OpenClawClient('tok');
    client.connect();
    const ws = FakeWebSocket.instances[0];
    // gateway never sends connect.challenge
    vi.advanceTimersByTime(15_000);
    expect(ws.closed).toBe(true);
    // recovery routes through onclose → reconnect
    ws.emitClose();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.destroy();
  });

  it('does not fire the connect timeout once connected', () => {
    const client = new OpenClawClient('tok');
    client.connect();
    const ws = FakeWebSocket.instances[0];
    authenticate(ws);
    vi.advanceTimersByTime(60_000);
    expect(ws.closed).toBe(false);
    client.destroy();
  });

  it('ignores events from a stale socket after a new connect', () => {
    const client = new OpenClawClient('tok');
    client.connect();
    const stale = FakeWebSocket.instances[0];
    authenticate(stale);
    stale.emitClose();
    vi.advanceTimersByTime(1000);
    const fresh = FakeWebSocket.instances[1];
    authenticate(fresh);

    // stale handlers firing late must not clobber the live connection
    stale.emitClose();
    expect(client.status).toBe('connected');
    client.destroy();
  });

  it('dispatches events to named and wildcard handlers, and unsubscribes', () => {
    const client = new OpenClawClient('tok');
    client.connect();
    const ws = FakeWebSocket.instances[0];
    authenticate(ws);

    const named = vi.fn();
    const wildcard = vi.fn();
    const offNamed = client.on('health', named);
    client.on('*', wildcard);

    ws.emitEvent('health', { up: true });
    expect(named).toHaveBeenCalledWith({ up: true });
    expect(wildcard).toHaveBeenCalledTimes(1);

    offNamed();
    ws.emitEvent('health', { up: false });
    expect(named).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it('destroy() stops reconnect attempts for good', () => {
    const client = new OpenClawClient('tok');
    client.connect();
    const ws = FakeWebSocket.instances[0];
    authenticate(ws);
    ws.emitClose();
    client.destroy();
    vi.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('stores and clears the token in localStorage', () => {
    OpenClawClient.setStoredToken('abc');
    expect(localStorage.getItem(HELM_TOKEN_STORAGE_KEY)).toBe('abc');
    expect(OpenClawClient.getStoredToken()).toBe('abc');
    OpenClawClient.setStoredToken('');
    expect(localStorage.getItem(HELM_TOKEN_STORAGE_KEY)).toBeNull();
    expect(OpenClawClient.getStoredToken()).toBe('');
  });
});
