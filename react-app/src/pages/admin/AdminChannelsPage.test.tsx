import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AdminChannelsPage } from './AdminChannelsPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const channel = {
  id: 'c1',
  name: 'Community Room',
  slug: 'community-room',
  visibility: 'public',
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

describe('AdminChannelsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('links the channel name and the Edit action to its full edit page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ channels: [channel], homepageChannelId: null })))

    render(
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('link', { name: 'Community Room' })).toHaveAttribute('href', '/admin/channels/c1')
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/admin/channels/c1')
  })
})
