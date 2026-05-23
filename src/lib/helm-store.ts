/**
 * Helm planning store — tasks, goals, and commentary persisted to
 * localStorage. The plan calls for a SQLite-backed gateway router; this
 * is the MVP that lets the UI exist now, behind a thin interface so the
 * persistence swap is a single-file change later.
 *
 * Storage shape (one JSON blob per collection):
 *   helm:tasks       → Task[]
 *   helm:goals       → Goal[]
 *   helm:commentary  → CommentaryEntry[]
 */

export type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'done';
export type Priority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: Priority;
  goalId?: string;
  /** ISO timestamp string. Used for sort order; not parsed by the store. */
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
  cronExpr?: string;
  assignedAgent?: string;
  /** Free-form list of agents involved (for orchestration view). */
  agentIds?: string[];
}

export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface Goal {
  id: string;
  title: string;
  description?: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  targetDate?: string;
  /** Free-form ordered narrative log entries (markdown). */
  narrative?: string;
}

export type CommentaryKind =
  | 'ai-note'
  | 'user-note'
  | 'status-change'
  | 'decomposition'
  | 'review-feedback';

export interface CommentaryEntry {
  id: string;
  ts: string;
  kind: CommentaryKind;
  /** What this entry relates to. Exactly one of taskId / goalId is set. */
  taskId?: string;
  goalId?: string;
  author: string;
  body: string;
}

const TASKS_KEY = 'helm:tasks';
const GOALS_KEY = 'helm:goals';
const COMMENTARY_KEY = 'helm:commentary';

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch { return []; }
}

function writeArray<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Notify same-tab listeners on a microtask so callers that write during
    // a React render (e.g. seedIfEmpty in a useState initialiser) don't
    // trigger a setState in another component mid-render.
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent('helm:store-changed', { detail: { key } }));
    });
  } catch { /* quota */ }
}

/** Subscribe to any change in the Helm planning store. Returns an unsub fn. */
export function onStoreChange(handler: () => void): () => void {
  const listener = () => handler();
  window.addEventListener('helm:store-changed', listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener('helm:store-changed', listener);
    window.removeEventListener('storage', listener);
  };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const nowIso = () => new Date().toISOString();

/* ── tasks ──────────────────────────────────────────────── */

export function loadTasks(): Task[] { return readArray<Task>(TASKS_KEY); }
export function saveTasks(tasks: Task[]): void { writeArray(TASKS_KEY, tasks); }

export function createTask(input: Omit<Partial<Task>, 'id' | 'createdAt' | 'updatedAt'> & { title: string }): Task {
  const t: Task = {
    id: newId('task'),
    status: 'backlog',
    priority: 'medium',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...input,
  };
  const all = loadTasks();
  all.unshift(t);
  saveTasks(all);
  return t;
}

export function updateTask(id: string, patch: Partial<Task>): Task | null {
  const all = loadTasks();
  const idx = all.findIndex(t => t.id === id);
  if (idx < 0) return null;
  const next = { ...all[idx], ...patch, updatedAt: nowIso(), id: all[idx].id };
  all[idx] = next;
  saveTasks(all);
  return next;
}

export function deleteTask(id: string): void {
  saveTasks(loadTasks().filter(t => t.id !== id));
  // Cascade commentary for this task
  const commentary = loadCommentary().filter(c => c.taskId !== id);
  saveCommentary(commentary);
}

/* ── goals ──────────────────────────────────────────────── */

export function loadGoals(): Goal[] { return readArray<Goal>(GOALS_KEY); }
export function saveGoals(goals: Goal[]): void { writeArray(GOALS_KEY, goals); }

export function createGoal(input: Omit<Partial<Goal>, 'id' | 'createdAt' | 'updatedAt'> & { title: string }): Goal {
  const g: Goal = {
    id: newId('goal'),
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...input,
  };
  const all = loadGoals();
  all.unshift(g);
  saveGoals(all);
  return g;
}

export function updateGoal(id: string, patch: Partial<Goal>): Goal | null {
  const all = loadGoals();
  const idx = all.findIndex(g => g.id === id);
  if (idx < 0) return null;
  const next = { ...all[idx], ...patch, updatedAt: nowIso(), id: all[idx].id };
  all[idx] = next;
  saveGoals(all);
  return next;
}

export function deleteGoal(id: string): void {
  saveGoals(loadGoals().filter(g => g.id !== id));
  // Unlink tasks rather than delete them
  const tasks = loadTasks().map(t => t.goalId === id ? { ...t, goalId: undefined } : t);
  saveTasks(tasks);
}

/* ── commentary ─────────────────────────────────────────── */

export function loadCommentary(): CommentaryEntry[] { return readArray<CommentaryEntry>(COMMENTARY_KEY); }
export function saveCommentary(entries: CommentaryEntry[]): void { writeArray(COMMENTARY_KEY, entries); }

export function addCommentary(input: Omit<CommentaryEntry, 'id' | 'ts'>): CommentaryEntry {
  const e: CommentaryEntry = {
    id: newId('cmt'),
    ts: nowIso(),
    ...input,
  };
  const all = loadCommentary();
  all.push(e);
  saveCommentary(all);
  return e;
}

/* ── derived selectors ──────────────────────────────────── */

export function tasksForGoal(goalId: string, tasks: Task[] = loadTasks()): Task[] {
  return tasks.filter(t => t.goalId === goalId);
}

export function goalProgress(goalId: string, tasks: Task[] = loadTasks()): { total: number; done: number; pct: number } {
  const linked = tasks.filter(t => t.goalId === goalId);
  if (linked.length === 0) return { total: 0, done: 0, pct: 0 };
  const done = linked.filter(t => t.status === 'done').length;
  return { total: linked.length, done, pct: Math.round((done / linked.length) * 100) };
}

export function commentaryFor(opts: { taskId?: string; goalId?: string }, entries: CommentaryEntry[] = loadCommentary()): CommentaryEntry[] {
  return entries
    .filter(e => (opts.taskId ? e.taskId === opts.taskId : false) || (opts.goalId ? e.goalId === opts.goalId : false))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}
