import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ViewerTile } from './ViewerTile'

// ViewerTile opens a real WHEP/WebRTC session on mount — irrelevant to
// what's under test here (the letterbox-aware caption math), and not
// something jsdom can do at all, so it's stubbed out entirely.
vi.mock('@/lib/whep', () => ({
  WhepClient: class {
    onState() {
      return () => {}
    }
    onTrack() {
      return () => {}
    }
    onStats() {
      return () => {}
    }
    start() {}
    stop() {}
  },
}))

function loadVideoWithIntrinsicSize(width: number, height: number) {
  const video = document.querySelector('video') as HTMLVideoElement
  Object.defineProperty(video, 'videoWidth', { value: width, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: height, configurable: true })
  fireEvent.loadedMetadata(video)
}

describe('ViewerTile', () => {
  it('keeps the caption at the plain bottom-1 gap when nothing is letterboxed (video ratio unknown yet)', () => {
    render(<ViewerTile path="s/p1" name="Cam" cell={{ x: 0, y: 0, w: 960, h: 540 }} canvasWidth={1920} canvasHeight={1080} />)
    const caption = screen.getByText('Cam')
    expect(caption.style.bottom).toBe('calc(0% + 0.25rem)')
  })

  it('leaves the caption alone when the source is relatively taller than its cell (height-constrained, no vertical letterboxing)', () => {
    // Cell is 2:1 (very wide), source is 16:9 — height-constrained, fills
    // the cell's full height, letterboxes left/right only.
    render(<ViewerTile path="s/p1" name="Cam" cell={{ x: 0, y: 0, w: 2000, h: 1000 }} canvasWidth={1920} canvasHeight={1080} />)
    loadVideoWithIntrinsicSize(1920, 1080)
    expect(screen.getByText('Cam').style.bottom).toBe('calc(0% + 0.25rem)')
  })

  it('lifts the caption by half the vertical letterbox when the source is relatively wider than its cell', () => {
    // Cell is a 1:1 square, source is 16:9 — width-constrained, so the
    // picture only fills 9/16 of the cell's height, split evenly top/bottom.
    render(<ViewerTile path="s/p1" name="Cam" cell={{ x: 0, y: 0, w: 500, h: 500 }} canvasWidth={1920} canvasHeight={1080} />)
    loadVideoWithIntrinsicSize(1920, 1080)

    const cellAspect = 1
    const videoRatio = 16 / 9
    const letterboxFraction = 1 - cellAspect / videoRatio
    const expected = `calc(${(letterboxFraction / 2) * 100}% + 0.25rem)`
    expect(screen.getByText('Cam').style.bottom).toBe(expected)
  })

  it('renders the video with object-contain so the picture is always fully visible, never cropped', () => {
    render(<ViewerTile path="s/p1" name="Cam" cell={{ x: 0, y: 0, w: 500, h: 500 }} canvasWidth={1920} canvasHeight={1080} />)
    const video = document.querySelector('video')
    expect(video?.className).toMatch(/\bobject-contain\b/)
    expect(video?.className).not.toMatch(/\bobject-cover\b/)
  })
})
