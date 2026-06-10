import { describe, expect, it } from 'vitest';
import { buildChatMarkdown } from './export';

describe('buildChatMarkdown', () => {
  it('returns null for empty or non-array input', () => {
    expect(buildChatMarkdown([], 'DELTRON')).toBeNull();
    expect(buildChatMarkdown(undefined as never, 'DELTRON')).toBeNull();
  });

  it('maps roles to You / assistant name / Tool', () => {
    const md = buildChatMarkdown([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'tool', content: 'ran a thing' },
    ], 'DELTRON')!;
    expect(md).toContain('# Chat with DELTRON');
    expect(md).toContain('## You');
    expect(md).toContain('## DELTRON');
    expect(md).toContain('## Tool');
    expect(md).toContain('hello');
  });

  it('formats timestamps from raw .timestamp and DisplayMsg .ts alike', () => {
    const t = Date.UTC(2026, 5, 10, 4, 0, 0);
    const md = buildChatMarkdown([
      { role: 'user', content: 'raw', timestamp: t },
      { role: 'assistant', content: 'display', ts: t },
      { role: 'user', content: 'none' },
    ], 'A')!;
    const stamps = md.match(/2026-06-10T04:00:00\.000Z/g) ?? [];
    expect(stamps).toHaveLength(2);
    expect(md).toContain('## You\n\nnone');
  });

  it('extracts text from content block arrays', () => {
    const md = buildChatMarkdown([
      { role: 'assistant', content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }] },
    ], 'A')!;
    expect(md).toContain('part one\npart two');
  });
});
