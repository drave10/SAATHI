import { defineConfig } from '@playwright/test'

// Tests the self-contained static demo build (no backend at all):
//   $env:VITE_STATIC_DEMO="true"; npm run build; npx playwright test -c playwright.static.config.ts
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge'

export default defineConfig({
  testDir: './e2e-static',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', ...(channel === 'chromium' ? {} : { channel }), screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
})
