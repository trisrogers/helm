import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenclawVoiceBridge, type BridgeCallbacks } from './talk-evi';
import type { OpenClawClient } from './openclaw-client';

type AgentHandler = (payload: unknown) => void;

/** Minimal gateway client fake: scripted RPC responses + manual agent events. */
function makeFakeClient() {
  const agentHandlers = new Set<AgentHandler>();
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const responses: Record<string, unknown> = {
    'sessions.create': { key: 'sess-1' },
    'sessions.messages.subscribe': { subscribed: true },
    'sessions.send': { runId: 'run-1' },
    'channels.status': { channels: [] },
  };
  const client = {
    call: vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method in responses) return responses[method];
      throw new Error(`unexpected RPC ${method}`);
    }),
    on: vi.fn((event: string, h: AgentHandler) => {
      if (event !== 'agent') throw new Error(`unexpected event sub ${event}`);
      agentHandlers.add(h);
      return () => agentHandlers.delete(h);
    }),
  };
  const emitAgent = (payload: unknown) => agentHandlers.forEach(h => h(payload));
  return { client: client as unknown as OpenClawClient, calls, responses, emitAgent, agentHandlers };
}

function makeSend() {
  return {
    success: vi.fn((content: string) => ({ kind: 'success', content })),
    error: vi.fn((e: unknown) => ({ kind: 'error', e })),
  };
}

const toolCall = (name: string, parameters: unknown) => ({
  name,
  parameters: JSON.stringify(parameters),
}) as never;

describe('OpenclawVoiceBridge', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('routes fast tools to their RPC and reports to the activity log', async () => {
    const { client } = makeFakeClient();
    const onTool = vi.fn();
    const bridge = new OpenclawVoiceBridge(client, 'agent-1', { onTool });
    const send = makeSend();

    await bridge.onToolCall(toolCall('get_camp_status', {}), send as never);
    expect(client.call).toHaveBeenCalledWith('channels.status');
    expect(send.success).toHaveBeenCalledWith(JSON.stringify({ channels: [] }));
    expect(onTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'get_camp_status', ok: true }));
  });

  it('rejects unknown tools and bad ask_openclaw args via send.error', async () => {
    const { client } = makeFakeClient();
    const bridge = new OpenclawVoiceBridge(client, 'agent-1');
    const send = makeSend();

    await bridge.onToolCall(toolCall('not_a_tool', {}), send as never);
    expect(send.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'unknown_tool' }));

    await bridge.onToolCall(toolCall('ask_openclaw', {}), send as never);
    expect(send.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'bad_args' }));
  });

  it('runs an ask_openclaw turn: session once, voice directive prefixed, answer voiced after resolve', async () => {
    const fake = makeFakeClient();
    const onSpeak = vi.fn();
    const bridge = new OpenclawVoiceBridge(fake.client, 'agent-1', { onSpeak });
    const send = makeSend();

    const pending = bridge.onToolCall(toolCall('ask_openclaw', { request: 'how are the channels?' }), send as never);
    await vi.advanceTimersByTimeAsync(0); // let create/subscribe/send resolve

    const sent = fake.calls.find(c => c.method === 'sessions.send');
    expect(sent?.params.key).toBe('sess-1');
    expect(sent?.params.message).toMatch(/^\[Voice relay/);
    expect(sent?.params.message).toContain('how are the channels?');

    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-1', stream: 'assistant', data: { text: 'All quiet' } });
    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-1', stream: 'lifecycle', data: { phase: 'end' } });
    await pending;

    // sentinel resolves the tool; the real answer goes out via onSpeak afterwards
    expect(send.success).toHaveBeenCalledWith(expect.stringContaining('Delivered out-of-band'));
    expect(onSpeak).toHaveBeenCalledWith('All quiet');

    // second ask reuses the session
    const second = bridge.onToolCall(toolCall('ask_openclaw', { request: 'again' }), send as never);
    await vi.advanceTimersByTimeAsync(0);
    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-1', stream: 'lifecycle', data: { phase: 'end' } });
    await second;
    expect(fake.calls.filter(c => c.method === 'sessions.create')).toHaveLength(1);
  });

  it('returns the answer as the tool result when no onSpeak is wired', async () => {
    const fake = makeFakeClient();
    const bridge = new OpenclawVoiceBridge(fake.client, 'agent-1');
    const send = makeSend();

    const pending = bridge.onToolCall(toolCall('ask_openclaw', { request: 'hi' }), send as never);
    await vi.advanceTimersByTimeAsync(0);
    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-1', stream: 'assistant', data: { text: 'Hello there' } });
    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-1', stream: 'lifecycle', data: { phase: 'end' } });
    await pending;
    expect(send.success).toHaveBeenCalledWith('Hello there');
  });

  it('ignores agent events for other sessions and runs', async () => {
    const fake = makeFakeClient();
    const bridge = new OpenclawVoiceBridge(fake.client, 'agent-1');
    const send = makeSend();

    const pending = bridge.onToolCall(toolCall('ask_openclaw', { request: 'q' }), send as never);
    await vi.advanceTimersByTimeAsync(0);
    fake.emitAgent({ sessionKey: 'other', runId: 'run-1', stream: 'assistant', data: { text: 'WRONG' } });
    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-2', stream: 'assistant', data: { text: 'WRONG' } });
    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-1', stream: 'assistant', data: { text: 'RIGHT' } });
    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-1', stream: 'lifecycle', data: { phase: 'end' } });
    await pending;
    expect(send.success).toHaveBeenCalledWith('RIGHT');
  });

  it('caps a silent agent turn at 180s with a still-working message', async () => {
    const fake = makeFakeClient();
    const bridge = new OpenclawVoiceBridge(fake.client, 'agent-1');
    const send = makeSend();

    const pending = bridge.onToolCall(toolCall('ask_openclaw', { request: 'slow' }), send as never);
    await vi.advanceTimersByTimeAsync(180_000);
    await pending;
    expect(send.success).toHaveBeenCalledWith(expect.stringContaining('taking too long'));
  });

  it('keeps concurrent ask_openclaw listeners independent (regression: single offAgent slot)', async () => {
    const fake = makeFakeClient();
    const answers: string[] = [];
    const cb: BridgeCallbacks = { onSpeak: t => answers.push(t) };
    const bridge = new OpenclawVoiceBridge(fake.client, 'agent-1', cb);
    const send = makeSend();

    fake.responses['sessions.send'] = { runId: 'run-A' };
    const askA = bridge.onToolCall(toolCall('ask_openclaw', { request: 'a' }), send as never);
    await vi.advanceTimersByTimeAsync(0);
    fake.responses['sessions.send'] = { runId: 'run-B' };
    const askB = bridge.onToolCall(toolCall('ask_openclaw', { request: 'b' }), send as never);
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.agentHandlers.size).toBe(2);

    // finish B first — A's listener must survive
    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-B', stream: 'assistant', data: { text: 'answer B' } });
    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-B', stream: 'lifecycle', data: { phase: 'end' } });
    await askB;
    expect(fake.agentHandlers.size).toBe(1);

    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-A', stream: 'assistant', data: { text: 'answer A' } });
    fake.emitAgent({ sessionKey: 'sess-1', runId: 'run-A', stream: 'lifecycle', data: { phase: 'end' } });
    await askA;
    expect(answers).toEqual(['answer B', 'answer A']);
    expect(fake.agentHandlers.size).toBe(0);
  });

  it('dispose() cancels every in-flight listener', async () => {
    const fake = makeFakeClient();
    const bridge = new OpenclawVoiceBridge(fake.client, 'agent-1');
    const send = makeSend();

    fake.responses['sessions.send'] = { runId: 'run-A' };
    void bridge.onToolCall(toolCall('ask_openclaw', { request: 'a' }), send as never);
    await vi.advanceTimersByTimeAsync(0);
    fake.responses['sessions.send'] = { runId: 'run-B' };
    void bridge.onToolCall(toolCall('ask_openclaw', { request: 'b' }), send as never);
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.agentHandlers.size).toBe(2);
    bridge.dispose();
    expect(fake.agentHandlers.size).toBe(0);
  });
});
