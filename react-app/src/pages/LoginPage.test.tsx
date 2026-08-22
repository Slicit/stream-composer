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
      jsonResponse({ user: { id: 'u1', username: 'alice', role: 'viewer' as const, streamQuota: 0, createdAt: '2026-01-01', lastLoginAt: null } }),
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
})
