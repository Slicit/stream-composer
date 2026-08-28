import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ChannelComposition, RelayProvider } from '@/api/types'
import { ChannelCompositionSection } from './ChannelCompositionSection'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function composition(overrides: Partial<ChannelComposition> = {}): ChannelComposition {
  return {
    id: overrides.orientation === 'vertical' ? 'comp-v' : 'comp-h',
    channelId: 'c1',
    orientation: 'horizontal',
    enabled: false,
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateKbps: 4500,
    preset: 'veryfast',
    encoder: 'auto',
    backgroundColor: '#0b1220',
    labels: true,
    labelSize: 22,
    destinations: [],
    createdAt: '2026-01-01',
    ...overrides,
  }
}

const providers: RelayProvider[] = [
  { id: 'twitch', label: 'Twitch', url: 'rtmp://live.twitch.tv/app', urlLabel: 'Ingest server', urlHint: '', keyLabel: 'Key', keyHint: '' },
]

const apiBase = '/api/channels/mine/c1/compositions'

describe('ChannelCompositionSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders both orientation cards, disabled by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === apiBase) return jsonResponse({ compositions: [composition(), composition({ orientation: 'vertical' })], providers })
        throw new Error(`unexpected fetch ${url}`)
      }),
    )

    render(<ChannelCompositionSection apiBase={apiBase} />)

    // "capitalize" in OrientationCard's title is a CSS transform, not a
    // text change — the actual text content stays lowercase.
    expect(await screen.findByText('horizontal')).toBeInTheDocument()
    expect(screen.getByText('vertical')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable horizontal composition' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Enable vertical composition' })).not.toBeChecked()
  })

  it('PATCHes enabled when the switch is toggled', async () => {
    const patched: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === apiBase && (!init || init.method === undefined)) return jsonResponse({ compositions: [composition(), composition({ orientation: 'vertical' })], providers })
        if (url === `${apiBase}/horizontal` && init?.method === 'PATCH') {
          patched.push(JSON.parse(String(init.body)))
          return jsonResponse({ composition: composition({ enabled: true }) })
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    render(<ChannelCompositionSection apiBase={apiBase} />)
    await user.click(await screen.findByRole('switch', { name: 'Enable horizontal composition' }))

    expect(patched).toEqual([{ enabled: true }])
  })

  it('applies a resolution preset by setting width and height together', async () => {
    const patched: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === apiBase && (!init || init.method === undefined)) return jsonResponse({ compositions: [composition({ orientation: 'vertical' })], providers })
        if (url === `${apiBase}/vertical` && init?.method === 'PATCH') {
          patched.push(JSON.parse(String(init.body)))
          return jsonResponse({ composition: composition({ orientation: 'vertical', width: 1080, height: 1920 }) })
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    render(<ChannelCompositionSection apiBase={apiBase} />)
    await user.click(await screen.findByRole('combobox', { name: 'vertical resolution' }))
    await user.click(screen.getByRole('option', { name: '1080x1920 (TikTok/Shorts/Reels)' }))

    expect(patched).toEqual([{ width: 1080, height: 1920 }])
  })

  it('adds a destination and posts to the orientation-scoped endpoint', async () => {
    const posted: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === apiBase && (!init || init.method === undefined)) return jsonResponse({ compositions: [composition()], providers })
        if (url === `${apiBase}/horizontal/destinations` && init?.method === 'POST') {
          posted.push(JSON.parse(String(init.body)))
          return jsonResponse({ destination: {} }, 201)
        }
        throw new Error(`unexpected fetch ${url} ${init?.method}`)
      }),
    )
    const user = userEvent.setup()

    render(<ChannelCompositionSection apiBase={apiBase} />)
    await screen.findByText('horizontal')

    // Only one composition (horizontal) is passed in, so there's exactly
    // one provider combobox/key field/submit button on screen.
    await user.click(screen.getByRole('combobox', { name: /Provider for the new horizontal destination/ }))
    await user.click(screen.getByRole('option', { name: 'Twitch' }))
    await user.type(screen.getByLabelText('Stream key'), 'a-key')
    await user.click(screen.getByRole('button', { name: 'Add destination' }))

    expect(posted).toEqual([{ provider: 'twitch', url: 'rtmp://live.twitch.tv/app', key: 'a-key' }])
  })
})
