import { test, expect } from '@playwright/test'

test.describe('Theme switcher', () => {
  test('lists all four themes and applies one via a real click, signed out', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Theme' }).click()

    await expect(page.getByRole('menuitemradio', { name: 'Studio' })).toHaveAttribute('aria-checked', 'true')
    for (const label of ['Legacy', 'Aurora', 'On Air']) {
      await expect(page.getByRole('menuitemradio', { name: label })).toBeVisible()
    }

    await page.getByRole('menuitemradio', { name: 'Aurora' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'aurora')

    // Survives a reload via the blocking inline script + localStorage.
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'aurora')
  })

  test('signed in: persists to the account and follows a fresh session with no localStorage', async ({ page, context }) => {
    const res = await page.request.post('/api/auth/login', { data: { username: 'e2e-admin', password: 'correct-horse-1' } })
    expect(res.ok()).toBeTruthy()

    await page.goto('/')
    await page.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('menuitemradio', { name: 'On Air' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'onair')

    // A brand-new browser context shares nothing (no localStorage, no
    // cookies) — only the account's own session cookie, copied over
    // explicitly, proves whether the theme really followed the account
    // rather than just this context's storage.
    const cookies = await context.cookies()
    const newContext = await page.context().browser()!.newContext()
    await newContext.addCookies(cookies)
    const newPage = await newContext.newPage()
    await newPage.goto('/')
    await expect(newPage.locator('html')).toHaveAttribute('data-theme', 'onair')
    await newContext.close()

    // Reset the fixture back to its default for the next run.
    await page.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('menuitemradio', { name: 'Studio' }).click()
  })
})
