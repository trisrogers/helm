import { useState } from 'react';

export default function Skills() {
  const [tab, setTab] = useState<'installed'|'browse'>('installed');

  return (
    <div id="screen-skills" className="screen">
      <div className="skills-tabs">
        <div className={`skill-tab ${tab==='installed'?'active':''}`} onClick={() => setTab('installed')}>Installed (12)</div>
        <div className={`skill-tab ${tab==='browse'?'active':''}`} onClick={() => setTab('browse')}>Browse Clawhub</div>
      </div>
      <div className="skills-content">
        {tab === 'installed' && (
          <div className="skills-list">
            <div style={{display:'flex',gap:'6px',paddingBottom:'8px',borderBottom:'1px solid var(--brd)',marginBottom:'8px'}}>
              <button className="btn btn-ghost" style={{fontSize:'10px',padding:'3px 8px',flex:1}}>↻ Reload All</button>
            </div>
            <div className="skill-row active"><div className="skill-icon">🐙</div><div><div className="skill-row-name">github</div><div className="skill-row-desc">PR, issues, repos</div></div><span className="pill pill-ok" style={{marginLeft:'auto'}}>Active</span></div>
            <div className="skill-row"><div className="skill-icon">📝</div><div><div className="skill-row-name">notion</div><div className="skill-row-desc">Pages, databases</div></div><span className="pill pill-ok" style={{marginLeft:'auto'}}>Active</span></div>
            <div className="skill-row"><div className="skill-icon">🔍</div><div><div className="skill-row-name">websearch</div><div className="skill-row-desc">Web + news search</div></div><span className="pill pill-ok" style={{marginLeft:'auto'}}>Active</span></div>
            <div className="skill-row"><div className="skill-icon">📊</div><div><div className="skill-row-name">sheets</div><div className="skill-row-desc">Google Sheets R/W</div></div><span className="pill pill-warn" style={{marginLeft:'auto'}}>Update</span></div>
            <div className="skill-row"><div className="skill-icon">🗄</div><div><div className="skill-row-name">sqlite</div><div className="skill-row-desc">Local database queries</div></div><span className="pill pill-ok" style={{marginLeft:'auto'}}>Active</span></div>
            <div className="skill-row"><div className="skill-icon">📧</div><div><div className="skill-row-name">email</div><div className="skill-row-desc">Send via SMTP/Gmail</div></div><span className="pill pill-err" style={{marginLeft:'auto'}}>Error</span></div>
          </div>
        )}
        {tab === 'browse' && (
          <div className="clawhub">
            <div className="clawhub-search">
              <input placeholder="Search Clawhub skills…" defaultValue="linear" />
              <button className="btn">Search</button>
            </div>
            <div className="clawhub-grid">
              <div className="hub-card"><div className="hub-card-name">linear</div><div className="hub-card-desc">Manage Linear issues, projects, and cycles</div><div className="hub-card-meta"><span>⭐ 412</span><span>v2.1.0</span><span style={{color:'var(--ok)'}}>✓ Vetted</span></div></div>
              <div className="hub-card"><div className="hub-card-name">linear-webhooks</div><div className="hub-card-desc">React to Linear events via webhooks</div><div className="hub-card-meta"><span>⭐ 88</span><span>v1.0.2</span><span style={{color:'var(--warn)'}}>⚠ Review</span></div></div>
              <div className="hub-card"><div className="hub-card-name">clickup</div><div className="hub-card-desc">ClickUp tasks and workspace management</div><div className="hub-card-meta"><span>⭐ 156</span><span>v1.3.1</span><span style={{color:'var(--ok)'}}>✓ Vetted</span></div></div>
            </div>
          </div>
        )}
        <div className="skill-detail">
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'18px',color:'var(--acc)'}}>github</div>
            <span className="pill pill-ok">Active</span>
            <span style={{fontSize:'11px',color:'var(--ink2)',marginLeft:'auto'}}>v3.2.1 · installed 14d ago</span>
          </div>
          <div className="skill-readme">
            <h3>GitHub Skill</h3>
            <p>Provides full GitHub API access including pull requests, issues, repositories, and code review workflows.</p>
            <p><b>Capabilities:</b> Create PRs, comment on issues, review diffs, merge branches, manage releases.</p>
            <p><b>Usage:</b> <code>Create a PR from feature/auth to main with the changes from today</code></p>
          </div>
          <div className="security-panel">
            <h4>Security Permissions</h4>
            <div className="perm-row">⚙ Exec: <code style={{fontFamily:'var(--fm)',fontSize:'10px',background:'var(--surf2)',padding:'1px 4px'}}>gh</code> command</div>
            <div className="perm-row danger">⚠ Network: github.com API access</div>
            <div className="perm-row">📁 Read: working directory files</div>
            <div className="perm-row">✓ No write access to system files</div>
          </div>
          <div style={{display:'flex',gap:'8px'}}>
            <button className="btn">Test Skill</button>
            <button className="btn btn-ghost">Edit SKILL.md</button>
            <button className="btn btn-ghost" style={{color:'var(--err)',borderColor:'var(--err)'}}>Uninstall</button>
          </div>
        </div>
      </div>
    </div>
  );
}
