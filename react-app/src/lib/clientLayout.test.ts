import { describe, expect, it } from 'vitest'
import { computeClientLayout } from './clientLayout'

describe('computeClientLayout', () => {
  it('gives a single stream the full canvas', () => {
    const cells = computeClientLayout(1, { width: 1920, height: 1080, gap: 4 }, null)
    expect(cells).toEqual([{ x: 0, y: 0, w: 1920, h: 1080 }])
  })

  it('lays out an auto grid balancing rows and columns', () => {
    const cells = computeClientLayout(4, { width: 1920, height: 1080, gap: 4 }, null)
    expect(cells).toHaveLength(4)
    // A 2x2 grid: every cell the same size, roughly half the canvas each way.
    const widths = new Set(cells.map((c) => c.w))
    const heights = new Set(cells.map((c) => c.h))
    expect(widths.size).toBe(1)
    expect(heights.size).toBe(1)
  })

  it('gives the spotlighted index the large cell', () => {
    const cells = computeClientLayout(3, { width: 1920, height: 1080, gap: 4 }, 1)
    expect(cells).toHaveLength(3)
    const spotlighted = cells[1]
    const others = [cells[0], cells[2]]
    expect(spotlighted.w * spotlighted.h).toBeGreaterThan(others[0].w * others[0].h)
    expect(spotlighted.w * spotlighted.h).toBeGreaterThan(others[1].w * others[1].h)
  })

  it('keeps every cell inside the canvas', () => {
    for (const count of [1, 2, 3, 5, 7, 9]) {
      const cells = computeClientLayout(count, { width: 1920, height: 1080, gap: 4 }, null)
      for (const c of cells) {
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.x + c.w).toBeLessThanOrEqual(1920)
        expect(c.y + c.h).toBeLessThanOrEqual(1080)
      }
    }
  })

  it('returns nothing for a non-positive count', () => {
    expect(computeClientLayout(0, { width: 1920, height: 1080, gap: 4 }, null)).toEqual([])
  })
})
