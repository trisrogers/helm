import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Theme } from '../types';
import {
  type Task,
  type TaskStatus,
  type Goal,
  type CommentaryEntry,
  loadTasks, saveTasks,
  loadGoals,
  createTask, updateTask, deleteTask,
  loadCommentary, addCommentary, commentaryFor,
  onStoreChange,
} from '../lib/helm-store';
import { TaskBoard, TaskDetailModal } from '../components/TaskBoard';

interface Props { theme: Theme; }

const LABEL: Record<Theme, string> = { assay: 'Works Orders', politburo: 'Directives', blizzard: 'Objectives' };

/* ── seed example tasks the first time this loads ────────── */

function seedIfEmpty() {
  if (loadTasks().length > 0) {
    // Tiny migration for pre-existing installs: seed tasks predated the
    // project link, so retroactively assign them to the umbrella build
    // project so the embedded kanban under Projects isn't empty.
    const current = loadTasks();
    let changed = false;
    for (const t of current) {
      if (t.id.startsWith('task_seed_') && !t.goalId) {
        t.goalId = 'goal_seed_1';
        changed = true;
      }
    }
    if (changed) saveTasks(current);
    return;
  }
  const now = new Date().toISOString();
  const buildProjectId = 'goal_seed_1';
  saveTasks([
    { id: 'task_seed_1', title: 'Implement WebSocket RPC client', description: 'Build the OpenClaw gateway WS client with auth + subscribe + call.', status: 'done', priority: 'high', createdAt: now, updatedAt: now, assignedAgent: 'Deltron', goalId: buildProjectId },
    { id: 'task_seed_2', title: 'Build theme system (3 themes)', description: 'Politburo, Assay Office, First Blizzard.', status: 'done', priority: 'high', createdAt: now, updatedAt: now, goalId: buildProjectId },
    { id: 'task_seed_3', title: 'Wire Chat to live gateway', description: 'sessions.list, history, streaming.', status: 'done', priority: 'high', createdAt: now, updatedAt: now, goalId: buildProjectId },
    { id: 'task_seed_4', title: 'Overview dashboard layout', description: 'All ten widgets, real RPC data.', status: 'review', priority: 'high', createdAt: now, updatedAt: now, assignedAgent: 'Deltron', goalId: buildProjectId },
    { id: 'task_seed_5', title: 'Talk: PCM16 audio capture upload', description: 'Stream mic to talk.session.appendAudio at provider input rate.', status: 'in_progress', priority: 'high', createdAt: now, updatedAt: now, goalId: buildProjectId },
    { id: 'task_seed_6', title: 'Tasks kanban + detail panel', description: 'HTML5 drag-and-drop columns, modal detail with commentary log.', status: 'in_progress', priority: 'medium', createdAt: now, updatedAt: now, goalId: buildProjectId },
    { id: 'task_seed_7', title: 'Goals: AI decomposition flow', description: 'Open a chat session with a decomposition prompt; user reviews suggested tasks.', status: 'backlog', priority: 'medium', createdAt: now, updatedAt: now, goalId: buildProjectId },
    { id: 'task_seed_8', title: 'Mobile PWA manifest', description: 'manifest.json + icon set + service worker.', status: 'backlog', priority: 'low', createdAt: now, updatedAt: now, goalId: buildProjectId },
  ]);
}

/* ── Tasks screen ───────────────────────────────────────── */

const PROJECT_FILTER_NONE = '__none__';

export default function Tasks({ theme }: Props) {
  const [tasks, setTasks] = useState<Task[]>(() => { seedIfEmpty(); return loadTasks(); });
  const [goals, setGoals] = useState<Goal[]>(() => loadGoals());
  const [commentary, setCommentary] = useState<CommentaryEntry[]>(() => loadCommentary());
  const [openId, setOpenId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  // Reload from storage on mount and whenever another screen mutates the store
  // (helm-store fires onStoreChange for same-tab writes and storage events).
  useEffect(() => {
    const reload = () => {
      setTasks(loadTasks());
      setGoals(loadGoals());
      setCommentary(loadCommentary());
    };
    reload();
    return onStoreChange(reload);
  }, []);

  const agents = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach(t => t.assignedAgent && s.add(t.assignedAgent));
    return [...s].sort();
  }, [tasks]);

  const filtered = useMemo(() => tasks.filter(t => {
    if (agentFilter !== 'all' && t.assignedAgent !== agentFilter) return false;
    if (projectFilter === PROJECT_FILTER_NONE) {
      if (t.goalId) return false;
    } else if (projectFilter !== 'all') {
      if (t.goalId !== projectFilter) return false;
    }
    return true;
  }), [tasks, agentFilter, projectFilter]);

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
    // If a single project is currently filtered, default the new task into it.
    const goalId = projectFilter !== 'all' && projectFilter !== PROJECT_FILTER_NONE ? projectFilter : undefined;
    const t = createTask({ title: title.trim(), ...(goalId ? { goalId } : {}) });
    setTasks(loadTasks());
    setOpenId(t.id);
  }, [theme, projectFilter]);

  const handleMove = useCallback((id: string, toStatus: TaskStatus) => {
    const current = tasks.find(t => t.id === id);
    if (!current || current.status === toStatus) return;
    const next = updateTask(id, { status: toStatus });
    if (next) {
      addCommentary({ kind: 'status-change', taskId: id, author: 'user', body: `${current.status} → ${toStatus}` });
      setTasks(loadTasks());
      setCommentary(loadCommentary());
    }
  }, [tasks]);

  const openTask = openId ? tasks.find(t => t.id === openId) ?? null : null;
  const openCommentary = openTask ? commentaryFor({ taskId: openTask.id }, commentary) : [];

  return (
    <div id="screen-tasks" className="screen">
      <div className="tasks-toolbar">
        <button className="btn" onClick={handleNew}>+ New {LABEL[theme].replace(/s$/, '')}</button>
        <span style={{ fontSize: '11px', color: 'var(--ink2)' }}>Project:</span>
        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
          <option value="all">All projects</option>
          <option value={PROJECT_FILTER_NONE}>— No project —</option>
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

      <TaskBoard
        tasks={filtered}
        onOpenTask={(id) => setOpenId(id)}
        onMoveTask={handleMove}
      />

      {openTask && (
        <TaskDetailModal
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
