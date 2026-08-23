import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AdminGamesPage } from './AdminGamesPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const games = [
  { id: 'g1', name: 'Celeste' },
  { id: 'g2', name: 'Hades II' },
]

describe('AdminGamesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lists games and creates a new one', async () => {
    const posted: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/admin/games' && (!init || init.method === undefined)) return jsonResponse({ games })
        if (url === '/api/admin/games' && init?.method === 'POST') {
          posted.push(JSON.parse(String(init.body)))
          return jsonResponse({ game: { id: 'g3', name: 'Balatro' } }, 201)
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    render(<AdminGamesPage />)

    expect(await screen.findByDisplayValue('Celeste')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Hades II')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Name'), 'Balatro')
    await user.click(screen.getByRole('button', { name: 'Add game' }))

    expect(posted).toEqual([{ name: 'Balatro' }])
  })

  it('renames a game on blur when the value changed', async () => {
    const patched: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/admin/games' && (!init || init.method === undefined)) return jsonResponse({ games })
        if (url === '/api/admin/games/g1' && init?.method === 'PATCH') {
          patched.push(JSON.parse(String(init.body)))
          return jsonResponse({ game: { id: 'g1', name: 'Celeste Classic' } })
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    render(<AdminGamesPage />)

    const field = await screen.findByLabelText('Name for Celeste')
    await user.clear(field)
    await user.type(field, 'Celeste Classic')
    await user.tab()

    expect(patched).toEqual([{ name: 'Celeste Classic' }])
  })

  it('does not PATCH when the name is blurred unchanged', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/admin/games' && (!init || init.method === undefined)) return jsonResponse({ games })
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<AdminGamesPage />)

    const field = await screen.findByLabelText('Name for Celeste')
    await user.click(field)
    await user.tab()

    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false)
  })

  it('deletes a game after confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const deleted: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/admin/games' && (!init || init.method === undefined)) return jsonResponse({ games })
        if (url === '/api/admin/games/g1' && init?.method === 'DELETE') {
          deleted.push(url)
          return jsonResponse({ ok: true })
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    render(<AdminGamesPage />)

    await screen.findByDisplayValue('Celeste')
    await user.click(screen.getAllByTitle('Delete')[0])

    expect(deleted).toEqual(['/api/admin/games/g1'])
  })
})
