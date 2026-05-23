export default function Plan() {
  return (
    <div id="screen-plan" className="screen">
      <div style={{fontFamily:'var(--fd)',fontSize:'22px',color:'var(--acc)',borderBottom:'1px solid var(--brd)',paddingBottom:'12px'}}>The Helm — Phased Build Plan</div>

      <div className="plan-phase">
        <div className="phase-head">
          <div className="phase-num">0</div>
          <div><div className="phase-title">Foundation</div><div className="phase-sub">Sprint 1 · 2 weeks · Goal: shell, WS client, themes, navigation</div></div>
        </div>
        <div className="phase-tasks">
          <div className="phase-task">Scaffold Vite + React + TypeScript in /projects/helm</div>
          <div className="phase-task">Build OpenClaw WebSocket JSON-RPC client (connect, auth, subscribe, call)</div>
          <div className="phase-task">CSS custom properties theme system with Assay Office + Politburo + First Blizzard tokens</div>
          <div className="phase-task">Collapsible sidebar navigation, 3-way theme selector, connection status</div>
          <div className="phase-task">Register /helm static route in openclaw-src/gateway/server-http.ts</div>
          <div className="phase-task">Auth flow: token from localStorage → WS connect handshake</div>
        </div>
        <div className="model-recs">
          <div className="model-rec opus"><b>Opus 4.7</b> + extended thinking — architecture decisions</div>
          <div className="model-rec sonnet"><b>Sonnet 4.6</b> — scaffolding, WS client, CSS</div>
        </div>
      </div>

      <div className="plan-phase">
        <div className="phase-head">
          <div className="phase-num">1</div>
          <div><div className="phase-title">MVP Core</div><div className="phase-sub">Sprints 2–3 · 4 weeks · MVP: Chat + Overview + Editor</div></div>
        </div>
        <div className="phase-tasks">
          <div className="phase-task">Chat: session list, message streaming, composer, info panel</div>
          <div className="phase-task">Overview: all 10 widgets wired to live Gateway RPC data</div>
          <div className="phase-task">Editor: file tree, CodeMirror 6 editor, context assembly preview</div>
          <div className="phase-task">Approval quick-actions from Overview pending approvals widget</div>
        </div>
        <div className="model-recs">
          <div className="model-rec sonnet"><b>Sonnet 4.6</b> — chat streaming, dashboard layout</div>
          <div className="model-rec opus"><b>Opus 4.7</b> — context assembly preview logic</div>
          <div className="model-rec haiku"><b>Haiku 4.5</b> — component QA, accessibility</div>
        </div>
      </div>

      <div className="plan-phase">
        <div className="phase-head">
          <div className="phase-num">2</div>
          <div><div className="phase-title">Voice &amp; Design</div><div className="phase-sub">Sprints 4–5 · 4 weeks · Talk mode, Design canvas, Skills mgmt</div></div>
        </div>
        <div className="phase-tasks">
          <div className="phase-task">Talk: Web Audio API waveform, talk.* RPC integration, push-to-talk + auto-detect</div>
          <div className="phase-task">Design: split pane, sandboxed iframe preview, version history, export to artifact gallery</div>
          <div className="phase-task">Skills: installed list, Clawhub browse + search, security vet panel, install flow</div>
        </div>
        <div className="model-recs">
          <div className="model-rec opus"><b>Opus 4.7</b> — voice/WebRTC async complexity, security vet logic</div>
          <div className="model-rec sonnet"><b>Sonnet 4.6</b> — iframe sandbox rendering, skills UI</div>
          <div className="model-rec haiku"><b>Haiku 4.5</b> — skills list components</div>
        </div>
      </div>

      <div className="plan-phase">
        <div className="phase-head">
          <div className="phase-num">3</div>
          <div><div className="phase-title">Tasks &amp; Goals</div><div className="phase-sub">Sprints 6–8 · 6 weeks · Full pipeline, AI decomposition, scheduling</div></div>
        </div>
        <div className="phase-tasks">
          <div className="phase-task">Helm SQLite schema (tasks, goals, commentary_log) + thin Express router in Gateway</div>
          <div className="phase-task">Tasks: kanban board (react-beautiful-dnd), detail panel, AI commentary log, cron scheduling</div>
          <div className="phase-task">Goals: creation modal, AI task decomposition flow, progress tracking, narrative log</div>
          <div className="phase-task">Human review stage: feedback form, re-queue mechanism, notification badges</div>
        </div>
        <div className="model-recs">
          <div className="model-rec opus"><b>Opus 4.7</b> + extended thinking — schema design, task decomposition prompts</div>
          <div className="model-rec sonnet"><b>Sonnet 4.6</b> — kanban DnD, scheduling UI</div>
          <div className="model-rec haiku"><b>Haiku 4.5</b> — progress calculations, badges</div>
        </div>
      </div>

      <div className="plan-phase">
        <div className="phase-head">
          <div className="phase-num">4</div>
          <div><div className="phase-title">Orchestration &amp; Polish</div><div className="phase-sub">Sprints 9–11 · 6 weeks · Live graph, multi-user auth, polish</div></div>
        </div>
        <div className="phase-tasks">
          <div className="phase-task">Orchestration: agent card grid, A2A communication graph (D3/Recharts), session timeline</div>
          <div className="phase-task">Multi-user: user table, per-user agent visibility, login page</div>
          <div className="phase-task">Polish: full theme consistency pass, keyboard nav, responsive breakpoints, PWA manifest</div>
          <div className="phase-task">Extendability: plugin slot API for future Claude Code / Codex harness integrations</div>
        </div>
        <div className="model-recs">
          <div className="model-rec opus"><b>Opus 4.7</b> + extended thinking — auth design, D3 graph</div>
          <div className="model-rec sonnet"><b>Sonnet 4.6</b> — theme polish, virtualization, PWA</div>
        </div>
      </div>

      <div style={{background:'var(--surf)',border:'1px solid var(--brd)',borderRadius:'var(--r)',padding:'16px'}}>
        <div className="card-title" style={{marginBottom:'10px'}}>Bonus Features (beyond stated scope)</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',fontSize:'11px',color:'var(--ink2)'}}>
          <div>⌘K <b style={{color:'var(--ink)'}}>Command Palette</b> — jump anywhere from any screen</div>
          <div>🔔 <b style={{color:'var(--ink)'}}>Notification Center</b> — unified human-attention feed</div>
          <div>⑂ <b style={{color:'var(--ink)'}}>Session Branching</b> — fork any message, explore alternatives</div>
          <div>💰 <b style={{color:'var(--ink)'}}>Cost Budgets</b> — per-agent daily/monthly limits</div>
          <div>📋 <b style={{color:'var(--ink)'}}>Audit Log</b> — immutable log of all file/config changes</div>
          <div>📱 <b style={{color:'var(--ink)'}}>Mobile PWA</b> — Talk mode on mobile browsers</div>
        </div>
      </div>
    </div>
  );
}
