import { type TalkMode } from '../lib/talk-evi';

/** Cloud (EVI) ⇄ Local (pipeline) switch, rendered in the Talk mode badge. */
export function TalkModeToggle({ mode, onChange }: { mode: TalkMode; onChange: (m: TalkMode) => void }) {
  return (
    <button
      className="btn btn-ghost"
      style={{ fontSize: '9px', padding: '2px 6px' }}
      onClick={() => onChange(mode === 'cloud' ? 'local' : 'cloud')}
      title={mode === 'cloud' ? 'Switch to Local pipeline' : 'Switch to Cloud (EVI)'}
    >
      {mode === 'cloud' ? '→ LOCAL' : '→ CLOUD'}
    </button>
  );
}
