import { test, expect } from '@playwright/test'

const MAILPIT_URL = process.env.MAILPIT_URL || 'http://localhost:18025'

interface MailpitMessage {
  ID: string
  To: { Address: string }[]
}

async function latestMessageTo(request: import('@playwright/test').APIRequestContext, address: string): Promise<MailpitMessage> {
  const res = await request.get(`${MAILPIT_URL}/api/v1/messages`)
  const body = (await res.json()) as { messages: MailpitMessage[] }
  const match = body.messages.find((m) => m.To.some((to) => to.Address === address))
  if (!match) throw new Error(`no mailpit message found addressed to ${address}`)
  return match
}

async function confirmLinkFor(request: import('@playwright/test').APIRequestContext, address: string): Promise<string> {
  const message = await latestMessageTo(request, address)
  const res = await request.get(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
  const body = (await res.json()) as { Text: string }
  const match = body.Text.match(/http:\/\/\S+\/confirm-email\?token=\S+/)
  if (!match) throw new Error(`no confirm-email link found in message body: ${body.Text}`)
  return match[0]
}

// The dev stack's rails service is wired to mailpit (a real, local-only
// SMTP server — see docker-compose.migration.yml), so this goes through
// a genuine SMTP delivery + a real confirmation email, not the app's own
// :test-delivery fallback. Proves the whole self-registration pipeline in
// one pass: real UI form -> real SMTP send -> real email content ->
// real confirm link -> real sign-in.
test.describe('Self-registration with real SMTP delivery', () => {
  test('registers, receives a real confirmation email via mailpit, confirms, and signs in', async ({ page, request }) => {
    const username = `e2e-reg-${Date.now()}`
    const email = `${username}@example.com`

    await page.goto('/register')
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill('correct-horse-1')
    await page.getByLabel('Repeat password').fill('correct-horse-1')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText(`Check ${email} to confirm your account`, { exact: false })).toBeVisible()

    // Poll mailpit until the real SMTP delivery actually lands — it's
    // local and fast, but still an async send, not instant.
    let confirmLink = ''
    await expect
      .poll(
        async () => {
          try {
            confirmLink = await confirmLinkFor(request, email)
            return true
          } catch {
            return false
          }
        },
        { timeout: 10_000 },
      )
      .toBe(true)

    // Signing in before confirming must still be refused.
    await page.goto('/login')
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password', { exact: true }).fill('correct-horse-1')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toHaveText('Confirm your email before signing in.')

    // The real link from the real email.
    const relativeConfirmUrl = new URL(confirmLink).pathname + new URL(confirmLink).search
    await page.goto(relativeConfirmUrl)
    await expect(page.getByText('Email confirmed', { exact: false })).toBeVisible()

    await page.goto('/login')
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password', { exact: true }).fill('correct-horse-1')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('button', { name: 'Theme' })).toBeVisible()
    await expect(page.getByText(username, { exact: false })).toBeVisible()
  })
})
