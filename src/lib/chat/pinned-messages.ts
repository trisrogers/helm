import { getSafeLocalStorage } from './local-storage';

const PREFIX = 'openclaw:pinned:';

/**
 * Per-session pinned messages, keyed by stable message id. Earlier versions
 * stored indices into the *filtered* visible list, which silently migrated
 * pins onto the wrong messages whenever streaming inserted rows or the
 * tool-visibility filter changed. Persisted numeric (index) data from those
 * versions is discarded on load.
 */
export class PinnedMessages {
  private key: string;
  private pinnedIds = new Set<string>();

  constructor(sessionKey: string) {
    this.key = PREFIX + sessionKey;
    this.load();
  }

  get ids(): Set<string> {
    return this.pinnedIds;
  }

  has(id: string): boolean {
    return this.pinnedIds.has(id);
  }

  pin(id: string): void {
    this.pinnedIds.add(id);
    this.save();
  }

  unpin(id: string): void {
    this.pinnedIds.delete(id);
    this.save();
  }

  toggle(id: string): void {
    if (this.pinnedIds.has(id)) {
      this.unpin(id);
    } else {
      this.pin(id);
    }
  }

  clear(): void {
    this.pinnedIds.clear();
    this.save();
  }

  private load(): void {
    try {
      const raw = getSafeLocalStorage()?.getItem(this.key);
      if (!raw) {
        return;
      }
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        this.pinnedIds = new Set(arr.filter((v) => typeof v === 'string'));
      }
    } catch {
      // ignore
    }
  }

  private save(): void {
    try {
      getSafeLocalStorage()?.setItem(this.key, JSON.stringify([...this.pinnedIds]));
    } catch {
      // ignore
    }
  }
}
