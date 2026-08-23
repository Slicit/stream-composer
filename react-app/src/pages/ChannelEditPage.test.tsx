import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ChannelEditPage } from './ChannelEditPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
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
      <Routes>
        <Route path="/channels/:id" element={<ChannelEditPage />} />
      </Routes>
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
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: 'You do not own this.' }), { status: 403 }))))

    renderAt('c1')

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not own this.')
  })
})
