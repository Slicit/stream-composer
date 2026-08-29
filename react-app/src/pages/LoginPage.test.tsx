import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { LoginPage } from './LoginPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('signs in with the right credentials', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => jsonResponse({ user: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeInTheDocument())

    fetchMock.mockImplementationOnce(() =>
      jsonResponse({ user: { id: 'u1', username: 'alice', role: 'viewer' as const, streamQuota: 0, avatar: null, createdAt: '2026-01-01', lastLoginAt: null } }),
    )
    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-1')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/login')
      expect(call).toBeTruthy()
    })
  })

  it('shows the server error on a wrong password', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ user: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeInTheDocument())

    fetchMock.mockImplementationOnce(() => jsonResponse({ error: 'Wrong username or password.' }, 401))
    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.')
  })

  it('asks for a 2FA code when the server requires it, then signs in with the right code', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => jsonResponse({ user: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeInTheDocument())

    fetchMock.mockImplementationOnce(() => jsonResponse({ twoFactorRequired: true, challengeToken: 'the-challenge-token' }))
    await userEvent.type(screen.getByLabelText('Username'), 'totp-alice')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-1')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter your code')).toBeInTheDocument()

    fetchMock.mockImplementationOnce((url: string, init?: RequestInit) => {
      expect(url).toBe('/api/auth/login/verify-2fa')
      expect(JSON.parse(init!.body as string)).toEqual({ challengeToken: 'the-challenge-token', code: '123456' })
      return jsonResponse({
        user: { id: 'u1', username: 'totp-alice', role: 'viewer' as const, email: null, emailConfirmed: false, otpEnabled: true, streamQuota: 0, compositorQuota: 0, avatar: null, createdAt: '2026-01-01', lastLoginAt: null },
      })
    })
    await userEvent.type(screen.getByLabelText('Code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/login/verify-2fa')
      expect(call).toBeTruthy()
    })
  })

  it('shows the server error on a wrong 2FA code, without leaving the code step', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => jsonResponse({ user: null }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeInTheDocument())

    fetchMock.mockImplementationOnce(() => jsonResponse({ twoFactorRequired: true, challengeToken: 'the-challenge-token' }))
    await userEvent.type(screen.getByLabelText('Username'), 'totp-alice')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-1')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByText('Enter your code')

    fetchMock.mockImplementationOnce(() => jsonResponse({ error: 'Invalid code.' }, 401))
    await userEvent.type(screen.getByLabelText('Code'), '000000')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code.')
    expect(screen.getByText('Enter your code')).toBeInTheDocument()
  })
})
