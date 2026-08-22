import { useEffect } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
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
//
// EMPTY_LIVE_MAP must be a stable module-level reference, not an inline
// `= {}` default: a default parameter is re-evaluated (a new object)
// every time the caller omits the prop, which the effect below sees as
// "liveByKey changed" every render — setChannelStreams updates context
// state, which re-renders SeedChannel, which re-evaluates the default
// again, forever. Caught this via a real OOM crash in this suite before
// fixing it here.
const EMPTY_LIVE_MAP: Record<string, boolean> = {}

function SeedChannel({ onAir, liveByKey = EMPTY_LIVE_MAP }: { onAir: { key: string; name: string }[]; liveByKey?: Record<string, boolean> }) {
  const { setChannelStreams } = useChannelPrefs()
  useEffect(() => {
    setChannelStreams('community-room', 'Community Room', onAir, liveByKey)
  }, [onAir, liveByKey, setChannelStreams])
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
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => (url === '/api/channels' ? jsonResponse({ channels: [] }) : jsonResponse({ user }))),
    )

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

  it('colors a channel live once GET /api/channels/live reports it', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/channels') {
        return jsonResponse({
          channels: [
            { id: 'c1', name: 'Community Room', slug: 'community-room', visibility: 'public', ownerId: 'u2', backgroundImage: null, streamIds: [], sharedWith: [], createdAt: '2026-01-01' },
          ],
        })
      }
      if (url === '/api/channels/live') return jsonResponse({ 'community-room': true })
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

    const link = await screen.findByRole('link', { name: /Community Room/i })
    await waitFor(() => expect(within(link).getByRole('status')).toHaveAccessibleName('Live'))
  })
})
