import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AdminSettingsPage } from './AdminSettingsPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('AdminSettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the current settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ settings: { defaultLayoutMode: 'fixed', publicViewing: false } })),
    )

    render(<AdminSettingsPage />)

    expect(await screen.findByText('Fixed (1920x1080)')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Allow public viewing' })).not.toBeChecked()
  })

  it('changes the default layout mode', async () => {
    const patched: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/admin/settings' && (!init || init.method === undefined)) {
          return jsonResponse({ settings: { defaultLayoutMode: 'fixed', publicViewing: false } })
        }
        if (url === '/api/admin/settings' && init?.method === 'PATCH') {
          patched.push(JSON.parse(String(init.body)))
          return jsonResponse({ settings: { defaultLayoutMode: 'maximize', publicViewing: false } })
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    render(<AdminSettingsPage />)

    await user.click(await screen.findByRole('combobox', { name: 'Default grid layout' }))
    await user.click(screen.getByRole('option', { name: 'Maximize page space' }))

    expect(patched).toEqual([{ defaultLayoutMode: 'maximize' }])
    expect(await screen.findByText('Maximize page space')).toBeInTheDocument()
  })

  it('toggles public viewing', async () => {
    const patched: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/admin/settings' && (!init || init.method === undefined)) {
          return jsonResponse({ settings: { defaultLayoutMode: 'fixed', publicViewing: false } })
        }
        if (url === '/api/admin/settings' && init?.method === 'PATCH') {
          patched.push(JSON.parse(String(init.body)))
          return jsonResponse({ settings: { defaultLayoutMode: 'fixed', publicViewing: true } })
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    render(<AdminSettingsPage />)
    await user.click(await screen.findByRole('switch', { name: 'Allow public viewing' }))

    expect(patched).toEqual([{ publicViewing: true }])
  })
})
