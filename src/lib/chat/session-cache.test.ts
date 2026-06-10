import { beforeEach, describe, expect, it } from 'vitest';
import {
  getCachedSessions, setCachedSessions, clearSessionsCache,
  getCachedHistory, setCachedHistory, clearHistoryCache,
} from './session-cache';

describe('session-cache', () => {
  beforeEach(() => {
    clearSessionsCache();
    clearHistoryCache();
  });

  it('round-trips the sessions snapshot and clears it', () => {
    expect(getCachedSessions()).toBeNull();
    setCachedSessions([{ key: 'a' }]);
    expect(getCachedSessions()?.rows).toEqual([{ key: 'a' }]);
    expect(getCachedSessions()?.fetchedAt).toBeTypeOf('number');
    clearSessionsCache();
    expect(getCachedSessions()).toBeNull();
  });

  it('caches history per key and misses on unknown keys', () => {
    setCachedHistory('s1', [{ id: 1 }]);
    expect(getCachedHistory('s1')).toEqual([{ id: 1 }]);
    expect(getCachedHistory('nope')).toBeNull();
  });

  it('evicts the least-recently-used entry past the cap of 10', () => {
    for (let i = 0; i < 10; i++) setCachedHistory(`s${i}`, [i]);
    // touch s0 so it becomes most-recent
    getCachedHistory('s0');
    setCachedHistory('s10', [10]); // evicts s1, not s0
    expect(getCachedHistory('s0')).toEqual([0]);
    expect(getCachedHistory('s1')).toBeNull();
    expect(getCachedHistory('s10')).toEqual([10]);
  });

  it('re-setting an existing key refreshes its recency', () => {
    for (let i = 0; i < 10; i++) setCachedHistory(`s${i}`, [i]);
    setCachedHistory('s0', ['updated']);
    setCachedHistory('s10', [10]); // evicts s1
    expect(getCachedHistory('s0')).toEqual(['updated']);
    expect(getCachedHistory('s1')).toBeNull();
  });
});
