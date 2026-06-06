import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// No StrictMode: @humeai/voice-react (Talk Cloud mode) is not StrictMode-safe —
// the mount→unmount→remount double-invoke fires a disconnect on the fresh EVI
// client and wedges connect() ("Connecting…" forever). Helm runs as a Vite dev
// server in both dev and prod, so StrictMode would double-invoke in both. The
// spike confirmed apiKey connect works once StrictMode is removed.
createRoot(document.getElementById('root')!).render(<App />)
