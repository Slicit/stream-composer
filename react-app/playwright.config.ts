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
  // Specs share mutable, fixed fixture accounts seeded once by
  // global-setup.ts (e2e-admin, e2e-target, e2e-2fa) rather than creating
  // isolated data per test, so two specs racing against the same account
  // (e.g. admin-user-edit.spec.ts's two tests, both against e2e-target)
  // is a real conflict, not just a slow run. Never surfaced on the dev
  // box, which only has 1 CPU and so only ever ran 1 worker by default -
  // GitHub Actions' 2-CPU runner defaults to 2 and hit it immediately.
  workers: 1,
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
