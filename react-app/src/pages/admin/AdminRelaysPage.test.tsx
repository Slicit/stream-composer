import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AdminRelaysPage } from './AdminRelaysPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const streams = [
  { id: 'aaaa-uuid', name: 'Front Row Cam', nickname: '', key: 'k1', playbackId: 'p1', enabled: true, note: '', visibility: 'public', createdAt: '' },
  { id: 'bbbb-uuid', name: 'Drum Cam', nickname: 'Drums', key: 'k2', playbackId: 'p2', enabled: true, note: '', visibility: 'public', createdAt: '' },
]

const providers = [{ id: 'twitch', label: 'Twitch', url: 'rtmp://live.twitch.tv/app', urlHint: '' }]

describe('AdminRelaysPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('picks a stream by name in the combobox and posts its id, not its name, when creating a relay', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/admin/relays' && (!init || init.method === undefined)) return jsonResponse({ relays: [], providers })
        if (url === '/api/admin/streams') return jsonResponse({ streams })
        if (url === '/api/admin/relays' && init?.method === 'POST') {
          posted.push(JSON.parse(String(init.body)))
          return jsonResponse({ relay: {} })
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )

    render(<AdminRelaysPage />)

    // The nickname, not the raw stream name, is what's shown when a stream
    // has one — matches what's burned into the grid tile, so it's the name
    // a user actually recognizes.
    await user.click(await screen.findByRole('combobox', { name: 'Source stream for the new relay' }))
    expect(screen.getByText('Front Row Cam')).toBeInTheDocument()
    expect(screen.getByText('Drums')).toBeInTheDocument()
    await user.click(screen.getByText('Drums'))

    await user.click(screen.getByRole('combobox', { name: 'Provider for the new relay' }))
    await user.click(screen.getByRole('option', { name: 'Twitch' }))
    await user.type(screen.getByLabelText('Stream key'), 'secret-key')

    await user.click(screen.getByRole('button', { name: 'Add relay' }))

    expect(posted).toEqual([{ streamId: 'bbbb-uuid', provider: 'twitch', url: 'rtmp://live.twitch.tv/app', key: 'secret-key' }])
  })

  it('disables Add relay until a source stream has been picked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/admin/relays') return jsonResponse({ relays: [], providers })
        if (url === '/api/admin/streams') return jsonResponse({ streams })
        throw new Error(`unexpected fetch ${url}`)
      }),
    )

    render(<AdminRelaysPage />)

    expect(await screen.findByRole('button', { name: 'Add relay' })).toBeDisabled()
  })
})
