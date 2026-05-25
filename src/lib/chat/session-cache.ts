/**
 * In-memory cache for chat data — survives Chat-screen unmount/remount
 * so navigating away and back doesn't re-trigger a 5-10s gateway round
 * trip before showing anything.
 *
 * - Sessions list: single most-recent snapshot (rows + fetchedAt).
 * - History: LRU map keyed by session key, capped at HISTORY_CAP entries.
 *
 * Both are pure module-level state; the Chat screen renders from cache
 * first (instant), then kicks off a background refresh to keep things
 * current. There's no TTL — staleness is fixed by the background fetch.
 */

const HISTORY_CAP = 10;

interface CachedSessions<TRow> {
  rows: TRow[];
  fetchedAt: number;
}

let sessionsCache: CachedSessions<unknown> | null = null;

export function getCachedSessions<TRow>(): CachedSessions<TRow> | null {
  return sessionsCache as CachedSessions<TRow> | null;
}

export function setCachedSessions<TRow>(rows: TRow[]): void {
  sessionsCache = { rows, fetchedAt: Date.now() };
}

/** Drop the sessions cache — useful when the user changes gateway / disconnects. */
export function clearSessionsCache(): void {
  sessionsCache = null;
}

/* ── history LRU ─────────────────────────────────────────────── */

// Map iteration order is insertion order; re-inserting a key bumps it to
// the back, which gives us the LRU semantics we want.
const historyCache = new Map<string, unknown[]>();

export function getCachedHistory<TMsg>(key: string): TMsg[] | null {
  if (!historyCache.has(key)) return null;
  const value = historyCache.get(key) as TMsg[];
  // Refresh recency by re-inserting.
  historyCache.delete(key);
  historyCache.set(key, value);
  return value;
}

export function setCachedHistory<TMsg>(key: string, msgs: TMsg[]): void {
  if (historyCache.has(key)) historyCache.delete(key);
  historyCache.set(key, msgs);
  while (historyCache.size > HISTORY_CAP) {
    const oldestKey = historyCache.keys().next().value;
    if (oldestKey === undefined) break;
    historyCache.delete(oldestKey);
  }
}

export function clearHistoryCache(): void {
  historyCache.clear();
}
