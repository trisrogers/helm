export default function Editor() {
  return (
    <div id="screen-editor" className="screen">
      <div className="editor-tree">
        <div className="tree-section">Agent Files</div>
        <div className="tree-item active">📄 SOUL.md</div>
        <div className="tree-item modified">📄 AGENTS.md</div>
        <div className="tree-item">📄 TOOLS.md</div>
        <div className="tree-item">📄 IDENTITY.md</div>
        <div className="tree-item">📄 USER.md</div>
        <div className="tree-item">📄 BOOTSTRAP.md</div>
        <div className="tree-item">📄 MEMORY.md</div>
        <div className="tree-item">📄 HEARTBEAT.md</div>
        <div className="tree-section" style={{marginTop:'8px'}}>Config</div>
        <div className="tree-item">⚙ openclaw.json</div>
      </div>
      <div className="editor-main">
        <div className="editor-toolbar">
          <span className="editor-file">SOUL.md</span>
          <span className="pill pill-ok">Saved</span>
          <button className="btn" style={{fontSize:'10px',padding:'3px 8px'}}>Save</button>
          <button className="btn btn-ghost" style={{fontSize:'10px',padding:'3px 8px'}}>Revert</button>
          <button className="btn" style={{fontSize:'10px',padding:'3px 8px',background:'var(--ok)',color:'var(--bg)'}}>Apply &amp; Reload Agent</button>
        </div>
        <div className="editor-body">
          <div className="line-nums">
            <div className="gutter">{Array.from({length:16}).map((_,i) => <span key={i}>{i+1}<br /></span>)}</div>
            <div className="code-area">
              <span className="cm-h1"># SOUL</span><br /><br />
              <span className="cm-h2">## Identity</span><br />
              <span>You are <span className="cm-bold">**Deltron**</span>, an AI gateway operative for the Birmingham</span><br />
              <span>intelligence network. You are precise, thoughtful, and direct.</span><br /><br />
              <span className="cm-h2">## Personality</span><br />
              <span>- Speaks with quiet confidence; never verbose</span><br />
              <span>- Prefers concrete examples over abstract principles</span><br />
              <span>- Admits uncertainty rather than fabricating</span><br />
              <span>- Has a dry wit that surfaces occasionally</span><br /><br />
              <span className="cm-h2">## Communication Style</span><br />
              <span>Use <span className="cm-bold">**markdown**</span> for code and structured output.</span><br />
              <span>Keep responses <span className="cm-italic">focused and scannable</span>.</span><br />
              <span>Lead with the answer, then supporting detail.</span>
            </div>
          </div>
        </div>
      </div>
      <div className="editor-ctx">
        <div className="ctx-head">Context Assembly Preview</div>
        <div className="ctx-section">
          <div style={{fontSize:'10px',color:'var(--ink2)',marginBottom:'6px'}}>Files injected at session start (priority order):</div>
          <div className="ctx-file"><span className="ctx-file-name">SOUL.md</span><span className="ctx-file-tokens">420 tokens</span></div>
          <div className="ctx-file"><span className="ctx-file-name">AGENTS.md</span><span className="ctx-file-tokens">310 tokens</span></div>
          <div className="ctx-file"><span className="ctx-file-name">TOOLS.md</span><span className="ctx-file-tokens">180 tokens</span></div>
          <div className="ctx-file"><span className="ctx-file-name">IDENTITY.md</span><span className="ctx-file-tokens">95 tokens</span></div>
          <div className="ctx-file"><span className="ctx-file-name">USER.md</span><span className="ctx-file-tokens">210 tokens</span></div>
        </div>
        <div className="cache-line" />
        <div className="cache-label">↑ cached above this line</div>
        <div className="ctx-section">
          <div className="ctx-file"><span className="ctx-file-name">HEARTBEAT.md</span><span className="ctx-file-tokens">88 tokens</span></div>
          <div className="ctx-file"><span className="ctx-file-name">BOOTSTRAP.md</span><span className="ctx-file-tokens">145 tokens</span></div>
        </div>
        <div className="ctx-total">
          <span style={{color:'var(--ink2)'}}>Total context</span>
          <span style={{color:'var(--acc)',fontFamily:'var(--fm)'}}>1,448 tokens</span>
        </div>
        <div style={{padding:'8px 12px',borderTop:'1px solid var(--brd)'}}>
          <button className="btn btn-ghost" style={{width:'100%',fontSize:'10px'}}>Simulate Session Load</button>
        </div>
      </div>
    </div>
  );
}
