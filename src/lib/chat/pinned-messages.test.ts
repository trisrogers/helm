import { beforeEach, describe, expect, it } from 'vitest';
import { PinnedMessages } from './pinned-messages';

const KEY = 'openclaw:pinned:sess-1';

describe('PinnedMessages', () => {
  beforeEach(() => localStorage.clear());

  it('pins, unpins and toggles by message id, persisting per session', () => {
    const pins = new PinnedMessages('sess-1');
    pins.pin('msg-a');
    pins.toggle('msg-b');
    expect(pins.has('msg-a')).toBe(true);
    expect(pins.has('msg-b')).toBe(true);

    pins.toggle('msg-b');
    expect(pins.has('msg-b')).toBe(false);

    // fresh instance re-reads what was persisted
    const reloaded = new PinnedMessages('sess-1');
    expect(reloaded.has('msg-a')).toBe(true);
    expect(reloaded.has('msg-b')).toBe(false);
    expect([...reloaded.ids]).toEqual(['msg-a']);
  });

  it('keeps sessions isolated', () => {
    new PinnedMessages('sess-1').pin('msg-a');
    expect(new PinnedMessages('sess-2').has('msg-a')).toBe(false);
  });

  it('discards legacy index-based (numeric) pin data', () => {
    localStorage.setItem(KEY, JSON.stringify([0, 3, 7]));
    const pins = new PinnedMessages('sess-1');
    expect(pins.ids.size).toBe(0);
  });

  it('ignores corrupt or non-array payloads', () => {
    localStorage.setItem(KEY, '{nope');
    expect(new PinnedMessages('sess-1').ids.size).toBe(0);
    localStorage.setItem(KEY, '{"a":1}');
    expect(new PinnedMessages('sess-1').ids.size).toBe(0);
  });

  it('clear() empties and persists', () => {
    const pins = new PinnedMessages('sess-1');
    pins.pin('msg-a');
    pins.clear();
    expect(new PinnedMessages('sess-1').ids.size).toBe(0);
  });
});
