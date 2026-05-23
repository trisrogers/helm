import { useState, useEffect } from 'react';
import { type Theme, type ScreenId, NAV_LABELS, THEME_META } from './types';
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

const NAV_SECTIONS: { label: string; items: { id: ScreenId; icon: string; badge?: number }[] }[] = [
  {
    label: 'Navigation',
    items: [
      { id: 'overview', icon: '⊡' },
      { id: 'chat',     icon: '◻', badge: 3 },
      { id: 'talk',     icon: '◉' },
      { id: 'design',   icon: '⬚' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'tasks', icon: '☑', badge: 2 },
      { id: 'goals', icon: '◎' },
      { id: 'orch',  icon: '⊹' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'editor', icon: '⬜' },
      { id: 'skills', icon: '⬡' },
    ],
  },
  {
    label: 'Spec',
    items: [{ id: 'plan', icon: '📋' }],
  },
];

export default function App() {
  const [theme, setTheme]       = useState<Theme>('assay');
  const [screen, setScreen]     = useState<ScreenId>('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [clock, setClock]       = useState('');

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

  const labels = NAV_LABELS[theme];
  const meta   = THEME_META[theme];

  return (
    <>
      <nav id="sidebar" className={collapsed ? 'collapsed' : ''}>
        <div className="logo" onClick={() => setCollapsed(c => !c)}>
          <div className="logo-mark">H</div>
          <div className="logo-text">
            <h1>THE HELM</h1>
            <p>{meta.sub}</p>
          </div>
        </div>

        <div className="sidebar-nav">
          {NAV_SECTIONS.map(({ label, items }) => (
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
          <div className="conn-status">
            <div className="conn-dot" />
            <span className="conn-label">Connected · :18789</span>
          </div>
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
          {screen === 'chat'     && <Chat />}
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
    </>
  );
}
