import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
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
