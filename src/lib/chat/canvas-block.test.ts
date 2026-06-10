import { describe, expect, it } from 'vitest';
import {
  buildCanvasDirective,
  splitCanvasBlocks,
  stripCanvasContext,
} from './canvas-block';

const DOC = '<!doctype html>\n<html><body><h1>Hi</h1></body></html>';

describe('splitCanvasBlocks', () => {
  it('passes plain text through untouched', () => {
    const r = splitCanvasBlocks('Just a normal reply.');
    expect(r).toEqual({ visible: 'Just a normal reply.', html: null, pending: false });
  });

  it('extracts a [canvas] block and strips it from the visible text', () => {
    const r = splitCanvasBlocks(`Here's the update.\n[canvas]\n${DOC}\n[/canvas]\nDone.`);
    expect(r.html).toBe(DOC);
    expect(r.visible).toBe("Here's the update.\n\nDone.");
    expect(r.pending).toBe(false);
  });

  it('returns the last block when there are several, stripping all of them', () => {
    const first = '<html><body>v1</body></html>';
    const r = splitCanvasBlocks(`[canvas]${first}[/canvas]\nactually:\n[canvas]${DOC}[/canvas]`);
    expect(r.html).toBe(DOC);
    expect(r.visible).toBe('actually:');
  });

  it('tolerates a code fence wrapped around the block', () => {
    const r = splitCanvasBlocks('Update:\n```html\n[canvas]\n' + DOC + '\n[/canvas]\n```\n');
    expect(r.html).toBe(DOC);
    expect(r.visible).toBe('Update:');
  });

  it('flags an unclosed block as pending and hides the partial payload', () => {
    const r = splitCanvasBlocks('Working on it.\n[canvas]\n<!doctype html>\n<html><bo');
    expect(r.pending).toBe(true);
    expect(r.html).toBeNull();
    expect(r.visible).toBe('Working on it.');
  });

  it('handles empty input', () => {
    expect(splitCanvasBlocks('')).toEqual({ visible: '', html: null, pending: false });
  });
});

describe('buildCanvasDirective', () => {
  it('wraps the guideline in [canvas-context] tags', () => {
    const d = buildCanvasDirective(null);
    expect(d.startsWith('[canvas-context]')).toBe(true);
    expect(d.endsWith('[/canvas-context]')).toBe(true);
    expect(d).toContain('[canvas]');
    expect(d).toContain('COMPLETE');
  });

  it('embeds the current document when provided', () => {
    const d = buildCanvasDirective(DOC);
    expect(d).toContain(DOC);
    expect(buildCanvasDirective(null)).not.toContain('<h1>Hi</h1>');
  });
});

describe('stripCanvasContext', () => {
  it('removes the directive block from a user message', () => {
    const msg = `make the header blue\n\n${buildCanvasDirective(DOC)}`;
    expect(stripCanvasContext(msg)).toBe('make the header blue');
  });

  it('leaves messages without a directive alone', () => {
    expect(stripCanvasContext('hello')).toBe('hello');
  });
});
