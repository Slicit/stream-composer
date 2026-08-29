import { defineConfig, devices } from '@playwright/test'

// Runs against the already-running dev stack (docker-compose.migration.yml's
// scmig-react on :15173) rather than starting its own server — this suite
// exists specifically to verify things the sandboxed Browser pane tool
// cannot: real click events (Radix Select ignores synthetic ones there),
// native confirm()/alert() dialogs (auto-declined there), and anything on
// claude-machine-0X's LAN hostname (subresources get ERR_BLOCKED_BY_CLIENT
// there). See the prefer-curl-unit-tests-over-live-browser-clicking memory
// for when to reach for this vs. curl/vitest vs. the Browser pane.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:15173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
