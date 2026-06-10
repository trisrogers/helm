/**
 * Canvas block protocol for iterative design in chat (CR-002).
 *
 * When the design canvas is open beside a chat, outgoing messages carry a
 * Helm-specific guideline (wrapped in [canvas-context]…[/canvas-context]) that
 * tells the model to reply with the COMPLETE updated HTML document inside
 * [canvas]…[/canvas] tags. Incoming messages are split so the document is
 * pumped into the canvas editor instead of being rendered as a wall of HTML
 * in the transcript.
 */

export const CANVAS_OPEN_TAG = '[canvas]';
export const CANVAS_CLOSE_TAG = '[/canvas]';

const CONTEXT_OPEN_TAG = '[canvas-context]';
const CONTEXT_CLOSE_TAG = '[/canvas-context]';

export interface CanvasSplit {
  /** Message text with all [canvas] blocks removed — what the bubble shows. */
  visible: string;
  /** The last complete [canvas] document, or null if none. */
  html: string | null;
  /** True when the text ends in an unclosed [canvas] block (mid-stream). */
  pending: boolean;
}

/** Collapse the blank lines left behind where a block was cut out. */
function tidy(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/** Split a message into its visible text and its [canvas] document payload.
 *  The last complete block wins (the model may self-correct); an unclosed
 *  trailing block is treated as still streaming and hidden from view. */
export function splitCanvasBlocks(text: string): CanvasSplit {
  if (!text) return { visible: '', html: null, pending: false };

  // Optionally swallow a code fence the model wrapped around the block.
  const blockRe = /(?:```[A-Za-z0-9]*[ \t]*\n?)?\[canvas\]\s*([\s\S]*?)\s*\[\/canvas\](?:\n?[ \t]*```)?/g;
  let html: string | null = null;
  let visible = '';
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    visible += text.slice(cursor, m.index);
    cursor = m.index + m[0].length;
    if (m[1].trim()) html = m[1].trim();
  }
  let rest = text.slice(cursor);

  // An open tag in the remainder means a block is still streaming in.
  const openIdx = rest.indexOf(CANVAS_OPEN_TAG);
  const pending = openIdx !== -1;
  if (pending) rest = rest.slice(0, openIdx).replace(/```[A-Za-z0-9]*[ \t]*$/, '');

  return { visible: tidy(visible + rest), html, pending };
}

/** Build the Helm-specific guideline appended to outgoing chat messages while
 *  the canvas is open. When the user has hand-edited the document in the
 *  canvas editor, pass it as `currentDoc` so the model iterates on what's
 *  actually on screen rather than its own last reply. */
export function buildCanvasDirective(currentDoc: string | null): string {
  const lines = [
    CONTEXT_OPEN_TAG,
    'Helm design canvas guideline: an HTML design canvas with a source editor is open',
    'beside this chat. If this message asks for design/HTML changes, reply with the',
    'COMPLETE updated HTML document — never a fragment, a diff, or "replace X with Y"',
    `instructions — wrapped exactly in ${CANVAS_OPEN_TAG} … ${CANVAS_CLOSE_TAG} tags. Keep any commentary brief`,
    'and OUTSIDE the tags. If no design change is requested, reply normally without the tags.',
  ];
  if (currentDoc) {
    lines.push(
      'The user has edited the document in the canvas. Iterate on THIS current document:',
      CANVAS_OPEN_TAG,
      currentDoc,
      CANVAS_CLOSE_TAG,
    );
  }
  lines.push(CONTEXT_CLOSE_TAG);
  return lines.join('\n');
}

/** Strip the [canvas-context] directive from a user message for display. */
export function stripCanvasContext(text: string): string {
  if (!text.includes(CONTEXT_OPEN_TAG)) return text;
  return tidy(text.replace(/\[canvas-context\][\s\S]*?\[\/canvas-context\]/g, ''));
}
