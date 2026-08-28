import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import type { User } from '@/api/types'
import { ChannelEditPage } from './ChannelEditPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

// A plain streamer, not compositor-granted — the compositor section is
// opt-in (ChannelCompositionSection.test.tsx covers it directly), so
// these tests only need auth/me answered, not the compositions endpoint.
const signedInUser: User = {
  id: 'u1',
  username: 'owner',
  role: 'streamer',
  streamQuota: 5,
  canUseCompositor: false,
  avatar: null,
  createdAt: '2026-01-01',
  lastLoginAt: null,
}

const channel = {
  id: 'c1',
  name: 'My Channel',
  slug: 'my-channel',
  visibility: 'private',
  ownerId: 'u1',
  backgroundImage: null,
  streamIds: [],
  sharedWith: [],
  description: '',
  currentTopic: '',
  featuredGameId: null,
  featuredGameName: null,
  layoutMode: null,
  createdAt: '2026-01-01',
}

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/channels/${id}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/channels/:id" element={<ChannelEditPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('ChannelEditPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the channel, available streams and games, and renders the shared form without an owner field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/auth/me') return jsonResponse({ user: signedInUser, impersonatedBy: null })
        if (url === '/api/channels/mine/c1') return jsonResponse({ channel })
        if (url === '/api/streams/available') return jsonResponse({ streams: [] })
        if (url === '/api/games') return jsonResponse({ games: [] })
        throw new Error(`unexpected fetch ${url}`)
      }),
    )

    renderAt('c1')

    expect(await screen.findByDisplayValue('My Channel')).toBeInTheDocument()
    expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument()
  })

  it('shows an error if the channel cannot be loaded (e.g. not the owner)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/auth/me') return jsonResponse({ user: signedInUser, impersonatedBy: null })
        return Promise.resolve(new Response(JSON.stringify({ error: 'You do not own this.' }), { status: 403 }))
      }),
    )

    renderAt('c1')

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not own this.')
  })
})
