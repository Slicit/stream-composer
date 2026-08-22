// Captures documentation screenshots against an already-running go-rails-react
// dev stack (docker-compose.migration.yml) — this does not boot its own
// throwaway environment. The old server/-based screenshots.sh spun up a
// disposable instance of the pre-migration single-container app; that
// approach doesn't map cleanly onto a 4-service stack (Postgres, Rails
// migrations, Go dataplane, MediaMTX) and the dev stack used for day-to-day
// manual testing already gives realistic seeded data, so this script just
// points Playwright at it.
//
// Usage:
//   npm install && npx playwright install chromium   (first time only)
//   BASE_URL=http://localhost:15173 \
//   ADMIN_USERNAME=... ADMIN_PASSWORD=... \
//   CHANNEL_SLUG=demo-channel \
//   node capture.mjs
//
// Requires: an admin user, at least one enabled stream, and ideally one
// public channel with a couple of live members so the grid/live-dot shots
// aren't empty placeholders.
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE_URL = process.env.BASE_URL || 'http://localhost:15173'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const CHANNEL_SLUG = process.env.CHANNEL_SLUG || ''
const OUT_DIR = process.env.OUT_DIR || path.resolve(fileURLToPath(import.meta.url), '../../../docs/screenshots')

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error('ADMIN_USERNAME and ADMIN_PASSWORD are required')
  process.exit(1)
}

async function shoot(page, name) {
  await page.waitForTimeout(400) // let live-status polls / chart animations settle
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) })
  console.log('captured', name)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel(/username/i).fill(ADMIN_USERNAME)
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /log in|sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))

  await page.goto(`${BASE_URL}/`)
  await shoot(page, 'viewer-home')

  if (CHANNEL_SLUG) {
    await page.goto(`${BASE_URL}/c/${CHANNEL_SLUG}`)
    await shoot(page, 'channel-viewer')
  }

  await page.goto(`${BASE_URL}/admin`)
  await shoot(page, 'admin-users')

  await page.goto(`${BASE_URL}/admin/streams`)
  await shoot(page, 'admin-streams')

  await page.goto(`${BASE_URL}/admin/relays`)
  await shoot(page, 'admin-relays')

  await page.goto(`${BASE_URL}/admin/channels`)
  await shoot(page, 'admin-channels')

  await page.goto(`${BASE_URL}/admin/stats`)
  await shoot(page, 'admin-stats')

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
