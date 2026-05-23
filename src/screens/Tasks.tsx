import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Theme } from '../types';
import {
  type Task,
  type TaskStatus,
  type Priority,
  type Goal,
  type CommentaryEntry,
  loadTasks, saveTasks,
  loadGoals,
  createTask, updateTask, deleteTask,
  loadCommentary, addCommentary, commentaryFor,
} from '../lib/helm-store';

interface Props { theme: Theme; }

const LABEL: Record<Theme, string> = { assay: 'Works Orders', politburo: 'Directives', blizzard: 'Objectives' };

const COLUMNS: Array<{ id: TaskStatus; label: string }> = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

const PRIORITY_PILL: Record<Priority, { cls: string; text: string }> = {
  high: { cls: 'pill-err', text: 'High' },
  medium: { cls: 'pill-warn', text: 'Med' },
  low: { cls: 'pill-ok', text: 'Low' },
};

function priorityClass(p: Priority): string {
  return p === 'high' ? 'p-high' : p === 'medium' ? 'p-med' : 'p-low';
}

function fmtDateInput(iso?: string): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/* ── seed example tasks the first time this loads ────────── */

function seedIfEmpty() {
  if (loadTasks().length > 0) return;
  const now = new Date().toISOString();
  saveTasks([
    { id: 'task_seed_1', title: 'Implement WebSocket RPC client', description: 'Build the OpenClaw gateway WS client with auth + subscribe + call.', status: 'done', priority: 'high', createdAt: now, updatedAt: now, assignedAgent: 'Deltron' },
    { id: 'task_seed_2', title: 'Build theme system (3 themes)', description: 'Politburo, Assay Office, First Blizzard.', status: 'done', priority: 'high', createdAt: now, updatedAt: now },
    { id: 'task_seed_3', title: 'Wire Chat to live gateway', description: 'sessions.list, history, streaming.', status: 'done', priority: 'high', createdAt: now, updatedAt: now },
    { id: 'task_seed_4', title: 'Overview dashboard layout', description: 'All ten widgets, real RPC data.', status: 'review', priority: 'high', createdAt: now, updatedAt: now, assignedAgent: 'Deltron' },
    { id: 'task_seed_5', title: 'Talk: PCM16 audio capture upload', description: 'Stream mic to talk.session.appendAudio at provider input rate.', status: 'in_progress', priority: 'high', createdAt: now, updatedAt: now },
    { id: 'task_seed_6', title: 'Tasks kanban + detail panel', description: 'HTML5 drag-and-drop columns, modal detail with commentary log.', status: 'in_progress', priority: 'medium', createdAt: now, updatedAt: now },
    { id: 'task_seed_7', title: 'Goals: AI decomposition flow', description: 'Open a chat session with a decomposition prompt; user reviews suggested tasks.', status: 'backlog', priority: 'medium', createdAt: now, updatedAt: now },
    { id: 'task_seed_8', title: 'Mobile PWA manifest', description: 'manifest.json + icon set + service worker.', status: 'backlog', priority: 'low', createdAt: now, updatedAt: now },
  ]);
}

/* ── Task card ──────────────────────────────────────────── */

function TaskCard({ task, onOpen, onDragStart }: { task: Task; onOpen: () => void; onDragStart: () => void }) {
  return (
    <div
      className={`k-card ${priorityClass(task.priority)}`}
      style={task.status === 'done' ? { opacity: 0.6 } : undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/helm-task', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onClick={onOpen}
    >
      <div className="k-card-title">{task.title}</div>
      <div className="k-card-meta">
        <span className={`pill ${PRIORITY_PILL[task.priority].cls}`}>{PRIORITY_PILL[task.priority].text}</span>
        {task.assignedAgent && <span className="pill pill-idle">{task.assignedAgent}</span>}
        {task.cronExpr && <span className="pill pill-blue">⏱ {task.cronExpr}</span>}
        {task.status === 'done' && <span className="pill pill-ok">✓ Done</span>}
      </div>
      {task.description && (
        <div className="k-card-log" style={{ fontStyle: 'normal' }}>{task.description}</div>
      )}
      {task.status === 'review' && (
        <div className="human-req">⚑ Human Review Required</div>
      )}
    </div>
  );
}

/* ── Task detail modal ──────────────────────────────────── */

function TaskDetail({
  task, goals, commentary, onClose, onSave, onDelete, onAddCommentary,
}: {
  task: Task;
  goals: Goal[];
  commentary: CommentaryEntry[];
  onClose: () => void;
  onSave: (patch: Partial<Task>) => void;
  onDelete: () => void;
  onAddCommentary: (kind: CommentaryEntry['kind'], body: string) => void;
}) {
  const [draft, setDraft] = useState<Partial<Task>>(task);
  const [feedback, setFeedback] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => setDraft(task), [task.id, task]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmitNote = () => {
    const body = note.trim();
    if (!body) return;
    onAddCommentary('user-note', body);
    setNote('');
  };

  const handleSubmitFeedback = (decision: 'approve' | 'requeue') => {
    const body = feedback.trim() || (decision === 'approve' ? 'Approved.' : 'Sent back for rework.');
    onAddCommentary('review-feedback', `${decision === 'approve' ? '✓ Approved' : '↻ Requeued'} — ${body}`);
    setFeedback('');
    onSave({ status: decision === 'approve' ? 'done' : 'in_progress' });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', border: '1px solid var(--brd)', borderRadius: 'var(--r)',
          width: 'min(720px, 92vw)', maxHeight: '88vh', overflow: 'auto',
          padding: 0, display: 'flex', flexDirection: 'column', gap: 0,
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--brd)', background: 'var(--surf)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', color: 'var(--ink2)', fontFamily: 'var(--fm)' }}>{task.id}</span>
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--ink2)' }}>
            Updated {new Date(task.updatedAt).toLocaleString('en-GB')}
          </span>
          <button className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input
            value={draft.title ?? ''}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
            style={{ fontSize: '16px', fontWeight: 600, padding: '8px 10px', background: 'var(--surf)' }}
          />
          <textarea
            value={draft.description ?? ''}
            onChange={e => setDraft({ ...draft, description: e.target.value })}
            placeholder="Description"
            style={{ minHeight: '80px', fontSize: '12px', padding: '8px 10px', background: 'var(--surf)' }}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <label style={{ fontSize: '10px', color: 'var(--ink2)' }}>
              Status
              <select
                value={draft.status ?? task.status}
                onChange={e => setDraft({ ...draft, status: e.target.value as TaskStatus })}
                style={{ width: '100%', marginTop: '3px', padding: '5px 8px', fontSize: '12px' }}
              >
                {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '10px', color: 'var(--ink2)' }}>
              Priority
              <select
                value={draft.priority ?? task.priority}
                onChange={e => setDraft({ ...draft, priority: e.target.value as Priority })}
                style={{ width: '100%', marginTop: '3px', padding: '5px 8px', fontSize: '12px' }}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label style={{ fontSize: '10px', color: 'var(--ink2)' }}>
              Goal
              <select
                value={draft.goalId ?? ''}
                onChange={e => setDraft({ ...draft, goalId: e.target.value || undefined })}
                style={{ width: '100%', marginTop: '3px', padding: '5px 8px', fontSize: '12px' }}
              >
                <option value="">— Standalone —</option>
                {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '10px', color: 'var(--ink2)' }}>
              Due
              <input
                type="date"
                value={fmtDateInput(draft.dueAt)}
                onChange={e => setDraft({ ...draft, dueAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                style={{ width: '100%', marginTop: '3px', padding: '5px 8px', fontSize: '12px' }}
              />
            </label>
            <label style={{ fontSize: '10px', color: 'var(--ink2)' }}>
              Assigned agent
              <input
                value={draft.assignedAgent ?? ''}
                onChange={e => setDraft({ ...draft, assignedAgent: e.target.value || undefined })}
                placeholder="e.g. Deltron"
                style={{ width: '100%', marginTop: '3px', padding: '5px 8px', fontSize: '12px' }}
              />
            </label>
            <label style={{ fontSize: '10px', color: 'var(--ink2)' }}>
              Cron (optional)
              <input
                value={draft.cronExpr ?? ''}
                onChange={e => setDraft({ ...draft, cronExpr: e.target.value || undefined })}
                placeholder="e.g. 0 9 * * 1"
                style={{ width: '100%', marginTop: '3px', padding: '5px 8px', fontSize: '12px', fontFamily: 'var(--fm)' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn" onClick={() => onSave(draft)}>Save</button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-ghost"
              style={{ color: 'var(--err)', borderColor: 'var(--err)', marginLeft: 'auto' }}
              onClick={() => { if (confirm('Delete this task?')) onDelete(); }}
            >Delete</button>
          </div>

          {task.status === 'review' && (
            <div style={{ border: '1px solid var(--err)', background: 'rgba(139,32,32,.08)', borderRadius: 'var(--r)', padding: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--err)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                Human review
              </div>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="Optional feedback (logged either way)…"
                style={{ width: '100%', minHeight: '60px', fontSize: '12px', padding: '6px 8px', background: 'var(--surf)' }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button className="btn" onClick={() => handleSubmitFeedback('approve')}>✓ Approve</button>
                <button className="btn btn-ghost" onClick={() => handleSubmitFeedback('requeue')}>↻ Requeue</button>
              </div>
            </div>
          )}

          <div>
            <div className="card-title" style={{ marginBottom: '8px' }}>Commentary</div>
            {commentary.length === 0 && (
              <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>No entries yet.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
              {commentary.map(e => (
                <div key={e.id} style={{ background: 'var(--surf)', borderLeft: '2px solid var(--acc)', padding: '6px 10px', fontSize: '11px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink2)', fontSize: '10px', marginBottom: '2px' }}>
                    <span>{e.kind} · {e.author}</span>
                    <span>{new Date(e.ts).toLocaleString('en-GB')}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>{e.body}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Add a note…"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSubmitNote(); } }}
                style={{ flex: 1, fontSize: '12px', padding: '6px 10px' }}
              />
              <button className="btn" onClick={handleSubmitNote}>+ Note</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Tasks screen ───────────────────────────────────────── */

export default function Tasks({ theme }: Props) {
  const [tasks, setTasks] = useState<Task[]>(() => { seedIfEmpty(); return loadTasks(); });
  const [goals, setGoals] = useState<Goal[]>(() => loadGoals());
  const [commentary, setCommentary] = useState<CommentaryEntry[]>(() => loadCommentary());
  const [openId, setOpenId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [goalFilter, setGoalFilter] = useState<string>('all');
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

  // Reload from storage on mount (in case other screens mutated it)
  useEffect(() => {
    setTasks(loadTasks());
    setGoals(loadGoals());
    setCommentary(loadCommentary());
  }, []);

  const agents = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach(t => t.assignedAgent && s.add(t.assignedAgent));
    return [...s].sort();
  }, [tasks]);

  const filtered = useMemo(() => tasks.filter(t =>
    (agentFilter === 'all' || t.assignedAgent === agentFilter) &&
    (goalFilter === 'all' || t.goalId === goalFilter),
  ), [tasks, agentFilter, goalFilter]);

  const byStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = { backlog: [], in_progress: [], review: [], done: [] };
    for (const t of filtered) grouped[t.status].push(t);
    return grouped;
  }, [filtered]);

  const handleSave = useCallback((id: string, patch: Partial<Task>) => {
    const next = updateTask(id, patch);
    if (next) {
      setTasks(loadTasks());
      addCommentary({ kind: 'status-change', taskId: id, author: 'system', body: `Updated: ${Object.keys(patch).join(', ')}` });
      setCommentary(loadCommentary());
    }
  }, []);

  const handleDelete = useCallback((id: string) => {
    deleteTask(id);
    setTasks(loadTasks());
    setCommentary(loadCommentary());
    setOpenId(null);
  }, []);

  const handleNew = useCallback(() => {
    const title = prompt(`New ${LABEL[theme].replace(/s$/, '')} title:`);
    if (!title?.trim()) return;
    const t = createTask({ title: title.trim() });
    setTasks(loadTasks());
    setOpenId(t.id);
  }, [theme]);

  const handleDrop = (status: TaskStatus, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/helm-task');
    if (!id) return;
    const current = tasks.find(t => t.id === id);
    if (!current || current.status === status) return;
    const next = updateTask(id, { status });
    if (next) {
      addCommentary({ kind: 'status-change', taskId: id, author: 'user', body: `${current.status} → ${status}` });
      setTasks(loadTasks());
      setCommentary(loadCommentary());
    }
  };

  const openTask = openId ? tasks.find(t => t.id === openId) ?? null : null;
  const openCommentary = openTask ? commentaryFor({ taskId: openTask.id }, commentary) : [];

  return (
    <div id="screen-tasks" className="screen">
      <div className="tasks-toolbar">
        <button className="btn" onClick={handleNew}>+ New {LABEL[theme].replace(/s$/, '')}</button>
        <span style={{ fontSize: '11px', color: 'var(--ink2)' }}>Goal:</span>
        <select value={goalFilter} onChange={e => setGoalFilter(e.target.value)}>
          <option value="all">All goals</option>
          {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
        <span style={{ fontSize: '11px', color: 'var(--ink2)' }}>Agent:</span>
        <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
          <option value="all">All agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--ink2)' }}>
          {filtered.length} task{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="kanban">
        {COLUMNS.map(col => (
          <div
            key={col.id}
            className="k-col"
            onDragOver={(e) => { e.preventDefault(); setDragOver(col.id); }}
            onDragLeave={() => setDragOver(prev => prev === col.id ? null : prev)}
            onDrop={(e) => handleDrop(col.id, e)}
            style={{ background: dragOver === col.id ? 'var(--glow)' : undefined, transition: 'background .1s' }}
          >
            <div className="k-head">
              {col.label}
              <span className="k-head-count">{byStatus[col.id].length}</span>
            </div>
            <div className="k-cards">
              {byStatus[col.id].map(t => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onOpen={() => setOpenId(t.id)}
                  onDragStart={() => {}}
                />
              ))}
              {byStatus[col.id].length === 0 && (
                <div style={{ fontSize: '10px', color: 'var(--ink2)', padding: '8px', textAlign: 'center', border: '1px dashed var(--brd)', borderRadius: 'var(--r)' }}>
                  Drop tasks here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {openTask && (
        <TaskDetail
          task={openTask}
          goals={goals}
          commentary={openCommentary}
          onClose={() => setOpenId(null)}
          onSave={(patch) => handleSave(openTask.id, patch)}
          onDelete={() => handleDelete(openTask.id)}
          onAddCommentary={(kind, body) => {
            addCommentary({ kind, taskId: openTask.id, author: 'user', body });
            setCommentary(loadCommentary());
          }}
        />
      )}
    </div>
  );
}
