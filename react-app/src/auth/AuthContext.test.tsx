import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

// The Fetch spec forbids a body on a 204 response — Response's constructor
// throws if you try, which is exactly what api.post('/api/auth/logout')
// gets back for real in production.
function noContentResponse() {
  return Promise.resolve(new Response(null, { status: 204 }))
}

const adminUser = { id: 'u1', username: 'admin', role: 'admin', streamQuota: 0, createdAt: '2026-01-01', lastLoginAt: null }
const viewerUser = { id: 'u2', username: 'viewer', role: 'viewer', streamQuota: 0, createdAt: '2026-01-01', lastLoginAt: null }

function Probe() {
  const { user, impersonatedBy, loading, login, logout, stopImpersonating } = useAuth()
  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : user ? `signed-in:${user.username}` : 'signed-out'}</span>
      <span data-testid="impersonatedBy">{impersonatedBy ? impersonatedBy.username : 'none'}</span>
      <button onClick={() => login('admin', 'correct-horse-1')}>login</button>
      <button onClick={() => logout()}>logout</button>
      <button onClick={() => stopImpersonating()}>stop-impersonating</button>
    </div>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the current user from /api/auth/me on mount', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ user: adminUser })))
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    expect(screen.getByTestId('state')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signed-in:admin'))
  })

  it('reflects no session as signed-out, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ user: null })))
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signed-out'))
  })

  it('login() updates the current user', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ user: null }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signed-out'))

    fetchMock.mockImplementationOnce(() => jsonResponse({ user: adminUser }))
    await act(async () => {
      await userEvent.click(screen.getByText('login'))
    })
    expect(screen.getByTestId('state')).toHaveTextContent('signed-in:admin')
  })

  it('logout() clears the current user', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ user: adminUser }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signed-in:admin'))

    fetchMock.mockImplementationOnce(() => noContentResponse())
    await act(async () => {
      await userEvent.click(screen.getByText('logout'))
    })
    expect(screen.getByTestId('state')).toHaveTextContent('signed-out')
  })

  it('reflects impersonatedBy from /api/auth/me, and stopImpersonating() clears it', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ user: viewerUser, impersonatedBy: adminUser }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signed-in:viewer'))
    expect(screen.getByTestId('impersonatedBy')).toHaveTextContent('admin')

    fetchMock.mockImplementationOnce(() => jsonResponse({ user: adminUser }))
    await act(async () => {
      await userEvent.click(screen.getByText('stop-impersonating'))
    })
    expect(screen.getByTestId('state')).toHaveTextContent('signed-in:admin')
    expect(screen.getByTestId('impersonatedBy')).toHaveTextContent('none')
  })
})
