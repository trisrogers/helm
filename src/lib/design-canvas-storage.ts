/* Storage for the design canvas: one JSON blob per canvas, keyed by
 * storageId. A standalone design scratchpad and each chat session get their
 * own bucket. Shared between the DesignCanvas component (owns the state) and
 * Chat (reads the current doc to send as iteration context, CR-002). */

export interface DesignVersion {
  id: string;
  label: string;
  html: string;
  savedAt: number;
}

export interface CanvasState {
  content: string;
  versions: DesignVersion[];
  activeId: string | null;
}

export const canvasKey = (storageId: string) => `helm:design:canvas:${storageId}`;

export const DEFAULT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Untitled design</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0; padding: 32px;
      background: #f7f8fa; color: #1a1a2a;
    }
    h1 { color: #1a6bbf; margin: 0 0 8px; }
    p { line-height: 1.6; color: #444; }
    .card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); max-width: 480px; }
    button { background: #1a6bbf; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello from the Design Bureau</h1>
    <p>Edit the source on the left, preview on the right. Save a snapshot to keep iterations around.</p>
    <button>A button</button>
  </div>
</body>
</html>`;

export function loadCanvasState(storageId: string): CanvasState {
  try {
    const raw = localStorage.getItem(canvasKey(storageId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const versions = Array.isArray(parsed.versions)
          ? parsed.versions.filter((v: unknown): v is DesignVersion =>
              !!v && typeof v === 'object'
              && typeof (v as DesignVersion).id === 'string'
              && typeof (v as DesignVersion).label === 'string'
              && typeof (v as DesignVersion).html === 'string')
          : [];
        return {
          content: typeof parsed.content === 'string' ? parsed.content : DEFAULT_HTML,
          versions,
          activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
        };
      }
    }
  } catch { /* fall through */ }
  return { content: DEFAULT_HTML, versions: [], activeId: null };
}

export function saveCanvasState(storageId: string, state: CanvasState) {
  try { localStorage.setItem(canvasKey(storageId), JSON.stringify(state)); }
  catch { /* ignore quota */ }
}

/** The canvas's current document, or null when the canvas was never touched
 *  (no stored state) — callers use this to decide whether there is anything
 *  worth sending as iteration context. */
export function loadCanvasDoc(storageId: string): string | null {
  try {
    if (!localStorage.getItem(canvasKey(storageId))) return null;
  } catch { return null; }
  const content = loadCanvasState(storageId).content.trim();
  return content || null;
}
