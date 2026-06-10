import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Theme } from '../types';
import { useGateway } from '../context/GatewayContext';
import {
  type Goal,
  type Task,
  type TaskStatus,
  type CommentaryEntry,
  loadGoals, saveGoals,
  loadTasks,
  createGoal, updateGoal, deleteGoal,
  createTask, updateTask, deleteTask,
  loadCommentary, addCommentary, commentaryFor,
  goalProgress, tasksForGoal,
  onStoreChange,
} from '../lib/helm-store';
import { TaskBoard, TaskDetailModal } from '../components/TaskBoard';

interface Props { theme: Theme; }

const TITLE: Record<Theme, string> = { assay: 'Ventures', politburo: 'Objectives', blizzard: 'Expeditions' };

/* ── seed example goals once ─────────────────────────────── */

function seedIfEmpty() {
  if (loadGoals().length > 0) return;
  const now = new Date().toISOString();
  saveGoals([
    {
      id: 'goal_seed_1',
      title: 'Build & Ship The Helm v1',
      description: 'A purpose-built web control surface for OpenClaw covering all nine feature domains. Must integrate via WebSocket JSON-RPC, support three themes, and be served from the existing gateway process.',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      narrative: 'Phase 0 & 1 complete (shell + Overview live). Phase 2 just shipped (Skills, Design, Talk). Phase 3 in flight — tasks, goals, commentary all client-side first.',
    },
    {
      id: 'goal_seed_2',
      title: 'Automate Weekly Reports',
      description: 'Cron-driven Slack + email digest from all active sessions, summarised by an agent.',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'goal_seed_3',
      title: 'Research: Voice Mode Providers',
      description: 'Evaluate ElevenLabs vs built-in talk.* vs Deepgram. Decision matrix needed before committing to one.',
      status: 'paused',
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

/* ── helpers ─────────────────────────────────────────────── */

const STATUS_PILL: Record<Goal['status'], { cls: string; text: string }> = {
  active: { cls: 'pill-ok', text: 'Active' },
  paused: { cls: 'pill-warn', text: 'Paused' },
  completed: { cls: 'pill-ok', text: '✓ Complete' },
  archived: { cls: 'pill-idle', text: 'Archived' },
};

function ProgressRing({ pct }: { pct: number }) {
  // SVG with circumference 100 (r=15.9 ≈ ~100)
  const filled = Math.max(0, Math.min(100, pct));
  return (
    <svg className="prog-ring" viewBox="0 0 36 36">
      <circle className="prog-track" cx="18" cy="18" r="15.9" />
      <circle
        className="prog-fill"
        cx="18" cy="18" r="15.9"
        strokeDasharray={`${filled} ${100 - filled}`}
        strokeDashoffset="0"
      />
    </svg>
  );
}

const DECOMPOSE_PROMPT = `Help me decompose the project below into 3–8 concrete tasks. For each task, give a title (under 70 chars), a one-line description, and a priority (low/medium/high). Format as markdown bullets:

- **Title** [priority] — description

Project:
`;

/* ── New goal modal ──────────────────────────────────────── */

function NewGoalModal({ onClose, onCreate }: { onClose: () => void; onCreate: (g: Pick<Goal, 'title' | 'description' | 'targetDate'>) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg)', border: '1px solid var(--brd)', borderRadius: 'var(--r)', width: 'min(540px, 92vw)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}
      >
        <div className="card-title">New goal</div>
        <input
          placeholder="Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          autoFocus
          style={{ padding: '8px 10px', fontSize: '14px', background: 'var(--surf)' }}
        />
        <textarea
          placeholder="Description (what does success look like?)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          style={{ minHeight: '80px', padding: '8px 10px', fontSize: '12px', background: 'var(--surf)' }}
        />
        <label style={{ fontSize: '11px', color: 'var(--ink2)' }}>
          Target date
          <input
            type="date"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
            style={{ width: '100%', marginTop: '3px', padding: '6px 8px', fontSize: '12px' }}
          />
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn"
            disabled={!title.trim()}
            onClick={() => onCreate({
              title: title.trim(),
              description: description.trim() || undefined,
              targetDate: targetDate ? new Date(targetDate).toISOString() : undefined,
            })}
          >Create</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ── Goals screen ────────────────────────────────────────── */

export default function Goals({ theme }: Props) {
  const { client, status } = useGateway();
  const [goals, setGoals] = useState<Goal[]>(() => { seedIfEmpty(); return loadGoals(); });
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [commentary, setCommentary] = useState<CommentaryEntry[]>(() => loadCommentary());
  const [activeId, setActiveId] = useState<string | null>(() => loadGoals()[0]?.id ?? null);
  const [showNew, setShowNew] = useState(false);
  const [decomposeBusy, setDecomposeBusy] = useState(false);
  const [decomposeMsg, setDecomposeMsg] = useState<string | null>(null);
  const [narrativeDraft, setNarrativeDraft] = useState('');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // Reload from storage whenever another screen mutates the store, re-anchoring
  // the selection if the active goal was deleted elsewhere. The initial load is
  // handled by the useState initializers above, so no sync reload() on mount.
  useEffect(() => {
    const reload = () => {
      const gs = loadGoals();
      setGoals(gs);
      setTasks(loadTasks());
      setCommentary(loadCommentary());
      setActiveId(prev => (prev && gs.some(g => g.id === prev)) ? prev : gs[0]?.id ?? null);
    };
    return onStoreChange(reload);
  }, []);

  const active = useMemo(
    () => activeId ? goals.find(g => g.id === activeId) ?? null : null,
    [goals, activeId],
  );

  // Reset the narrative draft when the selected goal changes — keyed on the
  // goal id, NOT its narrative, so saving the draft doesn't clobber edits. Done
  // as a during-render reset (the React-sanctioned alternative to an effect).
  // Initial `false` forces the reset on first render to seed from the goal.
  const [draftGoalId, setDraftGoalId] = useState<string | null | false>(false);
  if ((active?.id ?? null) !== draftGoalId) {
    setDraftGoalId(active?.id ?? null);
    setNarrativeDraft(active?.narrative ?? '');
  }

  const goalTasks = active ? tasksForGoal(active.id, tasks) : [];
  const activeCommentary = active ? commentaryFor({ goalId: active.id }, commentary) : [];

  const handleCreate = useCallback((input: Pick<Goal, 'title' | 'description' | 'targetDate'>) => {
    const g = createGoal(input);
    setGoals(loadGoals());
    setActiveId(g.id);
    setShowNew(false);
  }, []);

  const handleStatusChange = (s: Goal['status']) => {
    if (!active) return;
    updateGoal(active.id, { status: s });
    addCommentary({ kind: 'status-change', goalId: active.id, author: 'user', body: `Status → ${s}` });
    setGoals(loadGoals());
    setCommentary(loadCommentary());
  };

  const handleSaveNarrative = () => {
    if (!active) return;
    updateGoal(active.id, { narrative: narrativeDraft });
    setGoals(loadGoals());
  };

  const handleDelete = () => {
    if (!active) return;
    if (!confirm('Delete this project? Linked tasks will keep their data but be unlinked.')) return;
    deleteGoal(active.id);
    const next = loadGoals();
    setGoals(next);
    setActiveId(next[0]?.id ?? null);
  };

  /* ── Embedded TaskBoard handlers (tasks scoped to the active project) ── */

  const handleAddTask = useCallback(() => {
    if (!active) return;
    const title = prompt('New task title:');
    if (!title?.trim()) return;
    const t = createTask({ title: title.trim(), goalId: active.id });
    setTasks(loadTasks());
    setOpenTaskId(t.id);
  }, [active]);

  const handleTaskMove = useCallback((id: string, toStatus: TaskStatus) => {
    const current = tasks.find(t => t.id === id);
    if (!current || current.status === toStatus) return;
    const next = updateTask(id, { status: toStatus });
    if (next) {
      addCommentary({ kind: 'status-change', taskId: id, author: 'user', body: `${current.status} → ${toStatus}` });
      setTasks(loadTasks());
      setCommentary(loadCommentary());
    }
  }, [tasks]);

  const handleTaskSave = useCallback((id: string, patch: Partial<Task>) => {
    const next = updateTask(id, patch);
    if (next) {
      addCommentary({ kind: 'status-change', taskId: id, author: 'system', body: `Updated: ${Object.keys(patch).join(', ')}` });
      setTasks(loadTasks());
      setCommentary(loadCommentary());
    }
  }, []);

  const handleTaskDelete = useCallback((id: string) => {
    deleteTask(id);
    setTasks(loadTasks());
    setCommentary(loadCommentary());
    setOpenTaskId(null);
  }, []);

  const openTask = openTaskId ? tasks.find(t => t.id === openTaskId) ?? null : null;
  const openTaskCommentary = openTask ? commentaryFor({ taskId: openTask.id }, commentary) : [];

  /** Open a Chat session with a decomposition prompt; user can copy
   *  suggested tasks back via the Tasks screen. The AI's response is
   *  also captured as a commentary entry for the goal. */
  const handleDecompose = useCallback(async () => {
    if (!active || !client || status !== 'connected' || decomposeBusy) return;
    setDecomposeBusy(true);
    setDecomposeMsg(null);
    try {
      const agentsResp = await client.call<{ agents: Array<{ id: string }> }>('agents.list').catch(() => ({ agents: [] }));
      const agentId = agentsResp.agents?.[0]?.id;
      if (!agentId) {
        setDecomposeMsg('No agent configured on the gateway.');
        return;
      }
      const prompt = `${DECOMPOSE_PROMPT}**${active.title}**\n\n${active.description ?? ''}`;
      const created = await client.call<{ key?: string; sessionKey?: string }>('sessions.create', {
        agentId,
        label: `Decompose: ${active.title.slice(0, 40)}`,
        message: prompt,
      });
      const key = created.key ?? created.sessionKey ?? '(unknown)';
      addCommentary({
        kind: 'decomposition',
        goalId: active.id,
        author: 'system',
        body: `Opened decomposition session ${key}. Switch to Dispatches to review the AI's suggested tasks and copy them back here.`,
      });
      setCommentary(loadCommentary());
      setDecomposeMsg(`Decomposition session created: ${key}`);
    } catch (e) {
      setDecomposeMsg(e instanceof Error ? e.message : 'decomposition failed');
    } finally {
      setDecomposeBusy(false);
    }
  }, [active, client, status, decomposeBusy]);

  const handleAddNote = () => {
    if (!active) return;
    const body = prompt('Note for this goal:');
    if (!body?.trim()) return;
    addCommentary({ kind: 'user-note', goalId: active.id, author: 'user', body: body.trim() });
    setCommentary(loadCommentary());
  };

  return (
    <div id="screen-goals" className="screen">
      <div className="goals-list">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0 12px', borderBottom: '1px solid var(--brd)', marginBottom: '8px' }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '14px', color: 'var(--acc)' }}>{TITLE[theme]}</div>
          <button className="btn" style={{ fontSize: '10px', padding: '4px 8px' }} onClick={() => setShowNew(true)}>+ New</button>
        </div>

        {goals.length === 0 && (
          <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>No goals yet. Create one above.</div>
        )}

        {goals.map(g => {
          const prog = goalProgress(g.id, tasks);
          const isActive = g.id === activeId;
          return (
            <div
              key={g.id}
              className={`goal-card ${isActive ? 'active' : ''}`}
              onClick={() => setActiveId(g.id)}
            >
              <div className="goal-card-title">{g.title}</div>
              {g.description && (
                <div className="goal-card-desc">{g.description}</div>
              )}
              <div className="goal-progress">
                <ProgressRing pct={prog.pct} />
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--ink)' }}>
                    {prog.total === 0 ? 'Drafting' : `${prog.pct}% complete`}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--ink2)' }}>
                    {prog.total === 0 ? 'No tasks yet' : `${prog.done} of ${prog.total} tasks done`}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: '8px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                <span className={`pill ${STATUS_PILL[g.status].cls}`}>{STATUS_PILL[g.status].text}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="goal-detail">
        {!active && (
          <div style={{ fontSize: '12px', color: 'var(--ink2)', padding: '24px' }}>Select a goal on the left.</div>
        )}

        {active && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div className="goal-detail-title">{active.title}</div>
              <select
                value={active.status}
                onChange={e => handleStatusChange(e.target.value as Goal['status'])}
                style={{ fontSize: '11px', padding: '4px 8px', marginLeft: 'auto' }}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
              <button
                className="btn btn-ghost"
                style={{ fontSize: '10px', padding: '3px 8px', color: 'var(--err)', borderColor: 'var(--err)' }}
                onClick={handleDelete}
              >Delete</button>
            </div>

            {active.description && (
              <div style={{ fontSize: '12px', color: 'var(--ink2)', lineHeight: 1.6, padding: '12px', background: 'var(--surf)', border: '1px solid var(--brd)', borderRadius: 'var(--r)' }}>
                {active.description}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div className="card-title">Tasks ({goalTasks.length})</div>
              <button
                className="btn"
                style={{ fontSize: '10px', padding: '3px 10px', marginLeft: 'auto' }}
                onClick={handleAddTask}
              >+ New Task</button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: '10px', padding: '3px 8px' }}
                onClick={handleDecompose}
                disabled={decomposeBusy || status !== 'connected'}
                title={status !== 'connected' ? 'Connect to the gateway first' : ''}
              >{decomposeBusy ? 'Working…' : '✦ Plan with AI'}</button>
            </div>
            {decomposeMsg && (
              <div style={{ fontSize: '11px', color: 'var(--acc)' }}>{decomposeMsg}</div>
            )}

            {goalTasks.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--ink2)', padding: '12px', border: '1px dashed var(--brd)', borderRadius: 'var(--r)', textAlign: 'center' }}>
                No tasks linked yet. Click <b>+ New Task</b> to add one, or <b>✦ Plan with AI</b> to draft a set.
              </div>
            ) : (
              <div className="project-kanban-wrap">
                <TaskBoard
                  tasks={goalTasks}
                  onOpenTask={(id) => setOpenTaskId(id)}
                  onMoveTask={handleTaskMove}
                  compact
                  emptyHint="—"
                />
              </div>
            )}

            <div>
              <div className="card-title" style={{ marginBottom: '6px' }}>Narrative</div>
              <textarea
                value={narrativeDraft}
                onChange={e => setNarrativeDraft(e.target.value)}
                onBlur={handleSaveNarrative}
                placeholder="Long-form notes about the goal — saves on blur."
                style={{ width: '100%', minHeight: '80px', fontSize: '12px', padding: '8px 10px', background: 'var(--surf)' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="card-title">AI / Activity Log</div>
              <button className="btn btn-ghost" style={{ fontSize: '10px', padding: '3px 8px', marginLeft: 'auto' }} onClick={handleAddNote}>+ Note</button>
            </div>
            <div className="ai-log">
              {activeCommentary.length === 0 && (
                <div style={{ color: 'var(--ink2)', fontSize: '11px' }}>No entries yet.</div>
              )}
              {activeCommentary.slice().reverse().map(e => (
                <div key={e.id} className="ai-log-entry">
                  <span className="ai-log-time">
                    {new Date(e.ts).toLocaleString('en-GB', { day: '2-digit', month: 'short' })}
                  </span>
                  <span>
                    <b style={{ color: 'var(--ink)' }}>{e.kind === 'user-note' ? 'Note' : e.kind === 'decomposition' ? 'AI decomposition' : e.kind === 'review-feedback' ? 'Review' : 'Status'}:</b>{' '}
                    {e.body}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showNew && <NewGoalModal onClose={() => setShowNew(false)} onCreate={handleCreate} />}
      {openTask && (
        <TaskDetailModal
          task={openTask}
          goals={goals}
          commentary={openTaskCommentary}
          onClose={() => setOpenTaskId(null)}
          onSave={(patch) => handleTaskSave(openTask.id, patch)}
          onDelete={() => handleTaskDelete(openTask.id)}
          onAddCommentary={(kind, body) => {
            addCommentary({ kind, taskId: openTask.id, author: 'user', body });
            setCommentary(loadCommentary());
          }}
        />
      )}
    </div>
  );
}
