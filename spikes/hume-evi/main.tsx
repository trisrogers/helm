import { createRoot } from 'react-dom/client';
import SpikeEvi from './SpikeEvi';

// No StrictMode: it double-invokes effects/handlers, which makes @humeai/voice-react
// fire a duplicate connect ("Already connected or connecting…") and wedge the socket.
createRoot(document.getElementById('root')!).render(<SpikeEvi />);
