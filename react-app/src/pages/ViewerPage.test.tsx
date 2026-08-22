import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ViewerPage } from './ViewerPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('ViewerPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a message when nothing is on air', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse({
          settings: { publicViewing: false },
          program: { mode: 'web', ready: false, width: 1920, height: 1080, gapPx: 4 },
          layout: null,
          onAir: [],
          streams: [],
          serverTime: '2026-01-01T00:00:00Z',
        }),
      ),
    )

    render(<ViewerPage />)
    await waitFor(() => expect(screen.getByText(/Nothing on air/)).toBeInTheDocument())
  })

  it('renders a playability problem as a static placeholder, not a live tile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse({
          settings: { publicViewing: false },
          program: { mode: 'web', ready: true, width: 1920, height: 1080, gapPx: 4 },
          layout: { name: 'auto', cols: 1, rows: 1, cells: [{ x: 0, y: 0, w: 1920, h: 1080 }], width: 1920, height: 1080 },
          onAir: [{ key: 'pid-1', name: 'Cam One' }],
          streams: [
            {
              key: 'pid-1',
              name: 'Cam One',
              live: true,
              hasAudio: false,
              problem: { code: 'b-frames', summary: 'This encoder is producing B-frames.', fix: 'Set Tune to zerolatency.' },
              path: 's/pid-1',
              audioPath: null,
            },
          ],
          serverTime: '2026-01-01T00:00:00Z',
        }),
      ),
    )

    render(<ViewerPage />)
    await waitFor(() => expect(screen.getByText('Cannot play here')).toBeInTheDocument())
    expect(screen.getByText(/This encoder is producing B-frames/)).toBeInTheDocument()
    // A problem tile must never mount a <video> (no WHEP/RTCPeerConnection attempt).
    expect(document.querySelector('video')).toBeNull()
  })
})
