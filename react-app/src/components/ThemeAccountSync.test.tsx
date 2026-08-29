import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { ThemeAccountSync } from './ThemeAccountSync'
import type { User } from '@/api/types'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    username: 'alice',
    role: 'viewer',
    email: null,
    emailConfirmed: false,
    otpEnabled: false,
    otpBackupCodesRemaining: 0,
    theme: null,
    streamQuota: 0,
    compositorQuota: 0,
    avatar: null,
    createdAt: '2026-01-01',
    lastLoginAt: null,
    ...overrides,
  }
}

function ThemeProbe() {
  const { theme } = useTheme()
  return <p>theme:{theme}</p>
}

function renderApp(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <AuthProvider>
      <ThemeProvider>
        <ThemeAccountSync />
        <ThemeProbe />
      </ThemeProvider>
    </AuthProvider>,
  )
}

describe('ThemeAccountSync', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it("applies the signed-in account's stored theme, overriding this browser's default", async () => {
    renderApp(vi.fn(() => jsonResponse({ user: baseUser({ theme: 'aurora' }) })))

    await waitFor(() => expect(screen.getByText('theme:aurora')).toBeInTheDocument())
    expect(document.documentElement.dataset.theme).toBe('aurora')
  })

  it('leaves the local theme alone when the account has no stored preference', async () => {
    localStorage.setItem('sc:theme', 'onair')
    renderApp(vi.fn(() => jsonResponse({ user: baseUser({ theme: null }) })))

    await waitFor(() => expect(screen.getByText('theme:onair')).toBeInTheDocument())
  })

  it('does nothing while signed out', async () => {
    localStorage.setItem('sc:theme', 'legacy')
    renderApp(vi.fn(() => jsonResponse({ user: null })))

    await waitFor(() => expect(screen.getByText('theme:legacy')).toBeInTheDocument())
  })
})
