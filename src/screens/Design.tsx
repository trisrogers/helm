export default function Design() {
  return (
    <div id="screen-design" className="screen">
      <div className="design-left">
        <div style={{padding:'8px 12px',borderBottom:'1px solid var(--brd)',background:'var(--surf)',display:'flex',gap:'8px',alignItems:'center',fontSize:'11px',color:'var(--ink2)'}}>
          <span>Design session</span>
          <span className="pill pill-ok">Live preview</span>
          <span style={{marginLeft:'auto',cursor:'pointer',color:'var(--acc)'}}>v4 ▾</span>
        </div>
        <div className="chat-thread" style={{flex:1}}>
          <div className="msg user">
            <div className="msg-avatar">T</div>
            <div><div className="msg-body">Create a simple interactive counter with increment/decrement buttons. Clean, modern style, blue accent.</div></div>
          </div>
          <div className="msg">
            <div className="msg-avatar">D</div>
            <div><div className="msg-body">Here's the counter component. Preview is live on the right.<span className="streaming-cursor" /></div></div>
          </div>
        </div>
        <div className="version-list">
          <span style={{fontSize:'10px',color:'var(--ink2)',flexShrink:0}}>Versions:</span>
          <div className="version-chip">v1 Initial</div>
          <div className="version-chip">v2 Styled</div>
          <div className="version-chip">v3 Dark mode</div>
          <div className="version-chip active">v4 Current</div>
        </div>
        <div className="composer" style={{padding:'10px'}}>
          <div className="composer-row">
            <textarea placeholder="Refine the design…" style={{height:'44px'}} />
            <button className="btn" style={{alignSelf:'flex-end',padding:'7px 12px'}}>→</button>
          </div>
        </div>
      </div>
      <div className="design-right">
        <div className="viewport-bar">
          <span style={{color:'var(--ink2)',marginRight:'4px'}}>Viewport:</span>
          <button className="viewport-btn active">Desktop</button>
          <button className="viewport-btn">Tablet</button>
          <button className="viewport-btn">Mobile</button>
          <span style={{flex:1}} />
          <button className="btn btn-ghost" style={{fontSize:'10px',padding:'3px 8px'}}>⬡ Publish</button>
          <button className="btn btn-ghost" style={{fontSize:'10px',padding:'3px 8px'}}>⬇ Export</button>
          <button className="btn btn-ghost" style={{fontSize:'10px',padding:'3px 8px'}}>↗ Full tab</button>
        </div>
        <div className="iframe-wrap">
          <div className="iframe-frame">
            <div className="iframe-inner">
              <h2>Interactive Counter</h2>
              <p>A clean, accessible counter component with smooth state transitions.</p>
              <div className="counter-box">
                <button className="demo-btn" style={{padding:'8px 16px',fontSize:'18px',background:'#e5f0ff',color:'#1a6bbf',border:'1px solid #1a6bbf'}}>−</button>
                <span className="count">7</span>
                <button className="demo-btn" style={{padding:'8px 16px',fontSize:'18px'}}>+</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
