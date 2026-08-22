import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import { UserMenu } from './UserMenu'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const user = { id: 'u1', username: 'alice', role: 'viewer' as const, streamQuota: 0, createdAt: '2026-01-01', lastLoginAt: null }

describe('UserMenu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a user card with edit and sign-out actions', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ user })))

    render(
      <MemoryRouter>
        <AuthProvider>
          <UserMenu />
        </AuthProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /alice/i }))

    expect(await screen.findByRole('menuitem', { name: /edit/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
    expect(screen.getByText('viewer')).toBeInTheDocument()
  })

  it('opens the edit-password dialog from the dropdown', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ user })))

    render(
      <MemoryRouter>
        <AuthProvider>
          <UserMenu />
        </AuthProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /alice/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /edit/i }))

    expect(await screen.findByRole('dialog', { name: /change password/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Current password')).toBeInTheDocument()
  })

  it('signs out from the dropdown', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => jsonResponse({ user }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter>
        <AuthProvider>
          <UserMenu />
        </AuthProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })))
    await userEvent.click(screen.getByRole('button', { name: /alice/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/logout')
      expect(call).toBeTruthy()
    })
  })
})
