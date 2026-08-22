import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { AdminUsersPage } from './AdminUsersPage'
import type { User } from '../api/types'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const admin: User = { id: 'admin-1', username: 'admin', role: 'admin', streamQuota: 0, createdAt: '2026-01-01', lastLoginAt: null }
const viewer: User = { id: 'viewer-1', username: 'viewer-1', role: 'viewer', streamQuota: 0, createdAt: '2026-01-01', lastLoginAt: null }

function renderPage(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <AuthProvider>
      <AdminUsersPage />
    </AuthProvider>,
  )
}

// The username cell and the role <select> cell both flatten to the text
// "admin" for accessible-name purposes when the row's role is admin (the
// select's own accessible name resolves to its selected option's text),
// so `getByRole('cell', { name: 'admin' })` is ambiguous. Rows are stable
// and ordered, so index into them instead.
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
    // The first <td> specifically — getByText('admin') within the row is
    // itself ambiguous, since the role <select> also renders an "admin"
    // <option> as real DOM text.
    expect(rows[0].querySelector('td')).toHaveTextContent('admin')
  })

  it('creates a user and refreshes the list', async () => {
    let users: User[] = [admin]
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return jsonResponse({ user: admin })
      if (url === '/api/admin/users' && (!init || init.method === undefined)) return jsonResponse({ users })
      if (url === '/api/admin/users' && init?.method === 'POST') {
        const created: User = { id: 'new-1', username: 'newperson', role: 'viewer', streamQuota: 0, createdAt: '2026-01-01', lastLoginAt: null }
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
})
