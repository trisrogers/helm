import { describe, expect, it } from 'vitest';
import { extractText, extractTextCached, extractThinking } from './message-extract';

describe('message-extract', () => {
  it('returns string content directly', () => {
    expect(extractText({ content: 'plain' })).toBe('plain');
  });

  it('joins text blocks from content arrays', () => {
    expect(extractText({
      content: ['lead', { type: 'text', text: 'a' }, { type: 'other', text: 'b' }, { type: 'image' }],
    })).toBe('lead\na\nb');
  });

  it('falls back to .text and returns null when nothing matches', () => {
    expect(extractText({ text: 'fallback' })).toBe('fallback');
    expect(extractText({ content: [{ type: 'image' }] })).toBeNull();
    expect(extractText(null)).toBeNull();
    expect(extractText('not an object')).toBeNull();
  });

  it('caches per message object', () => {
    const msg = { content: 'cached' };
    expect(extractTextCached(msg)).toBe('cached');
    // mutate after caching — cached value must win (WeakMap identity)
    (msg as { content: string }).content = 'changed';
    expect(extractTextCached(msg)).toBe('cached');
  });

  it('extracts thinking blocks only', () => {
    expect(extractThinking({
      content: [
        { type: 'thinking', thinking: '  step one  ' },
        { type: 'text', text: 'visible' },
        { type: 'thinking', thinking: 'step two' },
      ],
    })).toBe('step one\nstep two');
    expect(extractThinking({ content: 'plain' })).toBeNull();
    expect(extractThinking({ content: [{ type: 'thinking', thinking: '   ' }] })).toBeNull();
  });
});
