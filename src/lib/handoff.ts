/**
 * Lightweight cross-screen handoff. Used when one screen wants to send
 * the user (and a payload) to another. We keep this client-side only
 * for now — the lightest-touch fold per Tris's IA call — so Design and
 * Talk stay as their own screens while gaining a "continue here from
 * Chat" affordance.
 *
 * Wire:
 *   navigateTo('design', { html: '...' })
 *      ↓ dispatches `helm:nav` (App listens, switches screen)
 *      ↓ writes localStorage key `helm:handoff:design`
 *   target screen on mount → consumeHandoff('design') → state seeded.
 */
import type { ScreenId } from '../types';

const KEY_PREFIX = 'helm:handoff:';
const NAV_EVENT = 'helm:nav';

export interface DesignHandoff {
  html?: string;
  /** Where the payload came from, for display in the target screen. */
  sourceLabel?: string;
  /** Always a wall-clock ISO so stale handoffs can be ignored. */
  ts: string;
}

export interface TalkHandoff {
  /** The chat session key that initiated the handoff. Talk uses its own
   *  session id internally — this is just for a "continuing from…" banner. */
  fromSessionKey: string;
  fromDisplayName?: string;
  ts: string;
}

interface HandoffMap {
  design: DesignHandoff;
  talk: TalkHandoff;
}

/** Write a handoff payload, then dispatch the nav event so App switches
 *  to the target screen. */
export function navigateTo<S extends keyof HandoffMap>(screen: S, payload: HandoffMap[S]): void;
export function navigateTo(screen: ScreenId): void;
export function navigateTo(screen: ScreenId, payload?: unknown): void {
  if (payload) {
    try { localStorage.setItem(`${KEY_PREFIX}${screen}`, JSON.stringify(payload)); }
    catch { /* quota */ }
  }
  window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { screen } }));
}

/** Read-and-clear a handoff payload for a given screen. Returns null if none. */
export function consumeHandoff<S extends keyof HandoffMap>(screen: S): HandoffMap[S] | null {
  const key = `${KEY_PREFIX}${screen}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    localStorage.removeItem(key);
    return JSON.parse(raw) as HandoffMap[S];
  } catch {
    return null;
  }
}

/** Subscribe to navigation events. App uses this to flip its screen state. */
export function onNavigate(handler: (screen: ScreenId) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ screen?: ScreenId }>).detail;
    if (detail?.screen) handler(detail.screen);
  };
  window.addEventListener(NAV_EVENT, listener);
  return () => window.removeEventListener(NAV_EVENT, listener);
}

/** Detect whether a snippet of text looks like a full HTML document. */
export function looksLikeHTML(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.startsWith('<!doctype')) return true;
  if (t.startsWith('<html')) return true;
  if (t.startsWith('<body')) return true;
  // Anything with both an opening and closing tag of the same kind
  // counts as "HTML enough" for a Design seed.
  return /<([a-z][a-z0-9]*)\b[^>]*>[\s\S]*<\/\1>/i.test(t);
}

/** Extract HTML from an assistant message — looks for fenced code blocks
 *  first (any language tag), picks the first one that looks like HTML;
 *  otherwise tries to slice out an HTML doc from the surrounding prose;
 *  falls back to returning the trimmed message when it already looks
 *  like an HTML document. Returns null if nothing usable was found. */
export function extractHTMLFromAssistantText(text: string): string | null {
  if (!text) return null;

  // 1) Scan every fenced block (```html, ```HTML, ```, ~~~) and return the
  //    first one whose body looks like HTML. Walking all blocks fixes the
  //    case where Claude writes an explanation block first, then the HTML.
  const fenceRe = /(?:```|~~~)\s*([A-Za-z0-9]*)\s*\n([\s\S]*?)\n(?:```|~~~)/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const lang = m[1]?.toLowerCase() ?? '';
    const body = m[2] ?? '';
    // Explicit html/htm language tag wins; otherwise sniff.
    if (lang === 'html' || lang === 'htm') return body.trim();
    if (!lang && looksLikeHTML(body)) return body.trim();
  }

  // 2) Try to slice a bare HTML doc out of mixed prose: from the first
  //    <!doctype/<html/<body to the last </html> or </body>.
  const docMatch = text.match(/(<!doctype html[\s\S]*?<\/html>|<html\b[\s\S]*?<\/html>|<body\b[\s\S]*?<\/body>)/i);
  if (docMatch) return docMatch[1].trim();

  // 3) Whole-message fallback if the trimmed text itself looks like HTML.
  if (looksLikeHTML(text)) return text.trim();

  return null;
}
