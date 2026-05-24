/**
 * Simplified message text extraction. The upstream version
 * (`openclaw-src/ui/src/ui/chat/message-extract.ts`) strips envelopes,
 * internal runtime context, inbound metadata, and thinking tags via deps
 * in `src/shared/` and `src/agents/`. We skip that here because the gateway
 * normally emits clean text to UI clients; if you see envelope markers or
 * `<think>` tags leaking into the React surface, vendor the full chain.
 */

const textCache = new WeakMap<object, string | null>();

export function extractRawText(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }
  const m = message as Record<string, unknown>;
  const content = m.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block);
        continue;
      }
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push(b.text);
        } else if (typeof b.text === 'string') {
          parts.push(b.text);
        }
      }
    }
    if (parts.length > 0) {
      return parts.join('\n');
    }
  }
  if (typeof m.text === 'string') {
    return m.text;
  }
  return null;
}

export function extractText(message: unknown): string | null {
  return extractRawText(message);
}

export function extractTextCached(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return extractText(message);
  }
  if (textCache.has(message)) {
    return textCache.get(message) ?? null;
  }
  const value = extractText(message);
  textCache.set(message, value);
  return value;
}

export function extractThinking(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return null;
  }
  const parts: string[] = [];
  for (const p of content) {
    const item = p as Record<string, unknown>;
    if (item.type === 'thinking' && typeof item.thinking === 'string') {
      const cleaned = item.thinking.trim();
      if (cleaned) {
        parts.push(cleaned);
      }
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
}
