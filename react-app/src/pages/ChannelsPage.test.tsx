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
  description: '',
  currentTopic: '',
  featuredGameId: null,
  featuredGameName: null,
  layoutMode: null,
  createdAt: '2026-01-01',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ChannelsPage />
    </MemoryRouter>,
  )
}

describe('ChannelsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lists a channel with a link to its edit page and its public URL', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ channels: [channel] })))

    renderPage()

    expect(await screen.findByRole('link', { name: 'My Channel' })).toHaveAttribute('href', '/channels/c1')
    expect(screen.getByRole('link', { name: '/c/my-channel' })).toHaveAttribute('href', '/c/my-channel')
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/channels/c1')
  })

  it('creates a channel from the form', async () => {
    const posted: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/channels/mine' && (!init || init.method === undefined)) return jsonResponse({ channels: [] })
        if (url === '/api/channels/mine' && init?.method === 'POST') {
          posted.push(JSON.parse(String(init.body)))
          return jsonResponse({ channel }, 201)
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    renderPage()
    await screen.findByText('No channels yet.')
    await user.type(screen.getByLabelText('Name'), 'My Channel')
    await user.click(screen.getByRole('button', { name: 'Add channel' }))

    expect(posted).toEqual([{ name: 'My Channel' }])
  })

  it('changes visibility as a quick action from the list', async () => {
    const patched: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/channels/mine' && (!init || init.method === undefined)) return jsonResponse({ channels: [channel] })
        if (url === '/api/channels/mine/c1' && init?.method === 'PATCH') {
          patched.push(JSON.parse(String(init.body)))
          return jsonResponse({ channel: { ...channel, visibility: 'public' } })
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('combobox', { name: 'Visibility for My Channel' }))
    await user.click(screen.getByRole('option', { name: 'Public' }))

    expect(patched).toEqual([{ visibility: 'public' }])
  })

  it('deletes a channel after confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const deleted: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/channels/mine' && (!init || init.method === undefined)) return jsonResponse({ channels: [channel] })
        if (url === '/api/channels/mine/c1' && init?.method === 'DELETE') {
          deleted.push(url)
          return jsonResponse({ ok: true })
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByTitle('Delete'))

    expect(deleted).toEqual(['/api/channels/mine/c1'])
  })
})
