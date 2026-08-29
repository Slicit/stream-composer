import { test, expect } from '@playwright/test'

// Exists specifically to prove what the sandboxed Browser pane tool could
// not: a real click actually opens/selects a Radix Select option (the
// pane's synthetic clicks are ignored by Radix), and a real confirm()
// dialog can be programmatically accepted (the pane auto-declines native
// dialogs). See global-setup.ts for the e2e-admin/e2e-target fixtures.
test.describe('Admin user edit page', () => {
  test.beforeEach(async ({ page }) => {
    // page.request (not the standalone `request` fixture) shares this
    // page's own cookie jar — logging in this way is the same speed as
    // curl but leaves the browser already authenticated when it navigates.
    const res = await page.request.post('/api/auth/login', { data: { username: 'e2e-admin', password: 'correct-horse-1' } })
    expect(res.ok()).toBeTruthy()
  })

  test('changes a role through the real Select dropdown', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: 'e2e-target', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/users\//)

    const roleSelect = page.getByRole('combobox', { name: 'Role for e2e-target' })
    await expect(roleSelect).toHaveText('viewer')

    await roleSelect.click()
    await page.getByRole('option', { name: 'streamer' }).click()

    await expect(roleSelect).toHaveText('streamer')
    // Reload to prove it actually persisted server-side, not just local state.
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Role for e2e-target' })).toHaveText('streamer')
  })

  test('force-resets 2FA through a real confirm() dialog', async ({ page }) => {
    let dialogSeen = false
    page.on('dialog', (dialog) => {
      dialogSeen = true
      dialog.accept()
    })

    await page.goto('/admin')
    await page.getByRole('link', { name: 'e2e-target', exact: true }).click()

    const resetButton = page.getByRole('button', { name: 'Reset two-factor authentication' })
    await expect(resetButton).toBeEnabled()

    await resetButton.click()

    await expect.poll(() => dialogSeen).toBe(true)
    await expect(resetButton).toBeDisabled()
  })
})
