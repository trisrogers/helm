/**
 * Shared kanban + task detail modal — used by the global Works Orders
 * screen and embedded inside the Project (Goal) detail pane.
 *
 * Layout-wise it's just a flex row of columns; pass a pre-filtered
 * tasks array and the board handles drag-and-drop + the detail modal.
 * Mutations go through onSave / onDelete / onMove / onAddCommentary
 * so the host screen can drive its own store refresh.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Task,
  type TaskStatus,
  type Priority,
  type Goal,
  type CommentaryEntry,
} from '../lib/helm-store';

export const TASK_COLUMNS: Array<{ id: TaskStatus; label: string }> = [
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

/* ── Task card ──────────────────────────────────────────── */

interface TaskCardProps {
  task: Task;
  onOpen: () => void;
}

function TaskCard({ task, onOpen }: TaskCardProps) {
  return (
    <div
      className={`k-card ${priorityClass(task.priority)}`}
      style={task.status === 'done' ? { opacity: 0.6 } : undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/helm-task', task.id);
        e.dataTransfer.effectAllowed = 'move';
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

export interface TaskDetailModalProps {
  task: Task;
  goals: Goal[];
  commentary: CommentaryEntry[];
  onClose: () => void;
  onSave: (patch: Partial<Task>) => void;
  onDelete: () => void;
  onAddCommentary: (kind: CommentaryEntry['kind'], body: string) => void;
}

export function TaskDetailModal({
  task, goals, commentary, onClose, onSave, onDelete, onAddCommentary,
}: TaskDetailModalProps) {
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
                {TASK_COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
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
              Project
              <select
                value={draft.goalId ?? ''}
                onChange={e => setDraft({ ...draft, goalId: e.target.value || undefined })}
                style={{ width: '100%', marginTop: '3px', padding: '5px 8px', fontSize: '12px' }}
              >
                <option value="">— No project —</option>
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

/* ── TaskBoard (kanban columns + DnD) ───────────────────── */

export interface TaskBoardProps {
  tasks: Task[];
  onOpenTask: (id: string) => void;
  onMoveTask: (id: string, toStatus: TaskStatus) => void;
  /** Compact = thinner column padding, used when embedded inside a project pane. */
  compact?: boolean;
  /** Optional empty-state hint shown when a column has no cards. */
  emptyHint?: string;
}

export function TaskBoard({ tasks, onOpenTask, onMoveTask, compact, emptyHint }: TaskBoardProps) {
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

  const byStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = { backlog: [], in_progress: [], review: [], done: [] };
    for (const t of tasks) grouped[t.status].push(t);
    return grouped;
  }, [tasks]);

  const handleDrop = useCallback((status: TaskStatus, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/helm-task');
    if (!id) return;
    onMoveTask(id, status);
  }, [onMoveTask]);

  return (
    <div className={`kanban ${compact ? 'kanban-compact' : ''}`}>
      {TASK_COLUMNS.map(col => (
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
              <TaskCard key={t.id} task={t} onOpen={() => onOpenTask(t.id)} />
            ))}
            {byStatus[col.id].length === 0 && (
              <div style={{ fontSize: '10px', color: 'var(--ink2)', padding: '8px', textAlign: 'center', border: '1px dashed var(--brd)', borderRadius: 'var(--r)' }}>
                {emptyHint ?? 'Drop tasks here'}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
