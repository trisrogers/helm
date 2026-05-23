import { type Theme } from '../types';

interface ChatProps {
  theme: Theme;
}

export default function Chat({ theme }: ChatProps) {
  return (
    <div id="screen-chat" className="screen">
      <div className="chat-sessions">
        <div className="chat-sessions-head">
          <input placeholder="Search sessions…" style={{flex:1}} />
          <button className="btn" style={{padding:'5px 8px',fontSize:'10px'}}>+ New</button>
        </div>
        <div className="session-list">
          <div className="session-item active">
            <div className="session-title">Payment API Debug</div>
            <div className="session-preview">The 422 error is coming from the webhook validator…</div>
            <div className="session-meta"><span className="chan-badge">⚡ Direct</span><span>2m ago</span></div>
          </div>
          <div className="session-item">
            <div className="session-title">Weekly Standup Draft</div>
            <div className="session-preview">Here's a summary of this week's progress…</div>
            <div className="session-meta"><span className="chan-badge">📱 Telegram</span><span>1h ago</span></div>
          </div>
          <div className="session-item">
            <div className="session-title">Helm Architecture</div>
            <div className="session-preview">I'd recommend using Zustand for state management…</div>
            <div className="session-meta"><span className="chan-badge">⚡ Direct</span><span>3h ago</span></div>
          </div>
          <div className="session-item">
            <div className="session-title">Marketing Copy v3</div>
            <div className="session-preview">Here's the revised landing page copy…</div>
            <div className="session-meta"><span className="chan-badge">💬 Slack</span><span>Yesterday</span></div>
          </div>
          <div className="session-item">
            <div className="session-title">Research: LLM Routing</div>
            <div className="session-preview">The key papers on mixture-of-experts routing are…</div>
            <div className="session-meta"><span className="chan-badge">⚡ Direct</span><span>2d ago</span></div>
          </div>
        </div>
      </div>

      <div className="chat-main">
        <div className="chat-thread">
          <div className="msg user">
            <div className="msg-avatar">T</div>
            <div>
              <div className="msg-body">I'm getting a 422 on the payment webhook. The request body looks fine but Stripe keeps rejecting it. Here's the error: <code>webhook signature verification failed</code></div>
              <div className="msg-time">09:34</div>
            </div>
          </div>
          <div className="msg">
            <div className="msg-avatar">D</div>
            <div>
              <details className="thinking-block">
                <summary>▸ Thinking (3.2s)</summary>
                <div style={{marginTop:'6px'}}>Webhook signature failures typically indicate a timing issue or the raw body is being parsed before verification…</div>
              </details>
              <div className="msg-body">
                The 422 with <code>webhook signature verification failed</code> almost always means Stripe is checking the signature against a <em>parsed</em> body instead of the raw request bytes. The fix is to use the raw buffer before any JSON parsing middleware:
                <pre>{`// Express — this must come BEFORE body-parser
app.post('/webhook', express.raw({type:'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(
    req.body, sig, process.env.STRIPE_WEBHOOK_SECRET
  );
});`}</pre>
                Also double-check your <code>STRIPE_WEBHOOK_SECRET</code> is the endpoint secret (starts with <code>whsec_</code>), not the API key.
              </div>
              <div className="msg-time">09:35</div>
            </div>
          </div>
          <div className="msg user">
            <div className="msg-avatar">T</div>
            <div>
              <div className="msg-body">That was it! The body-parser was running first. Working now. Can you add a test for this case?</div>
              <div className="msg-time">09:37</div>
            </div>
          </div>
          <div className="msg">
            <div className="msg-avatar">D</div>
            <div>
              <div className="msg-body">Absolutely. Here's a Jest test that covers the signature verification:<span className="streaming-cursor" /></div>
              <div className="msg-time">09:38 · streaming…</div>
            </div>
          </div>
        </div>
        <div className="composer">
          <div className="composer-top">
            <span>Model:</span>
            <select><option>claude-sonnet-4-6</option><option>claude-opus-4-7</option><option>claude-haiku-4-5</option></select>
            <span style={{marginLeft:'8px'}}>Thinking:</span>
            <select><option>Auto</option><option>Enabled</option><option>Disabled</option></select>
            <button className="btn btn-ghost" style={{marginLeft:'auto',padding:'3px 8px',fontSize:'10px'}}>⊕ Attach</button>
            <button className="btn" style={{padding:'3px 8px',fontSize:'10px'}}>✕ Abort</button>
          </div>
          {/* Survival stats - visible only in blizzard theme via CSS */}
          <div className="survival-stats">
            <div className="surv-stat"><div className="surv-dot h"></div><div className="surv-bar"><div className="surv-fill h"></div></div></div>
            <div className="surv-stat"><div className="surv-dot w"></div><div className="surv-bar"><div className="surv-fill w"></div></div></div>
            <div className="surv-stat"><div className="surv-dot c"></div><div className="surv-bar"><div className="surv-fill c"></div></div></div>
            <div className="surv-stat"><div className="surv-dot f"></div><div className="surv-bar"><div className="surv-fill f"></div></div></div>
          </div>
          <div className="composer-row">
            <textarea placeholder="Message Deltron… (Enter to send, Shift+Enter for newline)" />
            <button className="btn" style={{alignSelf:'flex-end',padding:'8px 14px'}}>Send</button>
          </div>
        </div>
      </div>

      <div className="chat-info">
        <div className="card-title">Session Info</div>
        <div className="info-row"><span className="info-label">Session</span><span className="info-val">payment-api-debug</span></div>
        <div className="info-row"><span className="info-label">Agent</span><span className="info-val">Deltron Gateway</span></div>
        <div className="info-row"><span className="info-label">Model</span><span className="info-val">claude-sonnet-4-6</span></div>
        <div className="info-row"><span className="info-label">Channel</span><span className="info-val">Direct</span></div>
        <div className="info-row"><span className="info-label">Created</span><span className="info-val">2026-05-23 09:30</span></div>
        <div style={{marginTop:'4px'}}>
          <div className="card-title">Context Used</div>
          <div className="token-bar"><div className="token-fill" /></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',color:'var(--ink2)',marginTop:'3px'}}><span>12,450 / 200,000</span><span>6.2%</span></div>
        </div>
        <div style={{marginTop:'4px',display:'flex',flexDirection:'column',gap:'6px'}}>
          <button className="btn btn-ghost" style={{width:'100%'}}>Compact Context</button>
          <button className="btn btn-ghost" style={{width:'100%'}}>Reset Session</button>
          <button className="btn btn-ghost" style={{width:'100%',color:'var(--err)',borderColor:'var(--err)'}}>Delete Session</button>
        </div>
      </div>
    </div>
  );
}
