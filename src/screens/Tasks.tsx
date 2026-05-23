import { type Theme } from '../types';

interface Props { theme: Theme; }

const LABEL: Record<Theme, string> = { assay: 'Works Orders', politburo: 'Directives', blizzard: 'Objectives' };

export default function Tasks({ theme }: Props) {
  return (
    <div id="screen-tasks" className="screen">
      <div className="tasks-toolbar">
        <button className="btn">+ New {LABEL[theme].replace(/s$/, '')}</button>
        <span style={{fontSize:'11px',color:'var(--ink2)'}}>Project:</span>
        <select><option>All Projects</option><option>The Helm Build</option></select>
        <span style={{fontSize:'11px',color:'var(--ink2)'}}>Agent:</span>
        <select><option>All Agents</option><option>Deltron</option><option>Sage</option></select>
      </div>
      <div className="kanban">
        <div className="k-col">
          <div className="k-head">Backlog<span className="k-head-count">4</span></div>
          <div className="k-cards">
            <div className="k-card p-low">
              <div className="k-card-title">Add keyboard shortcuts panel</div>
              <div className="k-card-meta"><span className="pill pill-blue">The Helm</span><span className="pill pill-idle">Deltron</span></div>
            </div>
            <div className="k-card p-low">
              <div className="k-card-title">Mobile PWA manifest</div>
              <div className="k-card-meta"><span className="pill pill-blue">The Helm</span></div>
            </div>
          </div>
        </div>
        <div className="k-col">
          <div className="k-head">Queued<span className="k-head-count">2</span></div>
          <div className="k-cards">
            <div className="k-card p-high">
              <div className="k-card-title">Implement WebSocket RPC client</div>
              <div className="k-card-meta"><span className="pill pill-blue">The Helm</span><span className="pill pill-err">High</span></div>
              <div className="k-card-log">Scheduled: today 14:00 · Deltron assigned</div>
            </div>
          </div>
        </div>
        <div className="k-col">
          <div className="k-head">In Progress<span className="k-head-count">2</span></div>
          <div className="k-cards">
            <div className="k-card p-high">
              <div className="k-card-title">Build theme system (3 themes)</div>
              <div className="k-card-meta"><span className="pill pill-blue">The Helm</span><span className="pill pill-err">High</span><span className="pill pill-ok">Deltron</span></div>
              <div className="k-card-log">Completed CSS custom properties layer. Politburo + Assay + Blizzard implemented.</div>
            </div>
            <div className="k-card p-med">
              <div className="k-card-title">Chat session sidebar — search + filter</div>
              <div className="k-card-meta"><span className="pill pill-blue">The Helm</span><span className="pill pill-warn">Med</span></div>
            </div>
          </div>
        </div>
        <div className="k-col">
          <div className="k-head">Review<span className="k-head-count">1</span></div>
          <div className="k-cards">
            <div className="k-card p-high">
              <div className="k-card-title">Overview dashboard widget layout</div>
              <div className="k-card-meta"><span className="pill pill-blue">The Helm</span><span className="pill pill-err">High</span></div>
              <div className="k-card-log">Grid layout complete. All 10 widgets connected to mock data. Needs human approval.</div>
              <div className="human-req">⚑ Human Review Required</div>
            </div>
          </div>
        </div>
        <div className="k-col">
          <div className="k-head">Done<span className="k-head-count">3</span></div>
          <div className="k-cards">
            <div className="k-card p-high" style={{opacity:.6}}>
              <div className="k-card-title">Project scaffolding (Vite + React + TS)</div>
              <div className="k-card-meta"><span className="pill pill-ok">✓ Done</span></div>
            </div>
            <div className="k-card p-med" style={{opacity:.6}}>
              <div className="k-card-title">Sidebar navigation shell</div>
              <div className="k-card-meta"><span className="pill pill-ok">✓ Done</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
