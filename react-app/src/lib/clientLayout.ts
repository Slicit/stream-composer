// A client-owned subset of go-service/internal/layout's grid math (auto
// grid + spotlight only — see that package's own doc comment for the
// full ported-from-layout.js algorithm). Used when the viewer hides
// streams or picks one to highlight: those are per-viewer choices the
// server never sees, so the grid has to be recomposed locally rather
// than waiting on a new GET /api/state response.

export interface Cell {
  x: number
  y: number
  w: number
  h: number
}

interface Options {
  width: number
  height: number
  gap: number
}

function even(n: number, min: number): number {
  const v = Math.floor(n / 2) * 2
  return v < min ? min : v
}

function clampToCanvas(cell: Cell, width: number, height: number): Cell {
  const w = Math.min(cell.w, width)
  const h = Math.min(cell.h, height)
  let x = cell.x
  if (x > width - w) x = width - w
  if (x < 0) x = 0
  let y = cell.y
  if (y > height - h) y = height - h
  if (y < 0) y = 0
  return { x: even(x, 0), y: even(y, 0), w, h }
}

function distribute(count: number, rows: number): number[] {
  const base = Math.floor(count / rows)
  const extra = count % rows
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0))
}

function gridCells(count: number, opts: Options, rows: number): Cell[] {
  const perRow = distribute(count, rows)
  const maxPerRow = Math.max(...perRow)
  const { width, height, gap } = opts
  const cellW = even((width - gap * (maxPerRow + 1)) / maxPerRow, 2)
  const cellH = even((height - gap * (rows + 1)) / rows, 2)

  const gridH = cellH * rows + gap * (rows + 1)
  const offsetY = even((height - gridH) / 2, 0)

  const cells: Cell[] = []
  let y = gap + offsetY
  for (const inRow of perRow) {
    const w = cellW
    const rowW = w * inRow + gap * (inRow - 1)
    let x = even((width - rowW) / 2, 0)
    for (let i = 0; i < inRow; i++) {
      cells.push(clampToCanvas({ x, y, w, h: cellH }, width, height))
      x += w + gap
    }
    y += cellH + gap
  }
  return cells
}

function spotlightCells(count: number, opts: Options): Cell[] {
  const { width, height, gap } = opts
  if (count === 1) {
    return [{ x: gap, y: gap, w: even(width - gap * 2, 2), h: even(height - gap * 2, 2) }]
  }
  const sideCount = count - 1
  const sideW = even(Math.max(width * 0.22, 220), 2)
  const mainW = even(width - sideW - gap * 3, 2)
  const mainH = even(height - gap * 2, 2)
  const sideH = even((height - gap * (sideCount + 1)) / sideCount, 2)

  const cells: Cell[] = [clampToCanvas({ x: gap, y: gap, w: mainW, h: mainH }, width, height)]
  let y = gap
  for (let i = 0; i < sideCount; i++) {
    cells.push(clampToCanvas({ x: gap * 2 + mainW, y, w: sideW, h: sideH }, width, height))
    y += sideH + gap
  }
  return cells
}

/**
 * Lays out `count` cells on a `width` x `height` canvas. When
 * `spotlightIndex` is given (and count > 1), that index gets the large
 * cell and everything else stacks down the side — otherwise an auto grid
 * balancing rows/columns, both ported field-for-field from layout.go's
 * "auto"/"spotlight" cases.
 */
export function computeClientLayout(count: number, opts: Options, spotlightIndex: number | null): Cell[] {
  const width = even(opts.width || 1920, 2)
  const height = even(opts.height || 1080, 2)
  const gap = Math.max(opts.gap, 0)
  const o = { width, height, gap }

  if (count <= 0) return []
  if (count === 1) return [{ x: 0, y: 0, w: width, h: height }]

  if (spotlightIndex !== null && spotlightIndex >= 0 && spotlightIndex < count) {
    // Reorder so the spotlighted index lands first (spotlightCells always
    // gives cell 0 the large slot), then map the result back.
    const order = [spotlightIndex, ...Array.from({ length: count }, (_, i) => i).filter((i) => i !== spotlightIndex)]
    const cells = spotlightCells(count, o)
    const byOriginalIndex: Cell[] = new Array(count)
    order.forEach((originalIndex, cellIndex) => {
      byOriginalIndex[originalIndex] = cells[cellIndex]
    })
    return byOriginalIndex
  }

  const { rows } = bestGrid(count, width, height)
  return gridCells(count, o, rows)
}

// A source is typically ~16:9 — used only to score candidate grids, never
// to distort a cell's own shape (cells stay uniform rectangles; ViewerTile
// crops with object-cover rather than letterboxing).
const SOURCE_ASPECT = 16 / 9

// Picks cols/rows for an "auto" grid by the same idea video-conferencing
// gallery views use: try every (cols, rows) that fits `count` cells with
// no wasted full row, and keep whichever gives the largest picture once a
// ~16:9 source is cropped to fill its cell — i.e. the grid an actual
// video is biggest and least-cropped in, not a fixed ceil(sqrt(count))
// guess. That guess only ever suits a landscape canvas; on a canvas
// that's actually taller than it is wide (a "maximize" stage on a narrow
// or portrait-ish window) it can leave a 2-across grid mostly empty
// where a single column would fill the space. Deliberately not shared
// with go-service/internal/layout's own "auto" case: that Go code is a
// golden-master port of the legacy Node layout.js (see its own test),
// pinned to match that reference exactly — this is a client-only
// refinement with no such constraint.
function bestGrid(count: number, width: number, height: number): { cols: number; rows: number } {
  let best = { cols: count, rows: 1, area: -1 }
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    // A full row would go unused with fewer columns — skip it, it can
    // only ever be a worse packing of the same count.
    if (cols > 1 && (cols - 1) * rows >= count) continue
    const cellW = width / cols
    const cellH = height / rows
    const pictureW = Math.min(cellW, cellH * SOURCE_ASPECT)
    const pictureH = pictureW / SOURCE_ASPECT
    const area = pictureW * pictureH
    // >= , not >: on an exact tie (e.g. 2 items on a plain 16:9 canvas —
    // stacked and side-by-side both crop identically), prefer the later,
    // wider candidate. Columns are tried in ascending order, so this
    // favours the more landscape-leaning of two equally-good options,
    // matching what a landscape canvas is conventionally expected to do.
    if (area >= best.area) best = { cols, rows, area }
  }
  return best
}
