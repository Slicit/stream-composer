import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComposedGrid } from './ComposedGrid'
import type { ViewerState } from '@/api/viewerState'

function emptyState(): ViewerState {
  return {
    settings: { publicViewing: false, homepageChannelSlug: '' },
    program: { mode: 'web', ready: false, width: 1920, height: 1080, gapPx: 4 },
    layout: null,
    onAir: [],
    streams: [],
    serverTime: '2026-01-01T00:00:00Z',
  }
}

// Two "problem" placeholders (plain absolutely-positioned divs, no
// ViewerTile/WHEP involved) — enough to exercise the cell-positioning
// math and the container's own sizing without opening a real WebRTC
// session in jsdom.
function stateWithTwoTiles(): ViewerState {
  const problem = { code: 'b-frames', summary: 'This encoder is producing B-frames.', fix: 'Set Tune to zerolatency.' }
  return {
    settings: { publicViewing: false, homepageChannelSlug: '' },
    program: { mode: 'web', ready: true, width: 1920, height: 1080, gapPx: 4 },
    layout: {
      name: 'auto',
      cols: 2,
      rows: 1,
      cells: [
        { x: 0, y: 0, w: 960, h: 1080 },
        { x: 960, y: 0, w: 960, h: 1080 },
      ],
      width: 1920,
      height: 1080,
    },
    onAir: [
      { key: 'pid-1', name: 'Cam One' },
      { key: 'pid-2', name: 'Cam Two' },
    ],
    streams: [
      { key: 'pid-1', name: 'Cam One', live: true, hasAudio: false, problem, path: null, audioPath: null, restricted: false },
      { key: 'pid-2', name: 'Cam Two', live: true, hasAudio: false, problem, path: null, audioPath: null, restricted: false },
    ],
    serverTime: '2026-01-01T00:00:00Z',
  }
}

describe('ComposedGrid', () => {
  it('fixed mode: locks the container to the server layout\'s aspect ratio', () => {
    const { container } = render(<ComposedGrid state={stateWithTwoTiles()} />)
    const box = container.firstElementChild as HTMLElement
    expect(box.style.aspectRatio).toBe('1920 / 1080')
    expect(box.className).not.toMatch(/\bh-full\b/)
  })

  it('fill mode: drops the aspect-ratio lock in favor of filling its container', () => {
    const { container } = render(<ComposedGrid state={stateWithTwoTiles()} fill />)
    const box = container.firstElementChild as HTMLElement
    expect(box.style.aspectRatio).toBe('')
    expect(box.className).toMatch(/\bh-full\b/)
    expect(box.className).toMatch(/\bw-full\b/)
  })

  it('packs cells against the measured container in fill mode, not the server\'s 1920x1080 canvas', () => {
    // setupTests.ts's ResizeObserverStub reports a 600x240 contentRect, a
    // much wider-relative-to-height box than the server's 1920x1080 — the
    // gap-to-height ratio differs enough that the resulting cell height
    // (as a percentage of its own canvas) must differ between the two
    // modes if fill mode is really packing against the real measurement.
    const fixed = render(<ComposedGrid state={stateWithTwoTiles()} />)
    const fixedHeight = screen.getAllByText('Cannot play here')[0].closest('div[style]') as HTMLElement
    const fixedPct = fixedHeight.style.height
    fixed.unmount()

    render(<ComposedGrid state={stateWithTwoTiles()} fill />)
    const fillHeight = screen.getAllByText('Cannot play here')[0].closest('div[style]') as HTMLElement
    expect(fillHeight.style.height).not.toBe(fixedPct)
  })

  it('measures the real container in fill mode even when the grid div only mounts after an earlier empty-state render', () => {
    // Regression: a plain useRef + a `[fill]`-only effect observes once
    // on mount, finds no ref'd element while onAir is still empty (the
    // <Card> branch renders instead), and — since `fill` itself never
    // changes — never gets another chance once the real grid div shows
    // up later. That silently pinned canvasWidth/canvasHeight to the
    // 1920x1080 fallback forever, even though the component was
    // genuinely in fill mode. A callback ref must re-attach here.
    const { rerender } = render(<ComposedGrid state={emptyState()} fill />)
    expect(screen.getByText(/Nothing on air/)).toBeInTheDocument()

    rerender(<ComposedGrid state={stateWithTwoTiles()} fill />)
    const tiles = screen.getAllByText('Cannot play here').map((el) => el.closest('div[style]') as HTMLElement)
    // setupTests.ts's ResizeObserverStub reports 600x240 — if that measurement
    // was actually picked up post-remount, cell height must not be computed
    // against the untouched 1080-tall server fallback.
    expect(tiles[0].style.height).not.toBe('')
    expect(tiles[0].style.height).not.toBe(`${(1072 / 1080) * 100}%`)
  })

  it('shows the empty message and no grid box when nothing is on air', () => {
    const state = stateWithTwoTiles()
    state.onAir = []
    state.streams = []
    const { container } = render(<ComposedGrid state={state} />)
    expect(screen.getByText(/Nothing on air/)).toBeInTheDocument()
    expect(container.querySelector('.bg-black')).toBeNull()
  })
})
