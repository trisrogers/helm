import { defineConfig } from 'playwright/test';

// UI smoke layer — drives the real dev server (https via basicSsl, hence
// ignoreHTTPSErrors). Asserts only gateway-independent behavior so it stays
// green whether or not an openclaw gateway is reachable.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'https://127.0.0.1:5173',
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: 'npm run dev',
    url: 'https://127.0.0.1:5173',
    reuseExistingServer: true,
    ignoreHTTPSErrors: true,
    timeout: 30_000,
  },
});
