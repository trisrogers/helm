export default function Orch() {
  return (
    <div id="screen-orch" className="screen">
      <div className="card-title" style={{padding:'0 0 8px'}}>Live Agent Activity</div>
      <div className="agent-grid">
        <div className="agent-card">
          <div className="agent-status-dot"><div className="dot dot-ok" style={{animation:'pulse 1.5s infinite'}} /></div>
          <div className="agent-card-head">
            <div className="agent-icon">🤖</div>
            <div><div className="agent-name">Deltron</div><div className="agent-status-label">Processing</div></div>
          </div>
          <div className="agent-stat"><span>Session</span><b>payment-api-debug</b></div>
          <div className="agent-stat"><span>Channel</span><b>Direct</b></div>
          <div className="agent-stat"><span>Model</span><b>sonnet-4-6</b></div>
          <div className="agent-stat"><span>Tokens/sec</span><b>48</b></div>
          <div className="agent-stat"><span>Last msg</span><b>2m ago</b></div>
          <button className="btn btn-ghost" style={{width:'100%',marginTop:'8px',fontSize:'10px'}}>Open Session →</button>
        </div>
        <div className="agent-card">
          <div className="agent-status-dot"><div className="dot dot-warn" /></div>
          <div className="agent-card-head">
            <div className="agent-icon">🧠</div>
            <div><div className="agent-name">Sage</div><div className="agent-status-label">Waiting for input</div></div>
          </div>
          <div className="agent-stat"><span>Session</span><b>research-llm-routing</b></div>
          <div className="agent-stat"><span>Channel</span><b>Telegram</b></div>
          <div className="agent-stat"><span>Model</span><b>opus-4-7</b></div>
          <div className="agent-stat"><span>Tokens/sec</span><b>—</b></div>
          <div className="agent-stat"><span>Last msg</span><b>1h ago</b></div>
          <button className="btn btn-ghost" style={{width:'100%',marginTop:'8px',fontSize:'10px'}}>Open Session →</button>
        </div>
        <div className="agent-card">
          <div className="agent-status-dot"><div className="dot dot-idle" /></div>
          <div className="agent-card-head">
            <div className="agent-icon">⚙</div>
            <div><div className="agent-name">Dev Assistant</div><div className="agent-status-label">Idle</div></div>
          </div>
          <div className="agent-stat"><span>Session</span><b>—</b></div>
          <div className="agent-stat"><span>Channel</span><b>—</b></div>
          <div className="agent-stat"><span>Model</span><b>sonnet-4-6</b></div>
          <div className="agent-stat"><span>Last active</span><b>3h ago</b></div>
          <button className="btn btn-ghost" style={{width:'100%',marginTop:'8px',fontSize:'10px'}}>Start Session →</button>
        </div>
      </div>

      <div>
        <div className="card-title" style={{marginBottom:'8px'}}>Agent Communication Graph</div>
        <div className="comm-graph">
          <div className="comm-node">D</div>
          <div style={{position:'relative',display:'flex',alignItems:'center'}}>
            <div style={{width:'120px',height:'2px',background:'linear-gradient(90deg,var(--acc),transparent,var(--acc))',position:'relative'}}>
              <div style={{position:'absolute',top:'-8px',left:'40px',fontSize:'9px',color:'var(--ink2)'}}>→ A2A msg 2m ago</div>
            </div>
          </div>
          <div className="comm-node">S</div>
          <div style={{position:'relative',display:'flex',alignItems:'center'}}>
            <div style={{width:'120px',height:'2px',borderTop:'1px dashed var(--brd)'}}>
              <div style={{position:'absolute',top:'-8px',left:'30px',fontSize:'9px',color:'var(--ink2)'}}>No recent comms</div>
            </div>
          </div>
          <div className="comm-node" style={{opacity:.4}}>W</div>
        </div>
      </div>

      <div>
        <div className="card-title" style={{marginBottom:'8px'}}>Session Timeline (last 2h)</div>
        <div className="timeline">
          <div className="tl-row">
            <span className="tl-agent">Deltron</span>
            <div className="tl-events">
              {['msg','tool','msg','ok','msg','msg','tool','ok'].map((t,i) => <div key={i} className={`tl-ev tl-ev-${t}`} />)}
            </div>
            <span style={{fontSize:'9px',color:'var(--ink2)',marginLeft:'auto'}}>now</span>
          </div>
          <div className="tl-row">
            <span className="tl-agent">Sage</span>
            <div className="tl-events">
              {['msg','msg'].map((t,i) => <div key={i} className={`tl-ev tl-ev-${t}`} />)}
              {Array.from({length:5}).map((_,i) => <div key={i+2} className="tl-ev" style={{background:'transparent'}} />)}
            </div>
            <span style={{fontSize:'9px',color:'var(--ink2)',marginLeft:'auto'}}>1h ago</span>
          </div>
        </div>
        <div style={{display:'flex',gap:'12px',marginTop:'6px',fontSize:'9px',color:'var(--ink2)'}}>
          <span><span className="tl-ev tl-ev-msg" style={{display:'inline-block',verticalAlign:'middle'}} /> Message</span>
          <span><span className="tl-ev tl-ev-tool" style={{display:'inline-block',verticalAlign:'middle'}} /> Tool call</span>
          <span><span className="tl-ev tl-ev-ok" style={{display:'inline-block',verticalAlign:'middle'}} /> Approval</span>
        </div>
      </div>
    </div>
  );
}
