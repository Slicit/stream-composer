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

  it('caps the grid\'s height budget to leave room for the title in "maximize" mode, unlike "fixed"', async () => {
    // The stage itself no longer carries a forced height (that changed
    // when the grid switched to sizing itself to its content rather than
    // stretching) — what "maximize" actually does now is pass
    // ComposedGrid a maxHeight budget (viewport space minus the title
    // block's own measured height), which shows up as a bounded
    // aspect-ratio on the grid box. Fixed mode ignores the viewport
    // entirely and always renders the plain 1920/1080 ratio.
    const problem = { code: 'b-frames', summary: 'x', fix: 'y' }
    function channelState(layoutMode: 'fixed' | 'maximize') {
      return jsonResponse({
        settings: { publicViewing: false, homepageChannelSlug: '' },
        program: { mode: 'web', ready: true, width: 1920, height: 1080, gapPx: 4 },
        layout: { name: 'auto', cols: 2, rows: 1, cells: [], width: 1920, height: 1080 },
        onAir: [
          { key: 'pid-1', name: 'Cam One' },
          { key: 'pid-2', name: 'Cam Two' },
        ],
        streams: [
          { key: 'pid-1', name: 'Cam One', live: true, hasAudio: false, problem, path: null, audioPath: null, restricted: false },
          { key: 'pid-2', name: 'Cam Two', live: true, hasAudio: false, problem, path: null, audioPath: null, restricted: false },
        ],
        serverTime: '2026-01-01T00:00:00Z',
        channel: { name: 'Duo', slug: 'duo', backgroundImage: '', description: '', currentTopic: '', featuredGame: '', layoutMode },
      })
    }

    vi.stubGlobal('fetch', vi.fn(() => channelState('fixed')))
    const fixed = renderAtSlug('duo')
    await waitFor(() => expect(screen.getByText('Duo')).toBeInTheDocument())
    const fixedBox = fixed.container.querySelector('.bg-black') as HTMLElement
    expect(fixedBox.style.aspectRatio).toBe('1920 / 1080')
    fixed.unmount()

    vi.stubGlobal('fetch', vi.fn(() => channelState('maximize')))
    const maximized = renderAtSlug('duo')
    await waitFor(() => expect(screen.getByText('Duo')).toBeInTheDocument())
    const maximizedBox = maximized.container.querySelector('.bg-black') as HTMLElement
    await waitFor(() => expect(maximizedBox.style.aspectRatio).not.toBe(''))
    expect(maximizedBox.style.aspectRatio).not.toBe('1920 / 1080')
  })
})
