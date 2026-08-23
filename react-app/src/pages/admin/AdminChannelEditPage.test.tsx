import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AdminChannelEditPage } from './AdminChannelEditPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const channel = {
  id: 'c1',
  name: 'Someone Else’s Channel',
  slug: 'someone-elses-channel',
  visibility: 'private',
  ownerId: 'owner-1',
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

const users = [
  { id: 'owner-1', username: 'alice', role: 'viewer', streamQuota: 0, avatar: null, createdAt: '2026-01-01', lastLoginAt: null },
  { id: 'owner-2', username: 'bob', role: 'admin', streamQuota: 0, avatar: null, createdAt: '2026-01-01', lastLoginAt: null },
]

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/admin/channels/${id}`]}>
      <Routes>
        <Route path="/admin/channels/:id" element={<AdminChannelEditPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminChannelEditPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads any channel by id (not just the caller\'s own) with the full user list for owner reassignment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/admin/channels/c1') return jsonResponse({ channel })
        if (url === '/api/admin/streams') return jsonResponse({ streams: [] })
        if (url === '/api/games') return jsonResponse({ games: [] })
        if (url === '/api/admin/users') return jsonResponse({ users })
        throw new Error(`unexpected fetch ${url}`)
      }),
    )

    renderAt('c1')

    expect(await screen.findByDisplayValue('Someone Else’s Channel')).toBeInTheDocument()
    expect(screen.getByLabelText('Owner')).toBeInTheDocument()
  })
})
