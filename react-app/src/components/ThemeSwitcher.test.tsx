import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ThemeSwitcher } from './ThemeSwitcher'
import type { User } from '@/api/types'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const signedInUser: User = {
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
}

function renderSwitcher(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <AuthProvider>
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>
    </AuthProvider>,
  )
}

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('lists all four themes, marking the current one selected', async () => {
    renderSwitcher(vi.fn(() => jsonResponse({ user: null })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Theme' })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Theme' }))

    expect(await screen.findByRole('menuitemradio', { name: 'Studio' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Legacy' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: 'Aurora' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'On Air' })).toBeInTheDocument()
  })

  it('signed out: picking a theme applies and persists it locally only, without calling the server', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return jsonResponse({ user: null })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSwitcher(fetchMock)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Theme' })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Theme' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Aurora' }))

    expect(document.documentElement.dataset.theme).toBe('aurora')
    expect(localStorage.getItem('sc:theme')).toBe('aurora')
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/me/theme')).toBe(false)
  })

  it('signed in: picking a theme applies it locally and persists it to the account', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me' && (!init || init.method === undefined)) return jsonResponse({ user: signedInUser })
      if (url === '/api/auth/me/theme' && init?.method === 'PATCH') {
        expect(JSON.parse(init.body as string)).toEqual({ theme: 'onair' })
        return jsonResponse({ user: { ...signedInUser, theme: 'onair' } })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderSwitcher(fetchMock)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Theme' })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Theme' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'On Air' }))

    expect(document.documentElement.dataset.theme).toBe('onair')
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/me/theme')
      expect(call).toBeTruthy()
    })
  })

  it('signed in: a failed PATCH does not undo the local theme change', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me' && (!init || init.method === undefined)) return jsonResponse({ user: signedInUser })
      if (url === '/api/auth/me/theme') return jsonResponse({ error: 'boom' }, 500)
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderSwitcher(fetchMock)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Theme' })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Theme' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Aurora' }))

    expect(document.documentElement.dataset.theme).toBe('aurora')
  })
})
