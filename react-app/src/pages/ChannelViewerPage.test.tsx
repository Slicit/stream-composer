import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ChannelPrefsProvider } from '@/contexts/ChannelPrefsContext'
import { ChannelViewerPage } from './ChannelViewerPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function renderAtSlug(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/c/${slug}`]}>
      <ChannelPrefsProvider>
        <Routes>
          <Route path="/c/:slug" element={<ChannelViewerPage />} />
        </Routes>
      </ChannelPrefsProvider>
    </MemoryRouter>,
  )
}

describe('ChannelViewerPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows "No such channel." for a 404 (unknown slug or denied access — indistinguishable on purpose)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 404 }))),
    )

    renderAtSlug('nope')
    await waitFor(() => expect(screen.getByText('No such channel.')).toBeInTheDocument())
  })

  it('renders the channel name and a restricted member as a private-stream placeholder, not a live tile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        expect(url).toBe('/api/channels/mixed/state')
        return jsonResponse({
          settings: { publicViewing: false, homepageChannelSlug: '' },
          program: { mode: 'web', ready: true, width: 1920, height: 1080, gapPx: 4 },
          layout: { name: 'auto', cols: 1, rows: 1, cells: [{ x: 0, y: 0, w: 1920, h: 1080 }], width: 1920, height: 1080 },
          onAir: [{ key: 'pid-1', name: 'Private Cam' }],
          streams: [
            {
              key: 'pid-1',
              name: 'Private Cam',
              live: true,
              hasAudio: false,
              problem: null,
              path: null,
              audioPath: null,
              restricted: true,
            },
          ],
          serverTime: '2026-01-01T00:00:00Z',
          channel: {
            name: 'Mixed Channel',
            slug: 'mixed',
            backgroundImage: '',
            description: 'A place for mixed streams',
            currentTopic: 'Just chatting',
            featuredGame: 'Stardew Valley',
            layoutMode: 'fixed',
          },
        })
      }),
    )

    renderAtSlug('mixed')
    await waitFor(() => expect(screen.getByText('Mixed Channel')).toBeInTheDocument())
    expect(screen.getByText('This stream is private')).toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()

    // The description replaces the old top title; the channel name now
    // sits alongside the featured game and current topic instead.
    expect(screen.getByText('A place for mixed streams')).toBeInTheDocument()
    expect(screen.getByText('Playing Stardew Valley')).toBeInTheDocument()
    expect(screen.getByText('Just chatting')).toBeInTheDocument()

    const nameEl = screen.getByText('Mixed Channel')

    // The one member is live (even though restricted), so the channel
    // itself counts as live — matches ComposedGrid's own "restricted
    // still occupies a cell" treatment.
    expect(nameEl.closest('span')?.querySelector('[role="status"]')).toHaveAccessibleName('Live')
  })

  it('bounds the page to the available viewport height in "maximize" layout mode, unlike "fixed"', async () => {
    function channelState(layoutMode: 'fixed' | 'maximize') {
      return jsonResponse({
        settings: { publicViewing: false, homepageChannelSlug: '' },
        program: { mode: 'web', ready: false, width: 1920, height: 1080, gapPx: 4 },
        layout: null,
        onAir: [],
        streams: [],
        serverTime: '2026-01-01T00:00:00Z',
        channel: { name: 'Solo', slug: 'solo', backgroundImage: '', description: '', currentTopic: '', featuredGame: '', layoutMode },
      })
    }

    vi.stubGlobal('fetch', vi.fn(() => channelState('maximize')))
    const maximized = renderAtSlug('solo')
    await waitFor(() => expect(screen.getByText('Solo')).toBeInTheDocument())
    const maximizedStage = maximized.container.firstElementChild as HTMLElement
    await waitFor(() => expect(maximizedStage.style.height).not.toBe(''))
    maximized.unmount()

    vi.stubGlobal('fetch', vi.fn(() => channelState('fixed')))
    const fixed = renderAtSlug('solo')
    await waitFor(() => expect(screen.getByText('Solo')).toBeInTheDocument())
    const fixedStage = fixed.container.firstElementChild as HTMLElement
    expect(fixedStage.style.height).toBe('')
  })
})
