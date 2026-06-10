import { describe, expect, it } from 'vitest';
import {
  handleChatInputHistoryKey,
  recordNonTranscriptInputHistory,
  resetChatInputHistoryNavigation,
  type ChatInputHistoryState,
  type ChatInputHistoryKeyInput,
} from './input-history';

function makeState(overrides: Partial<ChatInputHistoryState> = {}): ChatInputHistoryState {
  return {
    sessionKey: 'sess-1',
    chatLoading: false,
    chatMessage: '',
    chatMessages: [],
    chatLocalInputHistoryBySession: {},
    chatInputHistorySessionKey: null,
    chatInputHistoryItems: null,
    chatInputHistoryIndex: -1,
    chatDraftBeforeHistory: null,
    ...overrides,
  };
}

function key(input: Partial<ChatInputHistoryKeyInput> = {}): ChatInputHistoryKeyInput {
  return {
    key: 'ArrowUp',
    selectionStart: 0,
    selectionEnd: 0,
    valueLength: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 38,
    ...input,
  };
}

const userMsg = (text: string, ts: number) => ({ role: 'user', content: text, timestamp: ts });

describe('chat input history', () => {
  it('ArrowUp at caret 0 enters history with the newest user message', () => {
    const state = makeState({
      chatMessage: 'my draft',
      chatMessages: [userMsg('oldest', 1), { role: 'assistant', content: 'x' }, userMsg('newest', 2)],
    });
    const result = handleChatInputHistoryKey(state, key());
    expect(result.decision).toBe('handled:enter-history-up');
    expect(state.chatMessage).toBe('newest');
    expect(state.chatDraftBeforeHistory).toBe('my draft');

    // a second Up walks further back; Down returns; final Down restores draft
    state.chatMessage = 'newest';
    handleChatInputHistoryKey(state, key());
    expect(state.chatMessage).toBe('oldest');
    handleChatInputHistoryKey(state, key({ key: 'ArrowDown', keyCode: 40 }));
    expect(state.chatMessage).toBe('newest');
    handleChatInputHistoryKey(state, key({ key: 'ArrowDown', keyCode: 40 }));
    expect(state.chatMessage).toBe('my draft');
    expect(state.chatInputHistoryIndex).toBe(-1);
  });

  it('deduplicates repeated entries and merges local (unsent) history first', () => {
    const state = makeState({
      chatMessages: [userMsg('repeat', 1), userMsg('repeat', 2)],
    });
    recordNonTranscriptInputHistory(state, '  local entry  ');
    handleChatInputHistoryKey(state, key());
    expect(state.chatMessage).toBe('local entry'); // newest (Date.now) and trimmed
    handleChatInputHistoryKey(state, key());
    expect(state.chatMessage).toBe('repeat');
    // boundary: no third distinct item
    const r = handleChatInputHistoryKey(state, key());
    expect(r.decision).toBe('blocked:history-boundary');
  });

  it('does not record consecutive duplicate local entries', () => {
    const state = makeState();
    recordNonTranscriptInputHistory(state, 'same');
    recordNonTranscriptInputHistory(state, 'same');
    recordNonTranscriptInputHistory(state, '   ');
    expect(state.chatLocalInputHistoryBySession['sess-1']).toHaveLength(1);
  });

  it('blocks navigation while loading, with modifiers, mid-text, or with a selection', () => {
    const loaded = { chatMessages: [userMsg('x', 1)] };
    expect(handleChatInputHistoryKey(makeState({ ...loaded, chatLoading: true }), key()).decision)
      .toBe('blocked:history-loading');
    expect(handleChatInputHistoryKey(makeState(loaded), key({ ctrlKey: true })).decision)
      .toBe('blocked:modifier-or-composition');
    expect(handleChatInputHistoryKey(makeState(loaded), key({ isComposing: true })).decision)
      .toBe('blocked:modifier-or-composition');
    expect(handleChatInputHistoryKey(makeState(loaded), key({ selectionStart: 2, selectionEnd: 5 })).decision)
      .toBe('blocked:selection-range');
    expect(handleChatInputHistoryKey(makeState(loaded), key({ selectionStart: 3, selectionEnd: 3 })).decision)
      .toBe('blocked:arrowup-not-at-start');
    expect(handleChatInputHistoryKey(makeState(loaded), key({ key: 'ArrowDown', keyCode: 40 })).decision)
      .toBe('blocked:arrowdown-editing-mode');
  });

  it('resets stale navigation when the session or the text changed under it', () => {
    const state = makeState({ chatMessages: [userMsg('hist', 1)] });
    handleChatInputHistoryKey(state, key());
    expect(state.chatInputHistoryIndex).toBe(0);

    // user edits the recalled text → next keypress resets navigation first
    state.chatMessage = 'hist edited';
    const r = handleChatInputHistoryKey(state, key({ selectionStart: 0 }));
    expect(r.historyNavigationActiveBefore).toBe(false);
    expect(r.decision).toBe('handled:enter-history-up');

    resetChatInputHistoryNavigation(state);
    expect(state.chatInputHistoryIndex).toBe(-1);
    expect(state.chatInputHistoryItems).toBeNull();
  });

  it('returns blocked:history-boundary when there is no history at all', () => {
    const r = handleChatInputHistoryKey(makeState(), key());
    expect(r.decision).toBe('blocked:history-boundary');
    expect(r.handled).toBe(false);
  });
});
