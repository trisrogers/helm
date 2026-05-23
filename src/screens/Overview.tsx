export default function Overview() {
  return (
    <div id="screen-overview" className="screen active">
      <div className="stat-grid">
        <div className="card">
          <div className="card-title">Active Sessions</div>
          <div className="stat-val">3</div>
          <div className="stat-sub">↑1 from yesterday</div>
        </div>
        <div className="card">
          <div className="card-title">Messages Today</div>
          <div className="stat-val">47</div>
          <div className="stat-sub">31 in / 16 out</div>
        </div>
        <div className="card">
          <div className="card-title">Tokens Used</div>
          <div className="stat-val">2.4M</div>
          <div className="stat-sub">Cache hit: 68%</div>
        </div>
        <div className="card">
          <div className="card-title">Est. Cost Today</div>
          <div className="stat-val">$0.82</div>
          <div className="stat-sub">$18.40 this month</div>
        </div>
      </div>

      <div className="mid-grid">
        <div className="card">
          <div className="card-title">Channel Health</div>
          <div className="channel-row"><div className="dot dot-ok" /><span style={{flex:1}}>Telegram</span><span className="pill pill-ok">● Live</span></div>
          <div className="channel-row"><div className="dot dot-ok" /><span style={{flex:1}}>Slack</span><span className="pill pill-ok">● Live</span></div>
          <div className="channel-row"><div className="dot dot-err" /><span style={{flex:1}}>Discord</span><span className="pill pill-err">✗ Auth Error</span></div>
          <div className="channel-row"><div className="dot dot-ok" /><span style={{flex:1}}>WhatsApp</span><span className="pill pill-ok">● Live</span></div>
          <div className="channel-row"><div className="dot dot-idle" /><span style={{flex:1}}>Signal</span><span className="pill pill-idle">Idle</span></div>
        </div>
        <div className="card">
          <div className="card-title">Recent Events</div>
          <div className="event-row"><span className="event-time">09:41</span><div className="event-text"><b>Deltron</b> sent reply via Telegram (847 tokens)</div></div>
          <div className="event-row"><span className="event-time">09:38</span><div className="event-text">Exec approval requested: <code style={{fontFamily:'var(--fm)',fontSize:'10px',color:'var(--warn)'}}>git push origin main</code></div></div>
          <div className="event-row"><span className="event-time">09:22</span><div className="event-text"><b>Sage</b> session started · model: Opus 4.7</div></div>
          <div className="event-row"><span className="event-time">09:15</span><div className="event-text">Skill <b>github</b> invoked · PR #142 created</div></div>
          <div className="event-row"><span className="event-time">08:50</span><div className="event-text">Cron job <b>daily-standup</b> fired successfully</div></div>
          <div className="event-row"><span className="event-time">08:30</span><div className="event-text">Gateway started · uptime reset</div></div>
        </div>
      </div>

      <div className="bottom-grid">
        <div className="card">
          <div className="card-title">Pending Approvals <span className="badge" style={{fontSize:'10px'}}>2</span></div>
          <div className="approval-row">
            <span className="approval-cmd">git push origin main</span>
            <button className="btn" style={{fontSize:'10px',padding:'3px 8px'}}>Allow</button>
            <button className="btn btn-ghost" style={{fontSize:'10px',padding:'3px 8px'}}>Deny</button>
          </div>
          <div className="approval-row">
            <span className="approval-cmd">rm -rf ./dist</span>
            <button className="btn" style={{fontSize:'10px',padding:'3px 8px'}}>Allow</button>
            <button className="btn btn-ghost" style={{fontSize:'10px',padding:'3px 8px'}}>Deny</button>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Next Scheduled Jobs</div>
          <div className="cron-row"><span className="cron-time">14:00 daily</span><span>Daily standup report</span><span className="pill pill-ok" style={{marginLeft:'auto',fontSize:'9px'}}>Active</span></div>
          <div className="cron-row"><span className="cron-time">Mon 09:00</span><span>Weekly summary → Slack</span><span className="pill pill-ok" style={{marginLeft:'auto',fontSize:'9px'}}>Active</span></div>
          <div className="cron-row"><span className="cron-time">*/30 mins</span><span>Health ping all channels</span><span className="pill pill-ok" style={{marginLeft:'auto',fontSize:'9px'}}>Active</span></div>
        </div>
        <div className="card">
          <div className="card-title">Active Agents</div>
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'12px'}}><div className="dot dot-ok" />Deltron Gateway<span style={{marginLeft:'auto',fontSize:'10px',color:'var(--ink2)'}}>claude-sonnet-4-6</span></div>
            <div style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'12px'}}><div className="dot dot-warn" />Sage<span style={{marginLeft:'auto',fontSize:'10px',color:'var(--ink2)'}}>claude-opus-4-7</span></div>
            <div style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'12px'}}><div className="dot dot-idle" />Dev Assistant<span style={{marginLeft:'auto',fontSize:'10px',color:'var(--ink2)'}}>Idle</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
