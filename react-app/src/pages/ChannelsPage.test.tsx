import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ChannelsPage } from './ChannelsPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const channel = {
  id: 'c1',
  name: 'My Channel',
  slug: 'my-channel',
  visibility: 'private' as const,
  ownerId: 'u1',
  backgroundImage: null,
  streamIds: [],
  sharedWith: [],
  description: 'Old description',
  currentTopic: 'Old topic',
  featuredGameId: null,
  featuredGameName: null,
  createdAt: '2026-01-01',
}

const games = [
  { id: 'g1', name: 'Celeste' },
  { id: 'g2', name: 'Hades II' },
]

function stubFetch(posted: unknown[] = []) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/channels/mine' && (!init || init.method === undefined)) return jsonResponse({ channels: [channel] })
    if (url === '/api/streams/available') return jsonResponse({ streams: [] })
    if (url === '/api/games') return jsonResponse({ games })
    if (url === `/api/channels/mine/${channel.id}` && init?.method === 'PATCH') {
      posted.push(JSON.parse(String(init.body)))
      return jsonResponse({ channel })
    }
    throw new Error(`unexpected fetch ${url} ${init?.method}`)
  })
}

describe('ChannelsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('saves the description on blur when it changed', async () => {
    const posted: unknown[] = []
    vi.stubGlobal('fetch', stubFetch(posted))
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ChannelsPage />
      </MemoryRouter>,
    )

    const description = await screen.findByLabelText('Description')
    await user.clear(description)
    await user.type(description, 'New description')
    await user.tab()

    expect(posted).toEqual([{ description: 'New description' }])
  })

  it('saves the current topic on blur when it changed', async () => {
    const posted: unknown[] = []
    vi.stubGlobal('fetch', stubFetch(posted))
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ChannelsPage />
      </MemoryRouter>,
    )

    const topic = await screen.findByLabelText('Current topic')
    await user.clear(topic)
    await user.type(topic, 'New topic')
    await user.tab()

    expect(posted).toEqual([{ currentTopic: 'New topic' }])
  })

  it('lists games by name in the featured-game combobox and posts the picked id', async () => {
    const posted: unknown[] = []
    vi.stubGlobal('fetch', stubFetch(posted))
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ChannelsPage />
      </MemoryRouter>,
    )

    const combobox = await screen.findByRole('combobox', { name: 'Featured game for My Channel' })
    await user.click(combobox)
    expect(screen.getByRole('option', { name: 'Celeste' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Hades II' }))

    expect(posted).toEqual([{ featuredGameId: 'g2' }])
  })
})
