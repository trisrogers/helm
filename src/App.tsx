import { useState, useEffect, useMemo } from 'react';
import { type Theme, type ScreenId, NAV_LABELS, THEME_META } from './types';
import { GatewayProvider, useGateway } from './context/GatewayContext';
import { loadTasks, onStoreChange } from './lib/helm-store';
import Overview from './screens/Overview';
import Chat from './screens/Chat';
import Talk from './screens/Talk';
import Design from './screens/Design';
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
        withBadge('design', '⬚'),
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

function AssayBorder() {
  return (
    <svg
      className="assay-border"
      viewBox="0 0 1280 800"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Five nested rules */}
      <rect x="3" y="3" width="1274" height="794" fill="none" stroke="#5A3808" strokeWidth=".8"/>
      <rect x="8" y="8" width="1264" height="784" fill="none" stroke="#D4A830" strokeWidth="1.8"/>
      <rect x="13" y="13" width="1254" height="774" fill="none" stroke="#E8C040" strokeWidth=".8"/>
      <rect x="18" y="18" width="1244" height="764" fill="none" stroke="#9A7018" strokeWidth=".5"/>
      <rect x="23" y="23" width="1234" height="754" fill="none" stroke="#C89A20" strokeWidth=".4" strokeDasharray="4,5"/>

      {/* Top cartouche */}
      <ellipse cx="640" cy="8" rx="90" ry="11" fill="#0C0704" stroke="#D4A830" strokeWidth="1.3"/>
      <ellipse cx="640" cy="8" rx="80" ry="7" fill="none" stroke="#9A7018" strokeWidth=".7"/>
      <text x="640" y="11.5" textAnchor="middle" fill="#D4A830" fontSize="7" fontFamily="Cinzel,Georgia,serif" letterSpacing="5">ASSAY  OFFICE</text>
      <circle cx="560" cy="8" r="3" fill="#D4A830" opacity=".6"/>
      <circle cx="720" cy="8" r="3" fill="#D4A830" opacity=".6"/>

      {/* Bottom cartouche */}
      <ellipse cx="640" cy="792" rx="90" ry="11" fill="#0C0704" stroke="#D4A830" strokeWidth="1.3"/>
      <ellipse cx="640" cy="792" rx="80" ry="7" fill="none" stroke="#9A7018" strokeWidth=".7"/>
      <text x="640" y="795.5" textAnchor="middle" fill="#D4A830" fontSize="7" fontFamily="Cinzel,Georgia,serif" letterSpacing="5">ASSAY  OFFICE</text>
      <circle cx="560" cy="792" r="3" fill="#D4A830" opacity=".6"/>
      <circle cx="720" cy="792" r="3" fill="#D4A830" opacity=".6"/>

      {/* TOP-LEFT corner flourish */}
      <g transform="translate(22,22)">
        <path d="M0,120 C0,18 18,0 120,0" fill="none" stroke="#D4A830" strokeWidth="2.2"/>
        <path d="M0,95 C0,24 24,0 95,0" fill="none" stroke="#9A7018" strokeWidth="1.1"/>
        <path d="M0,72 C0,28 28,0 72,0" fill="none" stroke="#E8C040" strokeWidth=".7"/>
        <path d="M0,52 C0,33 33,0 52,0" fill="none" stroke="#C89A20" strokeWidth=".4" strokeDasharray="2,3"/>
        <circle cx="0" cy="0" r="8" fill="none" stroke="#D4A830" strokeWidth="1.2"/>
        <circle cx="0" cy="0" r="5" fill="none" stroke="#9A7018" strokeWidth=".7"/>
        <circle cx="0" cy="0" r="2.2" fill="#D4A830" opacity=".75"/>
        {/* Scroll accents */}
        <path d="M18,0 C22,-4 28,-4 32,0" fill="none" stroke="#D4A830" strokeWidth=".7"/>
        <path d="M0,18 C-4,22 -4,28 0,32" fill="none" stroke="#D4A830" strokeWidth=".7"/>
        {/* Pearl circles */}
        <circle cx="62" cy="4" r="2" fill="#D4A830" opacity=".5"/>
        <circle cx="4" cy="62" r="2" fill="#D4A830" opacity=".5"/>
        {/* Diamond accents */}
        <polygon points="82,6 85,9 82,12 79,9" fill="#D4A830" opacity=".4"/>
        <polygon points="6,82 9,85 6,88 3,85" fill="#D4A830" opacity=".4"/>
        {/* Leaf fills */}
        <path d="M48,2 C52,8 48,14 44,8 Z" fill="#D4A830" opacity=".15"/>
        <path d="M2,48 C8,52 14,48 8,44 Z" fill="#D4A830" opacity=".15"/>
      </g>

      {/* TOP-RIGHT corner flourish */}
      <g transform="translate(1258,22) scale(-1,1)">
        <path d="M0,120 C0,18 18,0 120,0" fill="none" stroke="#D4A830" strokeWidth="2.2"/>
        <path d="M0,95 C0,24 24,0 95,0" fill="none" stroke="#9A7018" strokeWidth="1.1"/>
        <path d="M0,72 C0,28 28,0 72,0" fill="none" stroke="#E8C040" strokeWidth=".7"/>
        <path d="M0,52 C0,33 33,0 52,0" fill="none" stroke="#C89A20" strokeWidth=".4" strokeDasharray="2,3"/>
        <circle cx="0" cy="0" r="8" fill="none" stroke="#D4A830" strokeWidth="1.2"/>
        <circle cx="0" cy="0" r="5" fill="none" stroke="#9A7018" strokeWidth=".7"/>
        <circle cx="0" cy="0" r="2.2" fill="#D4A830" opacity=".75"/>
        <path d="M18,0 C22,-4 28,-4 32,0" fill="none" stroke="#D4A830" strokeWidth=".7"/>
        <path d="M0,18 C-4,22 -4,28 0,32" fill="none" stroke="#D4A830" strokeWidth=".7"/>
        <circle cx="62" cy="4" r="2" fill="#D4A830" opacity=".5"/>
        <circle cx="4" cy="62" r="2" fill="#D4A830" opacity=".5"/>
        <polygon points="82,6 85,9 82,12 79,9" fill="#D4A830" opacity=".4"/>
        <polygon points="6,82 9,85 6,88 3,85" fill="#D4A830" opacity=".4"/>
        <path d="M48,2 C52,8 48,14 44,8 Z" fill="#D4A830" opacity=".15"/>
        <path d="M2,48 C8,52 14,48 8,44 Z" fill="#D4A830" opacity=".15"/>
      </g>

      {/* BOTTOM-LEFT corner flourish */}
      <g transform="translate(22,778) scale(1,-1)">
        <path d="M0,120 C0,18 18,0 120,0" fill="none" stroke="#D4A830" strokeWidth="2.2"/>
        <path d="M0,95 C0,24 24,0 95,0" fill="none" stroke="#9A7018" strokeWidth="1.1"/>
        <path d="M0,72 C0,28 28,0 72,0" fill="none" stroke="#E8C040" strokeWidth=".7"/>
        <path d="M0,52 C0,33 33,0 52,0" fill="none" stroke="#C89A20" strokeWidth=".4" strokeDasharray="2,3"/>
        <circle cx="0" cy="0" r="8" fill="none" stroke="#D4A830" strokeWidth="1.2"/>
        <circle cx="0" cy="0" r="5" fill="none" stroke="#9A7018" strokeWidth=".7"/>
        <circle cx="0" cy="0" r="2.2" fill="#D4A830" opacity=".75"/>
        <path d="M18,0 C22,-4 28,-4 32,0" fill="none" stroke="#D4A830" strokeWidth=".7"/>
        <path d="M0,18 C-4,22 -4,28 0,32" fill="none" stroke="#D4A830" strokeWidth=".7"/>
        <circle cx="62" cy="4" r="2" fill="#D4A830" opacity=".5"/>
        <circle cx="4" cy="62" r="2" fill="#D4A830" opacity=".5"/>
        <polygon points="82,6 85,9 82,12 79,9" fill="#D4A830" opacity=".4"/>
        <polygon points="6,82 9,85 6,88 3,85" fill="#D4A830" opacity=".4"/>
        <path d="M48,2 C52,8 48,14 44,8 Z" fill="#D4A830" opacity=".15"/>
        <path d="M2,48 C8,52 14,48 8,44 Z" fill="#D4A830" opacity=".15"/>
      </g>

      {/* BOTTOM-RIGHT corner flourish */}
      <g transform="translate(1258,778) scale(-1,-1)">
        <path d="M0,120 C0,18 18,0 120,0" fill="none" stroke="#D4A830" strokeWidth="2.2"/>
        <path d="M0,95 C0,24 24,0 95,0" fill="none" stroke="#9A7018" strokeWidth="1.1"/>
        <path d="M0,72 C0,28 28,0 72,0" fill="none" stroke="#E8C040" strokeWidth=".7"/>
        <path d="M0,52 C0,33 33,0 52,0" fill="none" stroke="#C89A20" strokeWidth=".4" strokeDasharray="2,3"/>
        <circle cx="0" cy="0" r="8" fill="none" stroke="#D4A830" strokeWidth="1.2"/>
        <circle cx="0" cy="0" r="5" fill="none" stroke="#9A7018" strokeWidth=".7"/>
        <circle cx="0" cy="0" r="2.2" fill="#D4A830" opacity=".75"/>
        <path d="M18,0 C22,-4 28,-4 32,0" fill="none" stroke="#D4A830" strokeWidth=".7"/>
        <path d="M0,18 C-4,22 -4,28 0,32" fill="none" stroke="#D4A830" strokeWidth=".7"/>
        <circle cx="62" cy="4" r="2" fill="#D4A830" opacity=".5"/>
        <circle cx="4" cy="62" r="2" fill="#D4A830" opacity=".5"/>
        <polygon points="82,6 85,9 82,12 79,9" fill="#D4A830" opacity=".4"/>
        <polygon points="6,82 9,85 6,88 3,85" fill="#D4A830" opacity=".4"/>
        <path d="M48,2 C52,8 48,14 44,8 Z" fill="#D4A830" opacity=".15"/>
        <path d="M2,48 C8,52 14,48 8,44 Z" fill="#D4A830" opacity=".15"/>
      </g>

      {/* Midpoint interval panels - top */}
      <g transform="translate(426,0)">
        <rect x="-28" y="-8" width="56" height="16" fill="#0C0704" stroke="#D4A830" strokeWidth=".8"/>
        <rect x="-20" y="-4" width="40" height="8" fill="none" stroke="#9A7018" strokeWidth=".4"/>
        <circle cx="0" cy="0" r="2" fill="#D4A830"/>
      </g>
      <g transform="translate(853,0)">
        <rect x="-28" y="-8" width="56" height="16" fill="#0C0704" stroke="#D4A830" strokeWidth=".8"/>
        <rect x="-20" y="-4" width="40" height="8" fill="none" stroke="#9A7018" strokeWidth=".4"/>
        <circle cx="0" cy="0" r="2" fill="#D4A830"/>
      </g>

      {/* Midpoint interval panels - bottom */}
      <g transform="translate(426,800)">
        <rect x="-28" y="-8" width="56" height="16" fill="#0C0704" stroke="#D4A830" strokeWidth=".8"/>
        <rect x="-20" y="-4" width="40" height="8" fill="none" stroke="#9A7018" strokeWidth=".4"/>
        <circle cx="0" cy="0" r="2" fill="#D4A830"/>
      </g>
      <g transform="translate(853,800)">
        <rect x="-28" y="-8" width="56" height="16" fill="#0C0704" stroke="#D4A830" strokeWidth=".8"/>
        <rect x="-20" y="-4" width="40" height="8" fill="none" stroke="#9A7018" strokeWidth=".4"/>
        <circle cx="0" cy="0" r="2" fill="#D4A830"/>
      </g>

      {/* Midpoint interval panels - left */}
      <g transform="translate(0,266)">
        <rect x="-8" y="-28" width="16" height="56" fill="#0C0704" stroke="#D4A830" strokeWidth=".8"/>
        <rect x="-4" y="-20" width="8" height="40" fill="none" stroke="#9A7018" strokeWidth=".4"/>
        <circle cx="0" cy="0" r="2" fill="#D4A830"/>
      </g>
      <g transform="translate(0,533)">
        <rect x="-8" y="-28" width="16" height="56" fill="#0C0704" stroke="#D4A830" strokeWidth=".8"/>
        <rect x="-4" y="-20" width="8" height="40" fill="none" stroke="#9A7018" strokeWidth=".4"/>
        <circle cx="0" cy="0" r="2" fill="#D4A830"/>
      </g>

      {/* Midpoint interval panels - right */}
      <g transform="translate(1280,266)">
        <rect x="-8" y="-28" width="16" height="56" fill="#0C0704" stroke="#D4A830" strokeWidth=".8"/>
        <rect x="-4" y="-20" width="8" height="40" fill="none" stroke="#9A7018" strokeWidth=".4"/>
        <circle cx="0" cy="0" r="2" fill="#D4A830"/>
      </g>
      <g transform="translate(1280,533)">
        <rect x="-8" y="-28" width="16" height="56" fill="#0C0704" stroke="#D4A830" strokeWidth=".8"/>
        <rect x="-4" y="-20" width="8" height="40" fill="none" stroke="#9A7018" strokeWidth=".4"/>
        <circle cx="0" cy="0" r="2" fill="#D4A830"/>
      </g>
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
    status === 'auth_failed' ? 'Auth failed'  :
    status === 'error'       ? 'Error'        :
    token ? 'Disconnected' : 'No token set';

  if (editing) {
    return (
      <div className="conn-edit">
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
    <div className="conn-status" onClick={() => { setDraft(token); setEditing(true); }} title="Click to set gateway token">
      <div className={dotClass} />
      <span className="conn-label">{label}</span>
    </div>
  );
}

/* ── APP ─────────────────────────────────────────────────────────── */

const SCREEN_ORDER: ScreenId[] = [
  'overview', 'chat', 'talk', 'design',
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

function AppInner() {
  const [theme, setTheme]         = useState<Theme>('assay');
  const [screen, setScreen]       = useState<ScreenId>('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [clock, setClock]         = useState('');
  const [storeTick, setStoreTick] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);

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
      {theme === 'assay' && <AssayBorder />}

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

        <div className="sidebar-footer">
          <div className="theme-selector">
            <div className="theme-selector-label">Theme</div>
            <div className="theme-btns">
              {(['assay', 'politburo', 'blizzard'] as Theme[]).map(t => (
                <button
                  key={t}
                  className={`theme-btn ${theme === t ? 'active' : ''}`}
                  onClick={() => setTheme(t)}
                  title={THEME_META[t].name}
                >
                  {t === 'assay' ? 'A' : t === 'politburo' ? 'P' : 'B'}
                </button>
              ))}
            </div>
          </div>
          <ConnStatus />
        </div>
      </nav>

      <div id="main">
        <div id="topbar">
          <div className="breadcrumb">{labels[screen]}</div>
          <div className="topbar-meta">
            <span>Deltron Gateway · Sonnet 4.6</span>
            <span style={{ color: 'var(--ok)' }}>● Online</span>
            <span style={{ fontFamily: 'var(--fm)', fontSize: '10px' }}>{clock}</span>
          </div>
        </div>

        <div id="screen-host">
          {screen === 'overview' && <Overview />}
          {screen === 'chat'     && <Chat theme={theme} />}
          {screen === 'talk'     && <Talk theme={theme} />}
          {screen === 'design'   && <Design />}
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
