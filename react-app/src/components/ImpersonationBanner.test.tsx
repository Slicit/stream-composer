import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import { ImpersonationBanner } from './ImpersonationBanner'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const admin = { id: 'u1', username: 'admin', role: 'admin' as const, streamQuota: 0, avatar: null, createdAt: '2026-01-01', lastLoginAt: null }
const viewer = { id: 'u2', username: 'viewer-1', role: 'viewer' as const, streamQuota: 0, avatar: null, createdAt: '2026-01-01', lastLoginAt: null }

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when not impersonating', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ user: admin, impersonatedBy: null })))
    const { container } = render(
      <AuthProvider>
        <ImpersonationBanner />
      </AuthProvider>,
    )
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('shows who is impersonated and by whom, and stops on click', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url === '/api/auth/impersonate') return jsonResponse({ user: admin })
      return jsonResponse({ user: viewer, impersonatedBy: admin })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <AuthProvider>
        <ImpersonationBanner />
      </AuthProvider>,
    )

    expect(await screen.findByText('viewer-1')).toBeInTheDocument()
    expect(screen.getByText(/signed in as admin/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /stop impersonating/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/auth/impersonate' && (init as RequestInit)?.method === 'DELETE')
      expect(call).toBeTruthy()
    })
  })
})
