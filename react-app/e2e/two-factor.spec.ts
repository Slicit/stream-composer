import { test, expect } from '@playwright/test'
import { computeTotp } from './totp.js'

// Covers the self-service 2FA setup flow end to end through a real
// browser: a real QR/secret from the real endpoint, a real generated
// TOTP code accepted, the backup-codes reveal panel, sign-out, and the
// real two-step login UI (LoginPage's code step) — including a wrong
// code being rejected before a correct one succeeds. This was previously
// only proven via curl (server behavior) and a mocked-fetch unit test
// (React logic) — this is the first time the actual UI wiring between
// them has been exercised by a real click/submit rather than assumed.
test.describe('Self-service two-factor authentication', () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.request.post('/api/auth/login', { data: { username: 'e2e-2fa', password: 'correct-horse-1' } })
    expect(res.ok()).toBeTruthy()
  })

  test('sets up 2FA with a real code, reveals backup codes once, then signs back in through the two-step login', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'e2e-2fa' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit profile' })).toBeVisible()

    await page.getByRole('button', { name: 'Enable two-factor authentication' }).click()
    const secret = await page.getByTestId('otp-secret').textContent()
    expect(secret).toBeTruthy()

    await page.getByLabel('6-digit code').fill(computeTotp(secret!.trim()))
    await page.getByRole('button', { name: 'Enable' }).click()

    // The reveal-once backup codes panel, not the normal "on" view.
    await expect(page.getByText(/Save these backup codes/)).toBeVisible()
    const codes = await page.locator('.grid code').allTextContents()
    expect(codes).toHaveLength(10)

    await page.getByRole('button', { name: "I've saved these" }).click()
    await expect(page.getByText('10 backup codes remaining.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit profile' })).toBeHidden()

    // Sign out and back in through the real two-step login UI.
    await page.getByRole('button', { name: 'e2e-2fa' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()

    await page.goto('/login')
    await page.getByLabel('Username').fill('e2e-2fa')
    await page.getByLabel('Password').fill('correct-horse-1')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Enter your code')).toBeVisible()

    // A wrong code must be rejected before a correct one succeeds.
    await page.getByLabel('Code').fill('000000')
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page.getByRole('alert')).toHaveText('Invalid code.')

    await page.getByLabel('Code').fill(computeTotp(secret!.trim()))
    await page.getByRole('button', { name: 'Verify' }).click()

    await expect(page.getByRole('button', { name: 'e2e-2fa' })).toBeVisible()

    // Clean up: disable 2FA again so this fixture starts fresh next run
    // even if global-setup isn't re-run in between (e.g. --grep).
    await page.getByRole('button', { name: 'e2e-2fa' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByLabel('Confirm your password to disable it').fill('correct-horse-1')
    await page.getByRole('button', { name: 'Disable two-factor authentication' }).click()
    await expect(page.getByText('Two-factor authentication is off.')).toBeVisible()
  })
})
