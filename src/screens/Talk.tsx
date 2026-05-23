import { useEffect, useState } from 'react';
import { type Theme } from '../types';

interface Props { theme: Theme; }

const AGENT_NAME: Record<Theme, string> = {
  assay: 'DELTRON',
  politburo: 'UNIT-7',
  blizzard: 'THE VOICE',
};

export default function Talk({ theme }: Props) {
  const [status, setStatus] = useState<'listening' | 'speaking' | 'idle'>('listening');

  useEffect(() => {
    const timer = setInterval(() => {
      setStatus(s => s === 'listening' ? 'speaking' : s === 'speaking' ? 'idle' : 'listening');
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const statusText = { listening: 'Listening…', speaking: 'Speaking…', idle: 'Idle' }[status];

  return (
    <div id="screen-talk" className="screen">
      <div className="talk-mode-badge">
        <span className="dot dot-ok" />
        <span>AUTO-DETECT MODE</span>
        <button className="btn btn-ghost" style={{fontSize:'9px',padding:'2px 6px'}}>CHANGE</button>
      </div>
      <div className="talk-agent">{AGENT_NAME[theme]}</div>
      <div className="waveform">
        {Array.from({length:10}).map((_,i) => <div key={i} className="wbar" />)}
      </div>
      <div className="talk-status">{statusText}</div>
      <div className="talk-transcript">
        <div className="t-user">You: Can you summarise what we decided about the database schema?</div>
        <div className="t-agent" style={{marginTop:'8px'}}>Deltron: We agreed to use a single SQLite database with three tables — tasks, goals, and commentary_log. The tasks table has a foreign key to goals, and the commentary_log holds all AI narrative entries linked to either a task or a goal.</div>
      </div>
      <div className="talk-controls">
        <button className="btn btn-ghost" style={{padding:'10px 16px'}}>🔇</button>
        <button className="mic-btn">🎙</button>
        <button className="btn btn-ghost" style={{padding:'10px 16px',color:'var(--err)',borderColor:'var(--err)'}}>End</button>
      </div>
    </div>
  );
}
