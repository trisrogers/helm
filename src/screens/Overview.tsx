import { useState, useEffect, useCallback } from 'react';
import { useGateway } from '../context/GatewayContext';

/* ── types ─────────────────────────────────────────────────────────── */

interface ChannelAccountRow {
  accountId: string;
  name?: string;
  connected?: boolean;
  running?: boolean;
  healthState?: string;
  lastError?: string;
}

interface ChannelStatusResult {
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channelAccounts: Record<string, ChannelAccountRow[]>;
}

interface SessionRow {
  key: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  model?: string;
  lastMessagePreview?: string;
  displayName?: string;
  derivedTitle?: string;
  updatedAt?: number | null;
  totalTokens?: number;
  estimatedCostUsd?: number;
  kind?: string;
}

interface AgentRow {
  id: string;
  name?: string;
  model?: { primary?: string; fallbacks?: string[] };
  identity?: { name?: string; emoji?: string };
}

interface ApprovalEvent {
  id: string;
  request: {
    command?: string;
    commandPreview?: string;
    agentId?: string | null;
  };
  createdAtMs: number;
  expiresAtMs: number;
}

type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

interface CronJob {
  id: string;
  name?: string;
  schedule?: CronSchedule;
  enabled?: boolean;
}

/* ── helpers ──────────────────────────────────────────────────────── */

function fmt(n: number | undefined) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function fmtCost(n: number | undefined) {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

function fmtUptime(ms: number | undefined) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function isToday(ms: number | null | undefined): boolean {
  if (!ms) return false;
  const d = new Date(ms);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

function fmtSchedule(s: CronSchedule | undefined): string {
  if (!s) return '—';
  if (s.kind === 'cron') return s.expr;
  if (s.kind === 'at') return s.at;
  const ms = s.everyMs;
  if (ms >= 86_400_000) return `every ${ms / 86_400_000}d`;
  if (ms >= 3_600_000) return `every ${ms / 3_600_000}h`;
  if (ms >= 60_000) return `every ${ms / 60_000}m`;
  return `every ${ms / 1000}s`;
}

function accountPill(acc: ChannelAccountRow) {
  if (acc.connected || acc.running || acc.healthState === 'ok' || acc.healthState === 'connected') {
    return { cls: 'pill-ok', dot: 'dot-ok', text: '● Live' };
  }
  if (acc.lastError || acc.healthState === 'error') {
    return { cls: 'pill-err', dot: 'dot-err', text: '✗ Error' };
  }
  return { cls: 'pill-idle', dot: 'dot-idle', text: 'Idle' };
}

/* ── Overview ────────────────────────────────────────────────────────── */

export default function Overview() {
  const { client, status, snapshot } = useGateway();

  const [channels, setChannels] = useState<ChannelStatusResult | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [approvals, setApprovals] = useState<ApprovalEvent[]>([]);
  const [crons, setCrons] = useState<CronJob[] | null>(null);

  const fetchAll = useCallback(async () => {
    if (!client || status !== 'connected') return;

    const safe = async <T,>(method: string, params = {}): Promise<T | null> => {
      try { return await client.call<T>(method, params); } catch { return null; }
    };

    const [ch, sessResult, agResult, crResult] = await Promise.all([
      safe<ChannelStatusResult>('channels.status'),
      safe<{ sessions: SessionRow[] }>('sessions.list'),
      safe<{ agents: AgentRow[] }>('agents.list'),
      safe<{ jobs: CronJob[] }>('cron.list'),
    ]);

    if (ch) setChannels(ch);
    if (sessResult) setSessions(sessResult.sessions ?? []);
    if (agResult) setAgents(agResult.agents ?? []);
    if (crResult) setCrons(crResult.jobs ?? []);
  }, [client, status]);

  useEffect(() => {
    if (!client || status !== 'connected') return;
    fetchAll();

    const unsubs = [
      client.on('sessions.changed', fetchAll),
      client.on('health', fetchAll),
      client.on('exec.approval.requested', (payload) => {
        const e = payload as ApprovalEvent;
        setApprovals(prev => [...prev.filter(a => a.id !== e.id), e]);
      }),
      client.on('exec.approval.resolved', (payload) => {
        const e = payload as { id: string };
        setApprovals(prev => prev.filter(a => a.id !== e.id));
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [client, status, fetchAll]);

  const handleApproval = async (id: string, allow: boolean) => {
    if (!client) return;
    try {
      await client.call('exec.approval.resolve', { id, decision: allow ? 'allow-once' : 'deny' });
    } catch { /* ignore */ }
  };

  const isLoading = status === 'connecting' || (status !== 'connected' && sessions === null);
  const runningSessions = sessions?.filter(s => s.status === 'running') ?? [];
  const todaySessions = sessions?.filter(s => isToday(s.updatedAt)) ?? sessions ?? [];
  const todayTokens = todaySessions.reduce((n, s) => n + (s.totalTokens ?? 0), 0);
  const todayCost = todaySessions.reduce((n, s) => n + (s.estimatedCostUsd ?? 0), 0);

  // Build ordered channel list from the map response
  const channelList = channels
    ? (channels.channelOrder ?? []).map(id => ({
        id,
        label: channels.channelLabels?.[id] ?? id,
        accounts: channels.channelAccounts?.[id] ?? [],
      }))
    : null;

  return (
    <div id="screen-overview" className="screen active">
      <div className="stat-grid">
        <div className="card">
          <div className="card-title">Active Sessions</div>
          <div className="stat-val">{sessions == null ? '…' : runningSessions.length}</div>
          <div className="stat-sub">
            {sessions == null ? 'Loading…' : `${sessions.length} total`}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Uptime</div>
          <div className="stat-val" style={{fontSize:'22px'}}>{fmtUptime(snapshot?.uptimeMs)}</div>
          <div className="stat-sub">
            {snapshot?.authMode ? `Auth: ${snapshot.authMode}` : '—'}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Tokens Today</div>
          <div className="stat-val">
            {sessions == null ? '…' : fmt(todayTokens || undefined)}
          </div>
          <div className="stat-sub">
            {sessions == null ? 'Loading…' : `${todaySessions.length} sessions`}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Est. Cost Today</div>
          <div className="stat-val">{sessions == null ? '…' : fmtCost(todayCost || undefined)}</div>
          <div className="stat-sub">
            {sessions == null ? 'Loading…' : `${agents?.length ?? '…'} agents configured`}
          </div>
        </div>
      </div>

      <div className="mid-grid">
        <div className="card">
          <div className="card-title">Channel Health</div>
          {isLoading && <div style={{fontSize:'11px',color:'var(--ink2)'}}>Connecting…</div>}
          {!isLoading && (channelList == null || channelList.length === 0) && (
            <div style={{fontSize:'11px',color:'var(--ink2)'}}>No channels configured</div>
          )}
          {channelList?.flatMap(ch =>
            (ch.accounts.length > 0 ? ch.accounts : [{ accountId: 'default' } as ChannelAccountRow]).map(acc => {
              const pill = accountPill(acc);
              return (
                <div key={`${ch.id}-${acc.accountId}`} className="channel-row">
                  <div className={`dot ${pill.dot}`} />
                  <span style={{flex:1}}>
                    {ch.label}{ch.accounts.length > 1 ? ` · ${acc.name ?? acc.accountId}` : ''}
                  </span>
                  <span className={`pill ${pill.cls}`}>{pill.text}</span>
                </div>
              );
            })
          )}
        </div>
        <div className="card">
          <div className="card-title">Active Sessions</div>
          {isLoading && <div style={{fontSize:'11px',color:'var(--ink2)'}}>Connecting…</div>}
          {!isLoading && sessions?.length === 0 && (
            <div style={{fontSize:'11px',color:'var(--ink2)'}}>No sessions</div>
          )}
          {sessions?.slice(0, 6).map(s => (
            <div key={s.key} className="event-row">
              <span className={`dot ${s.status === 'running' ? 'dot-ok' : s.status === 'failed' ? 'dot-err' : 'dot-idle'}`}
                    style={{flexShrink:0,margin:'0 4px 0 0'}} />
              <div className="event-text" style={{minWidth:0}}>
                <span style={{fontSize:'10px',color:'var(--ink2)',display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {s.displayName ?? s.derivedTitle ?? s.key}
                </span>
                {s.model && <span style={{fontSize:'9px',color:'var(--acc)'}}>{s.model}</span>}
                {s.lastMessagePreview && (
                  <span style={{fontSize:'9px',color:'var(--ink3)',display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {s.lastMessagePreview}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bottom-grid">
        <div className="card">
          <div className="card-title">
            Pending Approvals
            {approvals.length > 0 && (
              <span className="badge" style={{fontSize:'10px',marginLeft:'6px'}}>{approvals.length}</span>
            )}
          </div>
          {approvals.length === 0 && (
            <div style={{fontSize:'11px',color:'var(--ink2)'}}>No pending approvals</div>
          )}
          {approvals.map(a => (
            <div key={a.id} className="approval-row">
              <span className="approval-cmd" title={a.request.command}>
                {a.request.commandPreview ?? a.request.command ?? a.id}
              </span>
              <button className="btn" style={{fontSize:'10px',padding:'3px 8px'}}
                      onClick={() => handleApproval(a.id, true)}>Allow</button>
              <button className="btn btn-ghost" style={{fontSize:'10px',padding:'3px 8px'}}
                      onClick={() => handleApproval(a.id, false)}>Deny</button>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-title">Scheduled Jobs</div>
          {isLoading && <div style={{fontSize:'11px',color:'var(--ink2)'}}>Connecting…</div>}
          {!isLoading && (crons == null || crons.length === 0) && (
            <div style={{fontSize:'11px',color:'var(--ink2)'}}>No cron jobs</div>
          )}
          {crons?.slice(0, 4).map(c => (
            <div key={c.id} className="cron-row">
              <span className="cron-time">{fmtSchedule(c.schedule)}</span>
              <span>{c.name ?? c.id}</span>
              <span className={`pill ${c.enabled !== false ? 'pill-ok' : 'pill-idle'}`}
                    style={{marginLeft:'auto',fontSize:'9px'}}>
                {c.enabled !== false ? 'Active' : 'Paused'}
              </span>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-title">Active Agents</div>
          {isLoading && <div style={{fontSize:'11px',color:'var(--ink2)'}}>Connecting…</div>}
          {!isLoading && (agents == null || agents.length === 0) && (
            <div style={{fontSize:'11px',color:'var(--ink2)'}}>No agents configured</div>
          )}
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {agents?.map(a => (
              <div key={a.id} style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'12px'}}>
                <div className="dot dot-ok" />
                <span>{a.identity?.emoji ? `${a.identity.emoji} ` : ''}{a.name ?? a.identity?.name ?? a.id}</span>
                <span style={{marginLeft:'auto',fontSize:'10px',color:'var(--ink2)'}}>
                  {a.model?.primary ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
