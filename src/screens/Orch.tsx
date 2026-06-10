import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGateway } from '../context/GatewayContext';

/* ── types we read from the gateway ──────────────────────── */

interface AgentRow {
  id: string;
  name?: string;
  identity?: { name?: string; emoji?: string };
  model?: { primary?: string; fallbacks?: string[] };
}

interface SessionRow {
  key: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  model?: string;
  displayName?: string;
  derivedTitle?: string;
  updatedAt?: number | null;
  hasActiveRun?: boolean;
  channel?: string;
  lastChannel?: string;
  agentRuntime?: { agentId?: string };
  parentSessionKey?: string;
  childSessions?: string[];
  spawnedBy?: string;
}

interface ActivityEvent {
  ts: number;
  sessionKey: string;
  agentId?: string;
  phase?: string;
}

/* ── helpers ──────────────────────────────────────────────── */

const TIMELINE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const ACTIVITY_BUFFER_MAX = 400;

function fmtRelative(ms: number | null | undefined): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function emojiFor(a: AgentRow): string {
  return a.identity?.emoji ?? '◇';
}

function nameFor(a: AgentRow): string {
  return a.name ?? a.identity?.name ?? a.id;
}

function shortLabel(a: AgentRow): string {
  const name = nameFor(a);
  return name.slice(0, 2).toUpperCase();
}

function classifyEventPhase(phase?: string): 'msg' | 'tool' | 'ok' {
  if (!phase) return 'msg';
  if (phase.includes('approval') || phase.includes('done') || phase.includes('lifecycle')) return 'ok';
  if (phase.includes('tool') || phase.includes('exec')) return 'tool';
  return 'msg';
}

function sessionAgentId(s: SessionRow): string | undefined {
  return s.agentRuntime?.agentId ?? s.spawnedBy ?? undefined;
}

/* ── communication graph ─────────────────────────────────── */

interface CommEdge {
  fromAgent: string;
  toAgent: string;
  count: number;
  recentMs?: number;
}

function buildCommEdges(sessions: SessionRow[]): CommEdge[] {
  const sessionAgent: Record<string, string> = {};
  for (const s of sessions) {
    const a = sessionAgentId(s);
    if (a) sessionAgent[s.key] = a;
  }
  const acc: Record<string, CommEdge> = {};
  for (const s of sessions) {
    const childAgent = sessionAgentId(s);
    const parentAgent = s.parentSessionKey ? sessionAgent[s.parentSessionKey] : undefined;
    if (!childAgent || !parentAgent || childAgent === parentAgent) continue;
    const key = `${parentAgent}→${childAgent}`;
    if (!acc[key]) acc[key] = { fromAgent: parentAgent, toAgent: childAgent, count: 0 };
    acc[key].count += 1;
    if (s.updatedAt && (!acc[key].recentMs || s.updatedAt > acc[key].recentMs!)) {
      acc[key].recentMs = s.updatedAt;
    }
  }
  return Object.values(acc);
}

function CommGraph({ agents, edges, now }: { agents: AgentRow[]; edges: CommEdge[]; now: number }) {
  // Lay nodes around a circle so edges have somewhere to live
  const w = 600, h = 220, cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 - 36;
  const positions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    const n = agents.length || 1;
    agents.forEach((a, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      pos[a.id] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });
    return pos;
  }, [agents, cx, cy, r]);

  if (agents.length === 0) {
    return (
      <div className="comm-graph" style={{ flexDirection: 'column', gap: '6px' }}>
        <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>No agents to graph.</div>
      </div>
    );
  }

  return (
    <div className="comm-graph" style={{ padding: 0, height: 'auto', display: 'block' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>
        <defs>
          <marker id="arrow" viewBox="0 -5 10 10" refX="10" refY="0" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,-5L10,0L0,5" fill="var(--acc)" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = positions[e.fromAgent];
          const b = positions[e.toAgent];
          if (!a || !b) return null;
          const recent = e.recentMs ? now - e.recentMs < 5 * 60_000 : false;
          // Shorten the line so the arrowhead doesn't sit inside the node circle
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len, uy = dy / len;
          const x1 = a.x + ux * 22, y1 = a.y + uy * 22;
          const x2 = b.x - ux * 24, y2 = b.y - uy * 24;
          return (
            <g key={i}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="var(--acc)"
                strokeOpacity={recent ? 0.85 : 0.35}
                strokeWidth={Math.min(1 + e.count * 0.6, 4)}
                markerEnd="url(#arrow)"
              />
              {recent && (
                <circle r="3" fill="var(--acc)">
                  <animateMotion dur="1.4s" repeatCount="indefinite">
                    <mpath href={`#edgepath-${i}`} />
                  </animateMotion>
                </circle>
              )}
              <path id={`edgepath-${i}`} d={`M${x1},${y1}L${x2},${y2}`} fill="none" stroke="none" />
            </g>
          );
        })}
        {agents.map(a => {
          const p = positions[a.id];
          if (!p) return null;
          return (
            <g key={a.id} transform={`translate(${p.x},${p.y})`}>
              <circle r="20" fill="var(--surf2)" stroke="var(--acc)" strokeWidth="2" />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="12"
                fontWeight="700"
                fill="var(--acc)"
                fontFamily="var(--fb)"
              >
                {shortLabel(a)}
              </text>
              <text
                textAnchor="middle"
                y="36"
                fontSize="10"
                fill="var(--ink2)"
                fontFamily="var(--fb)"
              >
                {nameFor(a)}
              </text>
            </g>
          );
        })}
      </svg>
      {edges.length === 0 && (
        <div style={{ fontSize: '10px', color: 'var(--ink2)', textAlign: 'center', paddingBottom: '10px' }}>
          No parent/child agent relationships in the current session set.
        </div>
      )}
    </div>
  );
}

/* ── timeline ────────────────────────────────────────────── */

function Timeline({ agents, activity, now }: { agents: AgentRow[]; activity: ActivityEvent[]; now: number }) {
  const cutoff = now - TIMELINE_WINDOW_MS;
  const recent = activity.filter(a => a.ts >= cutoff);

  const byAgent = useMemo(() => {
    const g: Record<string, ActivityEvent[]> = {};
    for (const a of agents) g[a.id] = [];
    for (const ev of recent) {
      const key = ev.agentId ?? '__unassigned';
      if (!g[key]) g[key] = [];
      g[key].push(ev);
    }
    return g;
  }, [agents, recent]);

  const rowAgents = useMemo(() => {
    const list = agents.map(a => ({ id: a.id, label: nameFor(a) }));
    if (byAgent['__unassigned']?.length) list.push({ id: '__unassigned', label: '(unassigned)' });
    return list;
  }, [agents, byAgent]);

  if (recent.length === 0) {
    return (
      <div className="timeline" style={{ color: 'var(--ink2)', fontSize: '11px' }}>
        No activity in the last 2 hours.
      </div>
    );
  }

  return (
    <div className="timeline">
      {rowAgents.map(a => {
        const events = byAgent[a.id] ?? [];
        const lastTs = events.length ? events[events.length - 1].ts : null;
        return (
          <div key={a.id} className="tl-row">
            <span className="tl-agent">{a.label}</span>
            <div className="tl-events" style={{ position: 'relative', height: '12px', flex: 1 }}>
              {events.map((ev, i) => {
                const pct = ((ev.ts - cutoff) / TIMELINE_WINDOW_MS) * 100;
                const kind = classifyEventPhase(ev.phase);
                return (
                  <div
                    key={`${ev.sessionKey}-${ev.ts}-${i}`}
                    className={`tl-ev tl-ev-${kind}`}
                    style={{
                      position: 'absolute',
                      left: `calc(${Math.max(0, Math.min(100, pct))}% - 4px)`,
                      top: '2px',
                    }}
                    title={`${new Date(ev.ts).toLocaleTimeString('en-GB')} · ${ev.sessionKey} · ${ev.phase ?? 'msg'}`}
                  />
                );
              })}
            </div>
            <span style={{ fontSize: '9px', color: 'var(--ink2)', marginLeft: 'auto', width: '52px', textAlign: 'right' }}>
              {fmtRelative(lastTs)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Orch screen ─────────────────────────────────────────── */

export default function Orch() {
  const { client, status } = useGateway();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  // Ticked every 30s so relative timestamps + the 2h window stay fresh without
  // an impure Date.now() call in the render path.
  const [now, setNow] = useState(() => Date.now());
  // Latest sessions for the event callback, so the subscription effect doesn't
  // depend on `sessions` (which would tear down/re-register the listener on
  // every event and leave the callback reading a stale snapshot).
  const sessionsRef = useRef<SessionRow[]>([]);
  useEffect(() => { sessionsRef.current = sessions; });

  const refresh = useCallback(async () => {
    if (!client || status !== 'connected') return;
    try {
      const [a, s] = await Promise.all([
        client.call<{ agents: AgentRow[] }>('agents.list'),
        client.call<{ sessions: SessionRow[] }>('sessions.list'),
      ]);
      setAgents(a.agents ?? []);
      setSessions(s.sessions ?? []);
    } catch (e) {
      console.warn('[orch] refresh failed', e);
    }
  }, [client, status]);

  useEffect(() => {
    if (!client || status !== 'connected') return;
    void (async () => { await refresh(); })();
    const off = client.on('sessions.changed', (payload) => {
      const p = payload as { sessionKey?: string; phase?: string; ts?: number };
      if (!p?.sessionKey) return;
      const ts = p.ts ?? Date.now();
      const sessRow = sessionsRef.current.find(x => x.key === p.sessionKey);
      const agentId = sessRow ? sessionAgentId(sessRow) : undefined;
      const ev: ActivityEvent = { ts, sessionKey: p.sessionKey, agentId, phase: p.phase };
      setActivity(prev => [...prev.slice(-(ACTIVITY_BUFFER_MAX - 1)), ev]);
      // Refresh session row in the background so agent assignment can be discovered
      refresh();
    });

    // Tick `now` every 30s so relative timestamps + the 2h window stay fresh
    const interval = setInterval(() => setNow(Date.now()), 30_000);

    return () => { off(); clearInterval(interval); };
  }, [client, status, refresh]);

  // Seed: also infer activity from the sessions list (one event per recent
  // session), merging into whatever live events have already accumulated.
  // Done as a during-render adjustment keyed on the `sessions` reference so it
  // runs once per new list without an effect's cascading setState.
  const [seededFrom, setSeededFrom] = useState<SessionRow[] | null>(null);
  if (sessions.length > 0 && seededFrom !== sessions) {
    setSeededFrom(sessions);
    const cutoff = now - TIMELINE_WINDOW_MS;
    const seeded: ActivityEvent[] = sessions
      .filter(s => s.updatedAt && s.updatedAt >= cutoff)
      .map(s => ({
        ts: s.updatedAt!,
        sessionKey: s.key,
        agentId: sessionAgentId(s),
        phase: s.hasActiveRun ? 'running' : 'message',
      }));
    setActivity(prev => {
      const have = new Set(prev.map(e => `${e.sessionKey}@${e.ts}`));
      const merged = [...prev];
      for (const e of seeded) {
        const k = `${e.sessionKey}@${e.ts}`;
        if (!have.has(k)) merged.push(e);
      }
      return merged.sort((a, b) => a.ts - b.ts).slice(-ACTIVITY_BUFFER_MAX);
    });
  }

  const agentSessions = useMemo(() => {
    const g: Record<string, SessionRow[]> = {};
    for (const a of agents) g[a.id] = [];
    for (const s of sessions) {
      const aid = sessionAgentId(s);
      if (aid && g[aid]) g[aid].push(s);
    }
    for (const aid in g) g[aid].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return g;
  }, [agents, sessions]);

  const edges = useMemo(() => buildCommEdges(sessions), [sessions]);

  return (
    <div id="screen-orch" className="screen">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 0 8px' }}>
        <div className="card-title" style={{ padding: 0 }}>Live Agent Activity</div>
        {status !== 'connected' && (
          <span style={{ fontSize: '11px', color: 'var(--ink2)' }}>
            {status === 'connecting' ? 'Connecting…' : 'Not connected'}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--ink2)' }}>
          {agents.length} agent{agents.length === 1 ? '' : 's'} · {sessions.length} session{sessions.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="agent-grid">
        {agents.length === 0 && status === 'connected' && (
          <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>No agents configured on the gateway.</div>
        )}
        {agents.map(a => {
          const ownSessions = agentSessions[a.id] ?? [];
          const activeSession = ownSessions.find(s => s.hasActiveRun) ?? ownSessions[0];
          const running = ownSessions.some(s => s.hasActiveRun);
          const dotCls = running ? 'dot-ok' : ownSessions.length > 0 ? 'dot-warn' : 'dot-idle';
          const dotStyle = running ? { animation: 'pulse 1.5s infinite' as const } : undefined;
          const statusLabel = running ? 'Processing' : ownSessions.length > 0 ? 'Idle (recent activity)' : 'Idle';
          return (
            <div key={a.id} className="agent-card">
              <div className="agent-status-dot"><div className={`dot ${dotCls}`} style={dotStyle} /></div>
              <div className="agent-card-head">
                <div className="agent-icon">{emojiFor(a)}</div>
                <div>
                  <div className="agent-name">{nameFor(a)}</div>
                  <div className="agent-status-label">{statusLabel}</div>
                </div>
              </div>
              <div className="agent-stat"><span>Session</span><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                {activeSession ? (activeSession.displayName ?? activeSession.derivedTitle ?? activeSession.key) : '—'}
              </b></div>
              <div className="agent-stat"><span>Channel</span><b>{activeSession?.lastChannel ?? activeSession?.channel ?? '—'}</b></div>
              <div className="agent-stat"><span>Model</span><b>{activeSession?.model ?? a.model?.primary ?? '—'}</b></div>
              <div className="agent-stat"><span>Sessions</span><b>{ownSessions.length}</b></div>
              <div className="agent-stat"><span>Last active</span><b>{fmtRelative(ownSessions[0]?.updatedAt)}</b></div>
            </div>
          );
        })}
      </div>

      <div>
        <div className="card-title" style={{ marginBottom: '8px' }}>Agent Communication Graph</div>
        <CommGraph agents={agents} edges={edges} now={now} />
      </div>

      <div>
        <div className="card-title" style={{ marginBottom: '8px' }}>Session Timeline (last 2h)</div>
        <Timeline agents={agents} activity={activity} now={now} />
        <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '9px', color: 'var(--ink2)' }}>
          <span><span className="tl-ev tl-ev-msg" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> Message</span>
          <span><span className="tl-ev tl-ev-tool" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> Tool / exec</span>
          <span><span className="tl-ev tl-ev-ok" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> Approval / lifecycle</span>
        </div>
      </div>
    </div>
  );
}
