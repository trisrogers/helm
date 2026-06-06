import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// Standalone entry for the throwaway EVI spike. Mirrors the main app's gateway
// proxy so the reused OpenClawClient (which dials `${location.host}/ws-gateway`)
// reaches the local gateway. Reads VITE_HUME_* from repo-root .env.local.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: repoRoot,
  plugins: [react(), basicSsl()],
  // @humeai/voice-react nests its own react@18 in dependencies, so two React copies
  // load and hooks break ("Invalid hook call" / useRef of null). Alias both to the
  // single root copy (react@19) so there is exactly one.
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: fileURLToPath(new URL('../../node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('../../node_modules/react-dom', import.meta.url)),
    },
  },
  optimizeDeps: { include: ['react', 'react-dom', '@humeai/voice-react'] },
  server: {
    host: true,
    port: 5273,
    fs: { allow: [repoRoot] },
    proxy: {
      '/ws-gateway': {
        target: 'ws://127.0.0.1:18789',
        ws: true,
        rewrite: () => '/',
        xfwd: false,
      },
    },
  },
});
