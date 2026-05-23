import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGateway } from '../context/GatewayContext';

interface SkillStatusEntry {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  blockedByAgentFilter: boolean;
  eligible: boolean;
  modelVisible: boolean;
  userInvocable: boolean;
  commandVisible: boolean;
  requirements?: { bins?: string[]; env?: string[] };
  missing?: { bins?: string[]; env?: string[] };
  install?: Array<{ id: string; kind: string; label: string; bins?: string[] }>;
}

interface SkillStatusReport {
  workspaceDir: string;
  managedSkillsDir: string;
  agentId?: string;
  agentSkillFilter?: string[];
  skills: SkillStatusEntry[];
}

interface ClawHubHit {
  score: number;
  slug: string;
  displayName: string;
  summary?: string;
  version?: string;
  updatedAt?: number;
}

interface ClawHubDetail {
  skill: {
    slug: string;
    displayName: string;
    summary?: string;
    tags?: Record<string, string>;
    createdAt: number;
    updatedAt: number;
  } | null;
  latestVersion?: { version: string; createdAt: number; changelog?: string } | null;
  metadata?: { os?: string[] | null; systems?: string[] | null } | null;
}

/* ── helpers ──────────────────────────────────────────────── */

function fmtRelative(ms: number | undefined): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function emojiFor(s: SkillStatusEntry): string {
  if (s.emoji) return s.emoji;
  const k = s.skillKey.toLowerCase();
  if (k.includes('github')) return '🐙';
  if (k.includes('notion')) return '📝';
  if (k.includes('slack')) return '💬';
  if (k.includes('search') || k.includes('web')) return '🔍';
  if (k.includes('sheet')) return '📊';
  if (k.includes('sql') || k.includes('db')) return '🗄';
  if (k.includes('mail') || k.includes('email')) return '📧';
  if (k.includes('cal')) return '📅';
  if (k.includes('file') || k.includes('drive')) return '📁';
  return '◇';
}

function statusPill(s: SkillStatusEntry): { cls: string; text: string } {
  if (s.disabled) return { cls: 'pill-idle', text: 'Disabled' };
  if (s.blockedByAllowlist) return { cls: 'pill-err', text: 'Blocked' };
  if (s.blockedByAgentFilter) return { cls: 'pill-idle', text: 'Filtered' };
  if (!s.eligible) return { cls: 'pill-err', text: 'Missing deps' };
  if (s.always) return { cls: 'pill-ok', text: 'Always-on' };
  return { cls: 'pill-ok', text: 'Active' };
}

/* ── Skills ──────────────────────────────────────────────── */

export default function Skills() {
  const { client, status } = useGateway();
  const [tab, setTab] = useState<'installed' | 'browse'>('installed');
  const [report, setReport] = useState<SkillStatusReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  // Installed selection
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Clawhub
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<ClawHubHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClawHubDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Mutations
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    if (!client || status !== 'connected') return;
    try {
      const r = await client.call<SkillStatusReport>('skills.status');
      setReport(r);
      setReportError(null);
      setSelectedKey(prev => {
        if (prev && r.skills.some(s => s.skillKey === prev)) return prev;
        return r.skills[0]?.skillKey ?? null;
      });
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'failed to load skills');
    }
  }, [client, status]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const runSearch = useCallback(async (q: string) => {
    if (!client || status !== 'connected') return;
    setSearching(true);
    try {
      const params: Record<string, unknown> = { limit: 30 };
      if (q.trim()) params.query = q.trim();
      const r = await client.call<{ results: ClawHubHit[] }>('skills.search', params);
      setSearchResults(r.results ?? []);
      setSelectedSlug(prev => prev ?? r.results[0]?.slug ?? null);
    } catch (e) {
      setSearchResults([]);
      setMsg(e instanceof Error ? e.message : 'search failed');
    } finally {
      setSearching(false);
    }
  }, [client, status]);

  // Auto-run a blank search on first tab switch so the grid isn't empty
  useEffect(() => {
    if (tab === 'browse' && searchResults === null && status === 'connected') {
      runSearch('');
    }
  }, [tab, searchResults, status, runSearch]);

  // Load clawhub detail when selectedSlug changes
  useEffect(() => {
    if (!client || status !== 'connected' || !selectedSlug || tab !== 'browse') return;
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    (async () => {
      try {
        const r = await client.call<ClawHubDetail>('skills.detail', { slug: selectedSlug });
        if (!cancelled) setDetail(r);
      } catch (e) {
        if (!cancelled) setMsg(e instanceof Error ? e.message : 'detail failed');
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [client, status, selectedSlug, tab]);

  const handleToggle = async (s: SkillStatusEntry) => {
    if (!client) return;
    setBusy(s.skillKey);
    setMsg(null);
    try {
      await client.call('skills.update', { skillKey: s.skillKey, enabled: s.disabled });
      setMsg(`${s.disabled ? 'Enabled' : 'Disabled'} ${s.name}`);
      await fetchReport();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'update failed');
    } finally {
      setBusy(null);
    }
  };

  const handleInstall = async (slug: string, force = false) => {
    if (!client) return;
    setBusy(slug);
    setMsg(null);
    try {
      await client.call('skills.install', {
        source: 'clawhub',
        slug,
        ...(force ? { force: true } : {}),
      });
      setMsg(`Installed ${slug}`);
      await fetchReport();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'install failed');
    } finally {
      setBusy(null);
    }
  };

  const handleUpdate = async (slug?: string) => {
    if (!client) return;
    setBusy(slug ?? '__all__');
    setMsg(null);
    try {
      if (slug) {
        await client.call('skills.update', { source: 'clawhub', slug });
      } else {
        await client.call('skills.update', { source: 'clawhub', all: true });
      }
      setMsg(slug ? `Updated ${slug}` : 'Updated all skills');
      await fetchReport();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'update failed');
    } finally {
      setBusy(null);
    }
  };

  const selected = useMemo(
    () => report?.skills.find(s => s.skillKey === selectedKey) ?? null,
    [report, selectedKey],
  );

  const installedCount = report?.skills.length ?? 0;

  return (
    <div id="screen-skills" className="screen">
      <div className="skills-tabs">
        <div className={`skill-tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>
          Installed ({installedCount})
        </div>
        <div className={`skill-tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>
          Browse Clawhub
        </div>
      </div>

      <div className="skills-content">
        {tab === 'installed' && (
          <div className="skills-list">
            <div style={{ display: 'flex', gap: '6px', paddingBottom: '8px', borderBottom: '1px solid var(--brd)', marginBottom: '8px' }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: '10px', padding: '3px 8px', flex: 1 }}
                onClick={() => handleUpdate()}
                disabled={status !== 'connected' || busy === '__all__'}
              >{busy === '__all__' ? 'Reloading…' : '↻ Reload All'}</button>
            </div>

            {status !== 'connected' && (
              <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>
                {status === 'connecting' ? 'Connecting…' : 'Not connected'}
              </div>
            )}
            {reportError && <div style={{ fontSize: '11px', color: 'var(--err)' }}>{reportError}</div>}
            {report?.skills.length === 0 && (
              <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>No skills installed.</div>
            )}
            {report?.skills.map(s => {
              const pill = statusPill(s);
              return (
                <div
                  key={s.skillKey}
                  className={`skill-row ${s.skillKey === selectedKey ? 'active' : ''}`}
                  onClick={() => setSelectedKey(s.skillKey)}
                >
                  <div className="skill-icon">{emojiFor(s)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="skill-row-name">{s.name}</div>
                    <div className="skill-row-desc" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.description || s.source}
                    </div>
                  </div>
                  <span className={`pill ${pill.cls}`} style={{ marginLeft: 'auto' }}>{pill.text}</span>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'browse' && (
          <div className="clawhub">
            <div className="clawhub-search">
              <input
                placeholder="Search Clawhub skills…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { setSearchQuery(searchInput); runSearch(searchInput); }
                }}
              />
              <button
                className="btn"
                onClick={() => { setSearchQuery(searchInput); runSearch(searchInput); }}
                disabled={searching || status !== 'connected'}
              >{searching ? 'Searching…' : 'Search'}</button>
            </div>
            {searchResults === null && status === 'connected' && (
              <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>Loading…</div>
            )}
            {searchResults?.length === 0 && (
              <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>
                No results{searchQuery ? ` for "${searchQuery}"` : ''}.
              </div>
            )}
            <div className="clawhub-grid">
              {searchResults?.map(hit => (
                <div
                  key={hit.slug}
                  className="hub-card"
                  onClick={() => setSelectedSlug(hit.slug)}
                  style={{
                    borderColor: hit.slug === selectedSlug ? 'var(--acc)' : undefined,
                  }}
                >
                  <div className="hub-card-name">{hit.displayName}</div>
                  <div className="hub-card-desc">{hit.summary ?? hit.slug}</div>
                  <div className="hub-card-meta">
                    {hit.version && <span>{hit.version}</span>}
                    {hit.updatedAt && <span>{fmtRelative(hit.updatedAt)}</span>}
                    <span style={{ color: 'var(--ok)' }}>✓ Vetted</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="skill-detail">
          {msg && <div style={{ fontSize: '11px', color: 'var(--acc)' }}>{msg}</div>}

          {tab === 'installed' && !selected && (
            <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>Select a skill on the left.</div>
          )}

          {tab === 'installed' && selected && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>{emojiFor(selected)}</span>
                <div style={{ fontFamily: 'var(--fd)', fontSize: '18px', color: 'var(--acc)' }}>{selected.name}</div>
                <span className={`pill ${statusPill(selected).cls}`}>{statusPill(selected).text}</span>
                <span style={{ fontSize: '11px', color: 'var(--ink2)', marginLeft: 'auto' }}>
                  {selected.bundled ? 'bundled' : selected.source}
                </span>
              </div>

              <div className="skill-readme">
                <h3>{selected.name}</h3>
                <p>{selected.description || 'No description provided.'}</p>
                <p>
                  <b>Skill key:</b> <code>{selected.skillKey}</code>
                  {selected.homepage && (
                    <> · <b>Homepage:</b> <code>{selected.homepage}</code></>
                  )}
                </p>
                <p>
                  <b>Surfaces:</b>{' '}
                  {[
                    selected.modelVisible && 'model',
                    selected.userInvocable && 'user-invocable',
                    selected.commandVisible && 'command',
                  ].filter(Boolean).join(', ') || '—'}
                </p>
                {(selected.requirements?.bins?.length || selected.requirements?.env?.length) && (
                  <p>
                    <b>Requirements:</b>{' '}
                    {[
                      ...(selected.requirements.bins ?? []).map(b => `bin:${b}`),
                      ...(selected.requirements.env ?? []).map(e => `env:${e}`),
                    ].join(', ')}
                  </p>
                )}
              </div>

              {(selected.missing?.bins?.length || selected.missing?.env?.length) ? (
                <div className="security-panel">
                  <h4>Missing Requirements</h4>
                  {selected.missing?.bins?.map(b => (
                    <div key={`bin-${b}`} className="perm-row danger">⚙ Binary not found: <code style={{ fontFamily: 'var(--fm)' }}>{b}</code></div>
                  ))}
                  {selected.missing?.env?.map(e => (
                    <div key={`env-${e}`} className="perm-row danger">🔑 Env var not set: <code style={{ fontFamily: 'var(--fm)' }}>{e}</code></div>
                  ))}
                  {selected.install && selected.install.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {selected.install.map(opt => (
                        <span key={opt.id} className="pill pill-idle">{opt.label}</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  className="btn"
                  onClick={() => handleToggle(selected)}
                  disabled={busy === selected.skillKey}
                >
                  {busy === selected.skillKey ? 'Working…' : selected.disabled ? 'Enable' : 'Disable'}
                </button>
                {!selected.bundled && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleUpdate(selected.skillKey)}
                    disabled={busy === selected.skillKey}
                  >Update from Clawhub</button>
                )}
                <button
                  className="btn btn-ghost"
                  onClick={() => fetchReport()}
                  disabled={busy !== null}
                >Refresh</button>
              </div>
            </>
          )}

          {tab === 'browse' && !selectedSlug && (
            <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>Select a skill on the left.</div>
          )}

          {tab === 'browse' && selectedSlug && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontFamily: 'var(--fd)', fontSize: '18px', color: 'var(--acc)' }}>
                  {detail?.skill?.displayName ?? selectedSlug}
                </div>
                {detail?.latestVersion?.version && (
                  <span className="pill pill-idle">{detail.latestVersion.version}</span>
                )}
                <span style={{ fontSize: '11px', color: 'var(--ink2)', marginLeft: 'auto' }}>
                  {detailLoading ? 'Loading…' :
                    detail?.skill?.updatedAt ? `updated ${fmtRelative(detail.skill.updatedAt)}` : ''}
                </span>
              </div>

              {detail?.skill === null && (
                <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>Not found on Clawhub.</div>
              )}

              {detail?.skill && (
                <>
                  <div className="skill-readme">
                    <h3>{detail.skill.displayName}</h3>
                    <p>{detail.skill.summary ?? 'No summary provided.'}</p>
                    <p><b>Slug:</b> <code>{detail.skill.slug}</code></p>
                    {detail.metadata?.os && detail.metadata.os.length > 0 && (
                      <p><b>OS:</b> {detail.metadata.os.join(', ')}</p>
                    )}
                    {detail.latestVersion?.changelog && (
                      <>
                        <p><b>Latest changelog:</b></p>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '11px' }}>{detail.latestVersion.changelog}</pre>
                      </>
                    )}
                  </div>

                  <div className="security-panel" style={{ background: 'rgba(40,80,120,.08)', borderColor: 'var(--acc2)' }}>
                    <h4 style={{ color: 'var(--acc2)' }}>Before Installing</h4>
                    <div className="perm-row">⚙ Skills install bins and run installers on the gateway host.</div>
                    <div className="perm-row">📁 Vet the SKILL.md and capabilities before granting permissions.</div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn"
                      onClick={() => handleInstall(detail.skill!.slug)}
                      disabled={busy === detail.skill.slug}
                    >{busy === detail.skill.slug ? 'Installing…' : 'Install'}</button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => handleInstall(detail.skill!.slug, true)}
                      disabled={busy === detail.skill.slug}
                    >Force reinstall</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
