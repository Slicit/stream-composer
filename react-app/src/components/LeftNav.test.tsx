import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import { LeftNav } from './LeftNav'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const user = { id: 'u1', username: 'alice', role: 'viewer' as const, streamQuota: 0, createdAt: '2026-01-01', lastLoginAt: null }

describe('LeftNav', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when signed out', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ user: null })))

    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <LeftNav />
        </AuthProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('lists every accessible channel, linking to /c/:slug', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/channels') {
        return jsonResponse({
          channels: [
            { id: 'c1', name: 'Community Room', slug: 'community-room', visibility: 'public', ownerId: 'u2', backgroundImage: null, streamIds: [], sharedWith: [], createdAt: '2026-01-01' },
          ],
        })
      }
      return jsonResponse({ user })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter>
        <AuthProvider>
          <LeftNav />
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Community Room')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Community Room/i })).toHaveAttribute('href', '/c/community-room')
  })
})
