import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  // basicSsl gives a self-signed cert so navigator.mediaDevices works on
  // tailnet hostnames (browsers gate getUserMedia on a secure context).
  plugins: [react(), basicSsl()],
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
    },
  },
})
