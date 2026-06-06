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
  server: {
    host: true,
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
