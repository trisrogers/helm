import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTask, updateTask, deleteTask, loadTasks,
  createGoal, deleteGoal, loadGoals,
  addCommentary, loadCommentary, commentaryFor,
  goalProgress, tasksForGoal, onStoreChange,
} from './helm-store';

const flushMicrotasks = () => new Promise<void>(r => queueMicrotask(r));

describe('helm-store', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('creates tasks with defaults and persists newest-first', () => {
    const a = createTask({ title: 'first' });
    const b = createTask({ title: 'second' });
    expect(a.status).toBe('backlog');
    expect(a.priority).toBe('medium');
    expect(loadTasks().map(t => t.id)).toEqual([b.id, a.id]);
  });

  it('updates a task in place, preserving id and bumping updatedAt', () => {
    const t = createTask({ title: 'x' });
    const next = updateTask(t.id, { status: 'done', id: 'EVIL' } as never);
    expect(next?.id).toBe(t.id);
    expect(next?.status).toBe('done');
    expect(updateTask('missing', { status: 'done' })).toBeNull();
  });

  it('deleting a task cascades its commentary', () => {
    const t = createTask({ title: 'x' });
    addCommentary({ kind: 'ai-note', taskId: t.id, author: 'claude', body: 'note' });
    addCommentary({ kind: 'ai-note', goalId: 'g-1', author: 'claude', body: 'keep' });
    deleteTask(t.id);
    expect(loadTasks()).toHaveLength(0);
    expect(loadCommentary()).toHaveLength(1);
    expect(loadCommentary()[0].body).toBe('keep');
  });

  it('deleting a goal unlinks its tasks rather than deleting them', () => {
    const g = createGoal({ title: 'goal' });
    const t = createTask({ title: 'task', goalId: g.id });
    deleteGoal(g.id);
    expect(loadGoals()).toHaveLength(0);
    const survivor = loadTasks().find(x => x.id === t.id);
    expect(survivor).toBeDefined();
    expect(survivor?.goalId).toBeUndefined();
  });

  it('goalProgress counts done tasks and rounds the pct', () => {
    const g = createGoal({ title: 'g' });
    createTask({ title: 'a', goalId: g.id, status: 'done' });
    createTask({ title: 'b', goalId: g.id });
    createTask({ title: 'c', goalId: g.id });
    expect(goalProgress(g.id)).toEqual({ total: 3, done: 1, pct: 33 });
    expect(goalProgress('nothing')).toEqual({ total: 0, done: 0, pct: 0 });
    expect(tasksForGoal(g.id)).toHaveLength(3);
  });

  it('commentaryFor filters by task or goal and sorts by timestamp', () => {
    const entries = [
      { id: '1', ts: '2026-01-02', kind: 'ai-note', taskId: 't1', author: 'a', body: 'later' },
      { id: '2', ts: '2026-01-01', kind: 'ai-note', taskId: 't1', author: 'a', body: 'earlier' },
      { id: '3', ts: '2026-01-01', kind: 'ai-note', goalId: 'g1', author: 'a', body: 'goal' },
    ] as never[];
    expect(commentaryFor({ taskId: 't1' }, entries).map(e => e.body)).toEqual(['earlier', 'later']);
    expect(commentaryFor({ goalId: 'g1' }, entries).map(e => e.body)).toEqual(['goal']);
    expect(commentaryFor({}, entries)).toHaveLength(0);
  });

  it('notifies onStoreChange subscribers on a microtask after writes', async () => {
    const handler = vi.fn();
    const off = onStoreChange(handler);
    createTask({ title: 'x' });
    expect(handler).not.toHaveBeenCalled(); // deferred — not mid-render
    await flushMicrotasks();
    expect(handler).toHaveBeenCalled();

    handler.mockClear();
    off();
    createTask({ title: 'y' });
    await flushMicrotasks();
    expect(handler).not.toHaveBeenCalled();
  });

  it('also relays cross-tab storage events to subscribers', () => {
    const handler = vi.fn();
    const off = onStoreChange(handler);
    window.dispatchEvent(new StorageEvent('storage', { key: 'helm:tasks' }));
    expect(handler).toHaveBeenCalledTimes(1);
    off();
  });

  it('survives corrupt localStorage payloads', () => {
    localStorage.setItem('helm:tasks', '{not json');
    expect(loadTasks()).toEqual([]);
    localStorage.setItem('helm:tasks', '"a string"');
    expect(loadTasks()).toEqual([]);
  });
});
