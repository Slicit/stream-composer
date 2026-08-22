import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import { ChannelPrefsProvider, useChannelPrefs } from '@/contexts/ChannelPrefsContext'
import { LeftNav } from './LeftNav'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const user = { id: 'u1', username: 'alice', role: 'viewer' as const, streamQuota: 0, createdAt: '2026-01-01', lastLoginAt: null }

// Seeds ChannelPrefsContext the way ChannelViewerPage would, so LeftNav's
// "Streams" section has something to render without needing a full page.
function SeedChannel({ onAir }: { onAir: { key: string; name: string }[] }) {
  const { setChannelStreams } = useChannelPrefs()
  useEffect(() => {
    setChannelStreams('community-room', 'Community Room', onAir)
  }, [onAir, setChannelStreams])
  return null
}

describe('LeftNav', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when signed out', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ user: null })))

    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <ChannelPrefsProvider>
            <LeftNav />
          </ChannelPrefsProvider>
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
          <ChannelPrefsProvider>
            <LeftNav />
          </ChannelPrefsProvider>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Community Room')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Community Room/i })).toHaveAttribute('href', '/c/community-room')
  })

  it('shows a "Streams" section below Channels once a channel is open, with a reset action', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ user })))

    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <ChannelPrefsProvider>
            <SeedChannel onAir={[{ key: 'a', name: 'Camera A' }]} />
            <LeftNav />
          </ChannelPrefsProvider>
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Camera A')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /reset preferences/i })).toBeInTheDocument()

    // "Streams" must come after "Channels" in document order.
    const headings = [...container.querySelectorAll('h2')].map((h) => h.textContent)
    expect(headings).toEqual(['Channels', 'Streams'])
  })
})
