import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { AdminUsersPage } from './AdminUsersPage'
import type { User } from '../api/types'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const admin: User = { id: 'admin-1', username: 'admin', role: 'admin', email: null, emailConfirmed: false, otpEnabled: false, otpBackupCodesRemaining: 0, streamQuota: 0, compositorQuota: 0, avatar: null, createdAt: '2026-01-01', lastLoginAt: null }
const viewer: User = {
  id: 'viewer-1',
  username: 'viewer-1',
  role: 'viewer',
  email: 'viewer@example.com',
  emailConfirmed: true,
  otpEnabled: true,
  otpBackupCodesRemaining: 10,
  streamQuota: 0,
  compositorQuota: 0,
  avatar: null,
  createdAt: '2026-01-01',
  lastLoginAt: null,
}

function renderPage(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AdminUsersPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

function dataRows() {
  return screen.getAllByRole('row').slice(1) // row 0 is the header
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lists users returned by /api/admin/users', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return jsonResponse({ user: admin })
      if (url === '/api/admin/users') return jsonResponse({ users: [admin, viewer] })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock)

    expect(await screen.findByText('viewer-1')).toBeInTheDocument()
    const rows = dataRows()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('admin')
  })

  it("links a user's name and the Edit action to their full edit page", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return jsonResponse({ user: admin })
      if (url === '/api/admin/users') return jsonResponse({ users: [admin, viewer] })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock)

    await waitFor(() => expect(dataRows()).toHaveLength(2))
    const viewerRow = dataRows()[1]

    expect(within(viewerRow).getByRole('link', { name: 'viewer-1' })).toHaveAttribute('href', '/admin/users/viewer-1')
    expect(within(viewerRow).getByRole('link', { name: 'Edit viewer-1' })).toHaveAttribute('href', '/admin/users/viewer-1')
  })

  it('shows email confirmation and 2FA status as badges', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return jsonResponse({ user: admin })
      if (url === '/api/admin/users') return jsonResponse({ users: [admin, viewer] })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock)

    await waitFor(() => expect(dataRows()).toHaveLength(2))
    const [adminRow, viewerRow] = dataRows()

    // admin has no email — a dash, not a badge
    expect(within(adminRow).getByText('—')).toBeInTheDocument()
    expect(within(adminRow).getByText('off')).toBeInTheDocument()

    expect(within(viewerRow).getByText('confirmed')).toBeInTheDocument()
    expect(within(viewerRow).getByText('on')).toBeInTheDocument()
  })

  it('creates a user and refreshes the list', async () => {
    let users: User[] = [admin]
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return jsonResponse({ user: admin })
      if (url === '/api/admin/users' && (!init || init.method === undefined)) return jsonResponse({ users })
      if (url === '/api/admin/users' && init?.method === 'POST') {
        const created: User = { id: 'new-1', username: 'newperson', role: 'viewer', email: null, emailConfirmed: false, otpEnabled: false, otpBackupCodesRemaining: 0, streamQuota: 0, compositorQuota: 0, avatar: null, createdAt: '2026-01-01', lastLoginAt: null }
        users = [...users, created]
        return jsonResponse({ user: created }, 201)
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderPage(fetchMock)

    await waitFor(() => expect(dataRows()).toHaveLength(1))

    const form = screen.getByRole('form', { name: 'Add a user' })
    await userEvent.type(within(form).getByLabelText('Username'), 'newperson')
    await userEvent.type(within(form).getByLabelText('Password'), 'correct-horse-1')
    await userEvent.click(within(form).getByRole('button', { name: 'Add user' }))

    expect(await screen.findByText('newperson')).toBeInTheDocument()
  })

  it('hides the compositor quota field on the create form when the admin role is selected', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return jsonResponse({ user: admin })
      if (url === '/api/admin/users') return jsonResponse({ users: [admin] })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock)
    await waitFor(() => expect(dataRows()).toHaveLength(1))

    const form = screen.getByRole('form', { name: 'Add a user' })
    expect(within(form).getByLabelText('Compositor quota')).toBeInTheDocument()

    await userEvent.click(within(form).getByRole('combobox', { name: 'Role for the new user' }))
    await userEvent.click(await screen.findByRole('option', { name: 'admin' }))

    expect(within(form).queryByLabelText('Compositor quota')).not.toBeInTheDocument()
  })

  it('disables deleting the account currently signed in with', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return jsonResponse({ user: admin })
      if (url === '/api/admin/users') return jsonResponse({ users: [admin, viewer] })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock)

    await waitFor(() => expect(dataRows()).toHaveLength(2))
    const [adminRow, viewerRow] = dataRows()

    expect(within(adminRow).getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(within(viewerRow).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('impersonates a user and refreshes auth state', async () => {
    let currentUser: User = admin
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return jsonResponse({ user: currentUser })
      if (url === '/api/admin/users') return jsonResponse({ users: [admin, viewer] })
      if (url === '/api/admin/users/viewer-1/impersonate' && init?.method === 'POST') {
        currentUser = viewer
        return jsonResponse({ user: viewer })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderPage(fetchMock)

    await waitFor(() => expect(dataRows()).toHaveLength(2))
    const viewerRow = dataRows()[1]

    await userEvent.click(within(viewerRow).getByRole('button', { name: 'Impersonate viewer-1' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/admin/users/viewer-1/impersonate')
      expect(call).toBeTruthy()
    })
  })

  it('disables impersonating the account currently signed in with', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return jsonResponse({ user: admin })
      if (url === '/api/admin/users') return jsonResponse({ users: [admin, viewer] })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock)

    await waitFor(() => expect(dataRows()).toHaveLength(2))
    const [adminRow, viewerRow] = dataRows()

    expect(within(adminRow).getByRole('button', { name: 'Impersonate admin' })).toBeDisabled()
    expect(within(viewerRow).getByRole('button', { name: 'Impersonate viewer-1' })).toBeEnabled()
  })
})
