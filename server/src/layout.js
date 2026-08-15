'use strict';

/**
 * Layout engine.
 *
 * Turns "N live streams" into concrete pixel rectangles on the output canvas.
 * Everything downstream (the ffmpeg filtergraph, the UI preview) is generated
 * from these rectangles, so layouts stay in one place and are unit-testable.
 *
 * All rectangles are clamped to even pixel values because H.264 chroma
 * subsampling requires even dimensions.
 */

/**
 * Keep a rectangle inside the canvas. Cell sizes bottom out at 2px but the
 * running offset does not, so a large gutter with many rows could otherwise
 * place cells past the edge, where they simply vanish with no error.
 */
function clampToCanvas(cell, width, height) {
  const w = Math.min(cell.w, width);
  const h = Math.min(cell.h, height);
  return {
    x: even(Math.max(0, Math.min(cell.x, width - w)), 0),
    y: even(Math.max(0, Math.min(cell.y, height - h)), 0),
    w,
    h,
  };
}

/** Round down to the nearest even number, never below `min`. */
function even(n, min = 2) {
  const v = Math.floor(n / 2) * 2;
  return Math.max(min, v);
}

/**
 * Split `count` items across `rows` rows, filling the top rows first.
 * 5 items over 2 rows -> [3, 2];  7 over 3 -> [3, 2, 2]
 */
function distribute(count, rows) {
  const base = Math.floor(count / rows);
  const extra = count % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Uniform grid: every cell is the same size, partial rows are centred.
 * When `fill` is set, the cells of a partial row stretch to use the width.
 */
function gridCells(count, { width, height, gap, cols, rows, fill = false }) {
  const perRow = distribute(count, rows);
  const maxPerRow = Math.max(...perRow);
  const cellW = even((width - gap * (maxPerRow + 1)) / maxPerRow);
  const cellH = even((height - gap * (rows + 1)) / rows);

  const gridH = cellH * rows + gap * (rows + 1);
  const offsetY = even((height - gridH) / 2, 0);

  const cells = [];
  let y = gap + offsetY;
  for (const inRow of perRow) {
    const w = fill ? even((width - gap * (inRow + 1)) / inRow) : cellW;
    const rowW = w * inRow + gap * (inRow - 1);
    let x = even((width - rowW) / 2, 0);
    for (let i = 0; i < inRow; i++) {
      cells.push(clampToCanvas({ x, y, w, h: cellH }, width, height));
      x += w + gap;
    }
    y += cellH + gap;
  }
  return { cells, cols, rows };
}

/** One large cell plus a stack of smaller ones down the right-hand side. */
function spotlightCells(count, { width, height, gap }) {
  if (count === 1) {
    return { cells: [{ x: gap, y: gap, w: even(width - gap * 2), h: even(height - gap * 2) }], cols: 1, rows: 1 };
  }
  const sideCount = count - 1;
  const sideW = even(Math.max(width * 0.22, 220));
  const mainW = even(width - sideW - gap * 3);
  const mainH = even(height - gap * 2);
  const sideH = even((height - gap * (sideCount + 1)) / sideCount);

  const cells = [clampToCanvas({ x: gap, y: gap, w: mainW, h: mainH }, width, height)];
  let y = gap;
  for (let i = 0; i < sideCount; i++) {
    cells.push(clampToCanvas({ x: gap * 2 + mainW, y, w: sideW, h: sideH }, width, height));
    y += sideH + gap;
  }
  return { cells, cols: 2, rows: sideCount, spotlight: true };
}

// Bounded on purpose: an unbounded digit run becomes Infinity via parseInt,
// which propagates NaN through every cell and yields a filtergraph ffmpeg
// cannot configure — leaving the encoder in a permanent restart loop.
const FIXED = /^([1-9]|1[0-9]|2[0-4])x([1-9]|1[0-9]|2[0-4])$/;

/**
 * @param {number} count  number of sources to place (>= 0)
 * @param {object} opts   { width, height, gap, layout }
 * @returns {{cells: Array<{x:number,y:number,w:number,h:number}>, cols:number, rows:number, layout:string, capacity:number}}
 */
function computeLayout(count, opts = {}) {
  const width = even(opts.width || 1920);
  const height = even(opts.height || 1080);
  const gap = Math.max(0, Math.floor(opts.gap ?? 4));
  const layout = String(opts.layout || 'auto').toLowerCase();

  if (count <= 0) return { cells: [], cols: 0, rows: 0, layout, capacity: 0, width, height };

  // Single source always fills the canvas, whatever the layout says.
  if (count === 1 && (layout === 'auto' || layout === 'solo')) {
    return { cells: [{ x: 0, y: 0, w: width, h: height }], cols: 1, rows: 1, layout, capacity: 1, width, height };
  }

  if (layout === 'solo') {
    return { cells: [{ x: 0, y: 0, w: width, h: height }], cols: 1, rows: 1, layout, capacity: 1, width, height };
  }

  if (layout === 'spotlight') {
    const r = spotlightCells(count, { width, height, gap });
    return { ...r, layout, capacity: count, width, height };
  }

  if (layout === 'row') {
    const r = gridCells(count, { width, height, gap, cols: count, rows: 1 });
    return { ...r, layout, capacity: count, width, height };
  }

  if (layout === 'column') {
    const r = gridCells(count, { width, height, gap, cols: 1, rows: count });
    return { ...r, layout, capacity: count, width, height };
  }

  const fixed = FIXED.exec(layout);
  if (fixed) {
    const cols = Math.max(1, parseInt(fixed[1], 10));
    const rows = Math.max(1, parseInt(fixed[2], 10));
    const capacity = cols * rows;
    const used = Math.min(count, capacity);
    // A fixed grid keeps its shape: cells are sized for the full matrix and
    // sources are placed left-to-right, top-to-bottom.
    const cellW = even((width - gap * (cols + 1)) / cols);
    const cellH = even((height - gap * (rows + 1)) / rows);
    const cells = [];
    for (let i = 0; i < used; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      cells.push(clampToCanvas({ x: gap + c * (cellW + gap), y: gap + r * (cellH + gap), w: cellW, h: cellH }, width, height));
    }
    return { cells, cols, rows, layout, capacity, width, height };
  }

  // auto
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const r = gridCells(count, { width, height, gap, cols, rows });
  return { ...r, layout: 'auto', capacity: count, width, height };
}

const LAYOUTS = [
  { id: 'auto', label: 'Auto grid', hint: 'Balances rows and columns for however many streams are live' },
  { id: 'solo', label: 'Single', hint: 'Shows only the first stream, full frame' },
  { id: 'row', label: 'Single row', hint: 'All streams side by side' },
  { id: 'column', label: 'Single column', hint: 'All streams stacked' },
  { id: 'spotlight', label: 'Spotlight', hint: 'One large stream with the rest down the side' },
  { id: '2x1', label: '2 x 1', hint: 'Fixed two-up' },
  { id: '2x2', label: '2 x 2', hint: 'Fixed quad' },
  { id: '3x3', label: '3 x 3', hint: 'Fixed nine-up' },
  { id: '4x4', label: '4 x 4', hint: 'Fixed sixteen-up' },
];

function isValidLayout(id) {
  return LAYOUTS.some((l) => l.id === id) || FIXED.test(String(id || ''));
}

module.exports = { computeLayout, distribute, even, LAYOUTS, isValidLayout };
