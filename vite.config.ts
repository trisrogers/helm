import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // basicSsl gives a self-signed cert so navigator.mediaDevices works on
  // tailnet hostnames (browsers gate getUserMedia on a secure context).
  plugins: [react(), basicSsl()],
  // @humeai/voice-react (Talk Cloud mode) nests its own react@18 in dependencies;
  // without this the app loads two React copies and hooks break. Force one copy.
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
    },
  },
  // Pre-bundle voice-react so its internal worklet/module URLs resolve
  // consistently (an unbundled worklet can leave EVI connect() hung). Matches the
  // spike config, which connected fine.
  optimizeDeps: { include: ['react', 'react-dom', '@humeai/voice-react'] },
  server: {
    // Loopback only: the dev bundle inlines the spendable Hume API key, so the
    // dev server must not listen on the LAN. Tailnet access goes through the
    // persistent serve rule (tailscale serve --bg --https=5173
    // https+insecure://127.0.0.1:5173) → https://vostok-wsl.tail3aeb2d.ts.net:5173
    host: '127.0.0.1',
    // tailscaled now holds :5173 on the tailnet IPs (the dev serve rule), which
    // trips vite's availability probe — without strictPort it silently bumps to
    // :5175 and the serve mapping (and HMR) break.
    port: 5173,
    strictPort: true,
    allowedHosts: ['.tail3aeb2d.ts.net', 'vostok-wsl'],
    proxy: {
      '/ws-gateway': {
        target: 'ws://127.0.0.1:18789',
        ws: true,
        rewrite: () => '/',
        xfwd: false, // suppress X-Forwarded-* so gateway treats this as a direct loopback connection
      },
      // EVI access-token mint (prod) — same-origin so tailnet browsers reach the
      // loopback-only sidecar without exposing it or the Hume keys. Dev uses the
      // inlined API key directly, so this proxy is a no-op there.
      '/hume/token': {
        target: 'http://127.0.0.1:18790',
        changeOrigin: true,
      },
    },
  },
})
