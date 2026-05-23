import { type Theme } from '../types';

interface Props { theme: Theme; }

const TITLE: Record<Theme, string> = { assay: 'Ventures', politburo: 'Objectives', blizzard: 'Expeditions' };

export default function Goals({ theme }: Props) {
  return (
    <div id="screen-goals" className="screen">
      <div className="goals-list">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0 12px',borderBottom:'1px solid var(--brd)',marginBottom:'8px'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'14px',color:'var(--acc)'}}>{TITLE[theme]}</div>
          <button className="btn" style={{fontSize:'10px',padding:'4px 8px'}}>+ New</button>
        </div>
        <div className="goal-card active">
          <div className="goal-card-title">Build &amp; Ship The Helm v1</div>
          <div className="goal-card-desc">Full web control surface for OpenClaw with 9 features</div>
          <div className="goal-progress">
            <svg className="prog-ring" viewBox="0 0 36 36">
              <circle className="prog-track" cx="18" cy="18" r="15.9"/>
              <circle className="prog-fill" cx="18" cy="18" r="15.9" strokeDasharray="30 70" strokeDashoffset="0"/>
            </svg>
            <div><div style={{fontSize:'11px',color:'var(--ink)'}}>30% complete</div><div style={{fontSize:'10px',color:'var(--ink2)'}}>6 of 20 tasks done</div></div>
          </div>
          <div style={{marginTop:'8px',display:'flex',gap:'4px',flexWrap:'wrap'}}>
            <span className="pill pill-ok">Active</span>
            <span className="pill pill-blue">Deltron</span>
          </div>
        </div>
        <div className="goal-card">
          <div className="goal-card-title">Automate Weekly Reports</div>
          <div className="goal-card-desc">Cron-driven Slack + email digest from all active sessions</div>
          <div className="goal-progress">
            <svg className="prog-ring" viewBox="0 0 36 36">
              <circle className="prog-track" cx="18" cy="18" r="15.9"/>
              <circle className="prog-fill" cx="18" cy="18" r="15.9" strokeDasharray="75 25" strokeDashoffset="0"/>
            </svg>
            <div><div style={{fontSize:'11px',color:'var(--ink)'}}>75% complete</div><div style={{fontSize:'10px',color:'var(--ink2)'}}>3 of 4 tasks done</div></div>
          </div>
        </div>
        <div className="goal-card">
          <div className="goal-card-title">Research: Voice Mode Providers</div>
          <div className="goal-card-desc">Evaluate ElevenLabs vs built-in talk.* vs Deepgram</div>
          <div className="goal-progress">
            <svg className="prog-ring" viewBox="0 0 36 36">
              <circle className="prog-track" cx="18" cy="18" r="15.9"/>
              <circle className="prog-fill" cx="18" cy="18" r="15.9" strokeDasharray="0 100" strokeDashoffset="0"/>
            </svg>
            <div><div style={{fontSize:'11px',color:'var(--ink)'}}>Drafting</div><div style={{fontSize:'10px',color:'var(--ink2)'}}>Tasks not yet generated</div></div>
          </div>
        </div>
      </div>
      <div className="goal-detail">
        <div className="goal-detail-title">Build &amp; Ship The Helm v1</div>
        <div style={{fontSize:'12px',color:'var(--ink2)',lineHeight:1.6,padding:'12px',background:'var(--surf)',border:'1px solid var(--brd)',borderRadius:'var(--r)'}}>
          A purpose-built web control surface for OpenClaw covering all 9 feature domains. Must integrate via WebSocket JSON-RPC, support three themes, and be served from the existing Gateway process. Target: MVP (Chat + Overview + Editor) in 6 weeks.
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          <div className="card-title">Tasks</div>
          <button className="btn btn-ghost" style={{fontSize:'10px',padding:'3px 8px',marginLeft:'auto'}}>✦ Generate Tasks with AI</button>
        </div>
        <div className="goal-tasks-grid">
          <div className="goal-task-row"><div className="dot dot-ok"/><span>Project scaffolding (Vite + React + TS)</span><span className="pill pill-ok stage">Done</span></div>
          <div className="goal-task-row"><div className="dot dot-ok"/><span>Sidebar navigation shell</span><span className="pill pill-ok stage">Done</span></div>
          <div className="goal-task-row"><div className="dot dot-warn"/><span>Build theme system (3 themes)</span><span className="pill pill-warn stage">In Progress</span></div>
          <div className="goal-task-row"><div className="dot dot-warn"/><span>Chat session sidebar + thread</span><span className="pill pill-warn stage">In Progress</span></div>
          <div className="goal-task-row"><div className="dot dot-err"/><span>Overview dashboard widgets</span><span className="pill pill-err stage">Review</span></div>
          <div className="goal-task-row"><div className="dot dot-idle"/><span>WebSocket RPC client wrapper</span><span className="pill pill-idle stage">Queued</span></div>
        </div>
        <div className="card-title">AI Narrative Log</div>
        <div className="ai-log">
          <div className="ai-log-entry"><span className="ai-log-time">Today</span><span>Theme system is proving the most complex piece — CSS custom properties handle colors well but font switching requires careful specificity management. Three themes now implemented: Assay Office, Politburo, First Blizzard.</span></div>
          <div className="ai-log-entry"><span className="ai-log-time">May 22</span><span>Scaffolding complete. Vite + React config straightforward. Decided against Tailwind in favour of pure CSS custom properties for theme switching — simpler and more direct for this use case.</span></div>
          <div className="ai-log-entry"><span className="ai-log-time">May 21</span><span><b>Clarification needed:</b> Should the WebSocket client reconnect automatically on disconnect, or surface an error and require user action? Leaning towards auto-reconnect with exponential backoff + visible indicator.</span></div>
        </div>
      </div>
    </div>
  );
}
