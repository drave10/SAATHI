import { defineConfig } from '@playwright/test'

// Requires the API (port 8000) running with seeded demo data, and credentials in the environment:
//   E2E_CASEWORKER_PASSWORD, E2E_BENEFICIARY_PASSWORD, E2E_ADMIN_PASSWORD  (the SEED_* values from your .env)
// Uses an installed Chromium-based browser (E2E_BROWSER_CHANNEL, default "msedge") so no browser download is needed;
// set E2E_BROWSER_CHANNEL=chromium after `npx playwright install chromium` to use Playwright's own build.
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', ...(channel === 'chromium' ? {} : { channel }), trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  // These tests use the normal username/password form, so the dev server runs in full-login mode (the default build is demo-only).
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: false, timeout: 60_000, env: { VITE_LOGIN_MODE: 'full' } },
})
