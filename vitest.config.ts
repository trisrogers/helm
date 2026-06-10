import { defineConfig } from 'vitest/config'

// Standalone test config — deliberately NOT merged with vite.config.ts, which
// carries dev-server concerns (basicSsl, proxies, host binding) that have no
// business in a test run.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
