import { useState, useEffect, useMemo } from 'react';
import { type Theme, type ScreenId, NAV_LABELS, THEME_META } from './types';
import { GatewayProvider, useGateway } from './context/GatewayContext';
import { loadTasks, onStoreChange } from './lib/helm-store';
import { onNavigate } from './lib/handoff';
import Overview from './screens/Overview';
import Chat from './screens/Chat';
import Talk from './screens/Talk';
import Tasks from './screens/Tasks';
import Goals from './screens/Goals';
import Orch from './screens/Orch';
import Editor from './screens/Editor';
import Skills from './screens/Skills';
import Plan from './screens/Plan';

type NavItem = { id: ScreenId; icon: string; badge?: number };
type NavSection = { label: string; items: NavItem[] };

function buildNavSections(badges: Partial<Record<ScreenId, number>>): NavSection[] {
  const withBadge = (id: ScreenId, icon: string): NavItem => {
    const badge = badges[id];
    return badge ? { id, icon, badge } : { id, icon };
  };
  return [
    {
      label: 'Navigation',
      items: [
        withBadge('overview', '⊡'),
        withBadge('chat', '◻'),
        withBadge('talk', '◉'),
      ],
    },
    {
      label: 'Operations',
      items: [
        withBadge('tasks', '☑'),
        withBadge('goals', '◎'),
        withBadge('orch', '⊹'),
      ],
    },
    {
      label: 'System',
      items: [
        withBadge('editor', '⬜'),
        withBadge('skills', '⬡'),
      ],
    },
    {
      label: 'Spec',
      items: [withBadge('plan', '📋')],
    },
  ];
}

/* ── SVG COMPONENTS ──────────────────────────────────────────────── */

function SovietStar() {
  return (
    <svg className="pol-star" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill="#F2EDD5"/>
      <circle cx="50" cy="50" r="12" fill="#CC1111" opacity=".6"/>
    </svg>
  );
}

function BlizzardTrees() {
  return (
    <svg className="bliz-trees" viewBox="0 0 240 240" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
      {/* Far background trees */}
      <polygon points="195,120 204,158 186,158" fill="#1E2A18" opacity=".5"/>
      <polygon points="195,140 206,172 184,172" fill="#1E2A18" opacity=".5"/>
      <polygon points="218,130 226,165 210,165" fill="#1E2A18" opacity=".4"/>
      <polygon points="218,148 228,178 208,178" fill="#1E2A18" opacity=".4"/>
      <polygon points="165,140 173,170 157,170" fill="#1E2A18" opacity=".5"/>
      <polygon points="165,158 175,185 155,185" fill="#1E2A18" opacity=".5"/>

      {/* Mid trees left */}
      <rect x="26" y="162" width="6" height="36" fill="#131808"/>
      <polygon points="29,22 51,92 7,92" fill="#131808"/>
      <polygon points="29,50 54,108 4,108" fill="#131808"/>
      <polygon points="29,78 56,132 2,132" fill="#131808"/>
      <polygon points="29,105 58,150 0,150" fill="#131808"/>

      {/* Mid trees center-left */}
      <rect x="68" y="172" width="5" height="26" fill="#131808"/>
      <polygon points="70,72 88,132 52,132" fill="#131808"/>
      <polygon points="70,98 90,148 50,148" fill="#131808"/>
      <polygon points="70,122 92,164 48,164" fill="#131808"/>

      {/* Tallest center tree */}
      <rect x="105" y="168" width="6" height="32" fill="#131808"/>
      <polygon points="108,55 128,118 88,118" fill="#131808"/>
      <polygon points="108,82 130,135 86,135" fill="#131808"/>
      <polygon points="108,108 132,152 84,152" fill="#131808"/>
      <polygon points="108,130 134,165 82,165" fill="#131808"/>

      {/* Right trees */}
      <rect x="143" y="176" width="5" height="22" fill="#131808"/>
      <polygon points="145,90 162,144 128,144" fill="#131808"/>
      <polygon points="145,115 164,158 126,158" fill="#131808"/>
      <polygon points="145,136 166,170 124,170" fill="#131808"/>

      {/* Snow ground */}
      <rect x="0" y="188" width="240" height="52" fill="#8AAFC8" opacity=".3"/>
    </svg>
  );
}


/* ── SIDEBAR HEADERS ──────────────────────────────────────────────── */

function PolitburoHeader({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="pol-sidebar-header" onClick={onToggle}>
      <div className="pol-stripe">
        <span>УДАРНИК · СИСТЕМА v2.1</span>
      </div>
      <div className="pol-red">
        <div className="pol-header-inner">
          <SovietStar />
          {!collapsed && <div className="pol-helm">THE HELM</div>}
          {!collapsed && <div className="pol-sub">State Intelligence Network</div>}
        </div>
        <div className="pol-wedge" />
      </div>
    </div>
  );
}

function AssayHeader({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="assay-logo" onClick={onToggle}>
      <div className="assay-logo-bg" />
      <div className="assay-rule top1" />
      <div className="assay-rule top2" />
      <div className="assay-rule bot1" />
      <div className="assay-rule bot2" />
      <div className="assay-logo-inner">
        <div className="assay-badge">
          <div className="assay-badge-inner" />
        </div>
        {!collapsed && <div className="assay-name">THE HELM</div>}
        {!collapsed && <div className="assay-sub">Birmingham Gateway</div>}
      </div>
    </div>
  );
}

function DefaultHeader({ collapsed: _collapsed, onToggle, meta }: { collapsed: boolean; onToggle: () => void; meta: { name: string; sub: string } }) {
  return (
    <div className="logo" onClick={onToggle}>
      <div className="logo-mark">H</div>
      <div className="logo-text">
        <h1>THE HELM</h1>
        <p>{meta.sub}</p>
      </div>
    </div>
  );
}

/* ── CONNECTION STATUS ───────────────────────────────────────────── */

function ConnStatus() {
  const { status, serverVersion, token, setToken } = useGateway();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const dotClass =
    status === 'connected'   ? 'conn-dot ok'   :
    status === 'connecting'  ? 'conn-dot warn'  :
    status === 'auth_failed' ? 'conn-dot err'   : 'conn-dot';

  const label =
    status === 'connected'   ? `Connected · ${serverVersion ?? ':18789'}` :
    status === 'connecting'  ? 'Connecting…'  :
    status === 'auth_failed' ? 'Auth failed — click to retry' :
    status === 'error'       ? 'Error — click to retry' :
    token ? 'Disconnected — click to update token' : 'Set gateway token →';

  if (editing) {
    return (
      <div className="conn-edit conn-edit-inline">
        <input
          className="conn-token-input"
          placeholder="Paste gateway token…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Enter' && draft.trim()) { setToken(draft.trim()); setEditing(false); }
            if (e.key === 'Escape') { setEditing(false); }
          }}
        />
        <div className="conn-edit-btns">
          <button className="btn" style={{fontSize:'10px',padding:'3px 8px'}} onClick={() => { if (draft.trim()) { setToken(draft.trim()); } setEditing(false); }}>Save</button>
          <button className="btn btn-ghost" style={{fontSize:'10px',padding:'3px 8px'}} onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`conn-status ${!token || status !== 'connected' ? 'conn-status-prompt' : ''}`}
      onClick={() => { setDraft(token); setEditing(true); }}
      title="Click to set gateway token"
    >
      <div className={dotClass} />
      <span className="conn-label">{label}</span>
    </div>
  );
}

/* ── APP ─────────────────────────────────────────────────────────── */

const SCREEN_ORDER: ScreenId[] = [
  'overview', 'chat', 'talk',
  'tasks', 'goals', 'orch',
  'editor', 'skills', 'plan',
];

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: '⌘/Ctrl + 1…0', action: 'Jump to the Nth screen in the sidebar' },
  { keys: '⌘/Ctrl + B', action: 'Toggle the sidebar' },
  { keys: '⌘/Ctrl + .', action: 'Cycle theme (Assay → Politburo → Blizzard)' },
  { keys: '?', action: 'Show this overlay' },
  { keys: 'Esc', action: 'Close modals / dismiss overlays' },
];

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', border: '1px solid var(--brd)', borderRadius: 'var(--r)',
          width: 'min(440px, 92vw)', padding: '18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '12px' }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '15px', color: 'var(--acc)' }}>Keyboard shortcuts</div>
          <span style={{ fontSize: '10px', color: 'var(--ink2)' }}>press Esc to close</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <tbody>
            {SHORTCUTS.map(s => (
              <tr key={s.keys}>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', borderBottom: '1px solid var(--brd)' }}>
                  <code style={{ fontFamily: 'var(--fm)', background: 'var(--surf)', padding: '2px 6px', borderRadius: '3px', color: 'var(--acc)' }}>
                    {s.keys}
                  </code>
                </td>
                <td style={{ padding: '6px 0', color: 'var(--ink2)', borderBottom: '1px solid var(--brd)' }}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface DefaultModelInfo {
  agentName: string;
  modelPrimary?: string;
}

function useDefaultModel(): DefaultModelInfo | null {
  const { client, status, snapshot } = useGateway();
  const [info, setInfo] = useState<DefaultModelInfo | null>(null);
  const defaultAgentId = snapshot?.sessionDefaults?.defaultAgentId;
  useEffect(() => {
    if (!client || status !== 'connected') { setInfo(null); return; }
    let cancelled = false;
    client.call<{ agents: Array<{ id: string; name?: string; identity?: { name?: string }; model?: { primary?: string } }>; defaultId?: string }>('agents.list')
      .then(r => {
        if (cancelled) return;
        const list = r.agents ?? [];
        const targetId = defaultAgentId ?? r.defaultId ?? list[0]?.id;
        const a = list.find(x => x.id === targetId) ?? list[0];
        if (!a) { setInfo(null); return; }
        setInfo({
          agentName: a.name ?? a.identity?.name ?? a.id,
          modelPrimary: a.model?.primary,
        });
      })
      .catch(() => { if (!cancelled) setInfo(null); });
    return () => { cancelled = true; };
  }, [client, status, defaultAgentId]);
  return info;
}

function AppInner() {
  const [theme, setTheme]         = useState<Theme>('assay');
  const [screen, setScreen]       = useState<ScreenId>('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [clock, setClock]         = useState('');
  const [storeTick, setStoreTick] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const defaultModel = useDefaultModel();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => onStoreChange(() => setStoreTick(n => n + 1)), []);

  // Cross-screen handoff: Chat → Talk dispatches `helm:nav`;
  // here we switch the active screen. The payload lives in localStorage
  // and the target screen consumes it on mount via consumeHandoff().
  useEffect(() => onNavigate(setScreen), []);

  // Global keyboard shortcuts. Skip when the user is typing in a field.
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      // CodeMirror editor surface
      if (el.closest('.cm-editor')) return true;
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      // Esc always works — even from inside an input — for closing overlays
      if (e.key === 'Escape' && showShortcuts) {
        setShowShortcuts(false);
        return;
      }
      if (isEditable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        // 1..9 → indices 0..8, 0 → index 9
        const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
        const next = SCREEN_ORDER[idx];
        if (next) setScreen(next);
        return;
      }
      if (mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setCollapsed(c => !c);
        return;
      }
      if (mod && e.key === '.') {
        e.preventDefault();
        setTheme(t => t === 'assay' ? 'politburo' : t === 'politburo' ? 'blizzard' : 'assay');
        return;
      }
      // Accept `?` directly (US layouts) or Shift+/ (which fires as key='/'
      // on some platforms / synthetic events).
      const isQuestion = !mod && (e.key === '?' || (e.shiftKey && e.key === '/'));
      if (isQuestion) {
        e.preventDefault();
        setShowShortcuts(s => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showShortcuts]);

  const navSections = useMemo(() => {
    // Tick is a dep so the count re-reads on store changes
    void storeTick;
    const tasks = loadTasks();
    const reviewCount = tasks.filter(t => t.status === 'review').length;
    return buildNavSections({ tasks: reviewCount || undefined });
  }, [storeTick]);

  const labels = NAV_LABELS[theme];
  const meta   = THEME_META[theme];

  return (
    <>
      {/* Assay corner-frame removed — it overlapped the topbar / nav at this
          density. The AssayBorder component is kept defined above in case we
          bring it back as an opt-in decorative layer later. */}

      <nav id="sidebar" className={collapsed ? 'collapsed' : ''}>
        {theme === 'blizzard' && (
          <>
            <div className="bliz-bg" />
            <div className="bliz-fog" />
            <BlizzardTrees />
          </>
        )}

        {theme === 'politburo'
          ? <PolitburoHeader collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
          : theme === 'assay'
          ? <AssayHeader collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
          : <DefaultHeader collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} meta={meta} />
        }

        <div className="sidebar-nav">
          {navSections.map(({ label, items }) => (
            <div key={label}>
              <div className="nav-section">{label}</div>
              {items.map(item => (
                <div
                  key={item.id}
                  className={`nav-item ${screen === item.id ? 'active' : ''}`}
                  onClick={() => setScreen(item.id)}
                >
                  <div className="nav-icon">{item.icon}</div>
                  <span className="nav-label">{labels[item.id]}</span>
                  {item.badge && <span className="badge">{item.badge}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>

      </nav>

      <div id="main">
        <div id="topbar">
          <div className="breadcrumb">{labels[screen]}</div>
          <div className="topbar-meta">
            <span title={defaultModel?.agentName ? `Default agent: ${defaultModel.agentName}` : undefined}>
              <span style={{ color: 'var(--ink2)' }}>Default model:</span>
              <b style={{ color: 'var(--ink)', fontFamily: 'var(--fm)' }}>
                {defaultModel?.modelPrimary ?? '—'}
              </b>
            </span>
            <select
              className="topbar-theme-select"
              value={theme}
              onChange={e => setTheme(e.target.value as Theme)}
              title="Switch theme"
            >
              {(['assay', 'politburo', 'blizzard'] as Theme[]).map(t => (
                <option key={t} value={t}>{THEME_META[t].name}</option>
              ))}
            </select>
            <ConnStatus />
            <span style={{ fontFamily: 'var(--fm)', fontSize: '10px' }}>{clock}</span>
          </div>
        </div>

        <div id="screen-host">
          {screen === 'overview' && <Overview />}
          {screen === 'chat'     && <Chat theme={theme} />}
          {screen === 'talk'     && <Talk theme={theme} />}
          {screen === 'tasks'    && <Tasks theme={theme} />}
          {screen === 'goals'    && <Goals theme={theme} />}
          {screen === 'orch'     && <Orch />}
          {screen === 'editor'   && <Editor />}
          {screen === 'skills'   && <Skills />}
          {screen === 'plan'     && <Plan />}
        </div>
      </div>

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </>
  );
}

export default function App() {
  return (
    <GatewayProvider>
      <AppInner />
    </GatewayProvider>
  );
}
