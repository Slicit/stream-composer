import { describe, expect, it } from 'vitest'
import { computeClientLayout, naturalFillHeight } from './clientLayout'

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

  it('stacks a portrait-ish canvas into a single column instead of a 2-across row that leaves it half empty', () => {
    // Narrow and tall — e.g. a "maximize" stage on a phone-width window.
    const cells = computeClientLayout(2, { width: 700, height: 1400, gap: 4 }, null)
    expect(cells).toHaveLength(2)
    // Stacked: both cells span (close to) the full width, and the second
    // sits below the first rather than beside it.
    expect(cells[0].x).toBe(cells[1].x)
    expect(cells[0].y).toBeLessThan(cells[1].y)
    expect(cells[0].w).toBeGreaterThan(600)
  })

  it('still lays a landscape canvas out side by side, not stacked', () => {
    const cells = computeClientLayout(2, { width: 1920, height: 1080, gap: 4 }, null)
    expect(cells).toHaveLength(2)
    expect(cells[0].y).toBe(cells[1].y)
    expect(cells[0].x).toBeLessThan(cells[1].x)
  })

  it('picks whichever grid leaves the least of each 16:9-ish cell unused, not a fixed ceil(sqrt(count)) guess', () => {
    // 3 sources on a very wide, short canvas: a naive sqrt(3)->2 columns
    // grid would need 2 rows (half the canvas height each), when a
    // single row of 3 already fits and uses the width far better.
    const cells = computeClientLayout(3, { width: 3000, height: 500, gap: 4 }, null)
    expect(cells).toHaveLength(3)
    expect(new Set(cells.map((c) => c.y)).size).toBe(1)
  })
})

describe('naturalFillHeight', () => {
  it('returns 0 for a non-positive count', () => {
    expect(naturalFillHeight(0, 1920, 1080, 4)).toBe(0)
  })

  it('sizes a single video to its own ~16:9 height, not the full budget, when width is the binding constraint', () => {
    const height = naturalFillHeight(1, 800, 2000, 4)
    expect(height).toBeLessThan(2000)
    expect(height).toBeCloseTo(800 / (16 / 9), 0)
  })

  it('never exceeds the given budget even when the natural height would want more', () => {
    const height = naturalFillHeight(1, 3000, 300, 4)
    expect(height).toBeLessThanOrEqual(300)
  })

  it('shrinks well below a generous budget for a narrow stacked pair, instead of always claiming the whole thing', () => {
    // Matches computeClientLayout's own choice for this shape: narrow and
    // tall stacks 2 items into a single column.
    const height = naturalFillHeight(2, 444, 2000, 4)
    expect(height).toBeLessThan(600)
  })

  it('uses the full budget when the canvas is wide enough that height, not width, is the binding constraint', () => {
    const height = naturalFillHeight(2, 2000, 300, 4)
    expect(height).toBe(300)
  })
})
