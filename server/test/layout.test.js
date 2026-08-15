'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { computeLayout, distribute, even } = require('../src/layout');

const CANVAS = { width: 1920, height: 1080, gap: 4 };

function assertInsideCanvas(result) {
  for (const c of result.cells) {
    assert.ok(c.w > 0 && c.h > 0, `cell has positive size: ${JSON.stringify(c)}`);
    assert.ok(c.x >= 0 && c.y >= 0, `cell starts inside the canvas: ${JSON.stringify(c)}`);
    assert.ok(c.x + c.w <= result.width, `cell fits horizontally: ${JSON.stringify(c)} in ${result.width}`);
    assert.ok(c.y + c.h <= result.height, `cell fits vertically: ${JSON.stringify(c)} in ${result.height}`);
  }
}

function assertEvenDimensions(result) {
  for (const c of result.cells) {
    assert.strictEqual(c.w % 2, 0, `width is even: ${c.w}`);
    assert.strictEqual(c.h % 2, 0, `height is even: ${c.h}`);
    assert.strictEqual(c.x % 2, 0, `x is even: ${c.x}`);
    assert.strictEqual(c.y % 2, 0, `y is even: ${c.y}`);
  }
}

function assertNoOverlap(result) {
  const cells = result.cells;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i];
      const b = cells[j];
      const separated = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(separated, `cells ${i} and ${j} do not overlap: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  }
}

test('distribute fills the top rows first', () => {
  assert.deepStrictEqual(distribute(5, 2), [3, 2]);
  assert.deepStrictEqual(distribute(3, 2), [2, 1]);
  assert.deepStrictEqual(distribute(7, 3), [3, 2, 2]);
  assert.deepStrictEqual(distribute(6, 2), [3, 3]);
  assert.deepStrictEqual(distribute(1, 1), [1]);
});

test('even() rounds down and respects the floor', () => {
  assert.strictEqual(even(101), 100);
  assert.strictEqual(even(100), 100);
  assert.strictEqual(even(1), 2);
  assert.strictEqual(even(-5, 0), 0);
});

test('no sources produces no cells', () => {
  const r = computeLayout(0, { ...CANVAS, layout: 'auto' });
  assert.strictEqual(r.cells.length, 0);
});

test('a single source fills the whole canvas', () => {
  const r = computeLayout(1, { ...CANVAS, layout: 'auto' });
  assert.strictEqual(r.cells.length, 1);
  assert.deepStrictEqual(r.cells[0], { x: 0, y: 0, w: 1920, h: 1080 });
});

test('auto layout stays inside the canvas for 1..24 sources', () => {
  for (let n = 1; n <= 24; n++) {
    const r = computeLayout(n, { ...CANVAS, layout: 'auto' });
    assert.strictEqual(r.cells.length, n, `all ${n} sources are placed`);
    assertInsideCanvas(r);
    assertEvenDimensions(r);
    assertNoOverlap(r);
  }
});

test('auto layout picks sensible grids', () => {
  assert.strictEqual(computeLayout(2, { ...CANVAS, layout: 'auto' }).cols, 2);
  assert.strictEqual(computeLayout(4, { ...CANVAS, layout: 'auto' }).cols, 2);
  assert.strictEqual(computeLayout(9, { ...CANVAS, layout: 'auto' }).cols, 3);
  assert.strictEqual(computeLayout(16, { ...CANVAS, layout: 'auto' }).cols, 4);
});

test('three sources use two rows with the partial row centred', () => {
  const r = computeLayout(3, { ...CANVAS, layout: 'auto' });
  assert.strictEqual(r.cells.length, 3);
  const [a, b, c] = r.cells;
  assert.strictEqual(a.y, b.y, 'first two share a row');
  assert.ok(c.y > a.y, 'third is on the row below');
  const topCentre = (a.x + a.w + b.x) / 2;
  const bottomCentre = c.x + c.w / 2;
  assert.ok(Math.abs(topCentre - bottomCentre) <= 2, 'the lone cell is centred under the pair');
});

test('every cell in a uniform grid is the same size', () => {
  for (const n of [3, 5, 7, 8, 11]) {
    const r = computeLayout(n, { ...CANVAS, layout: 'auto' });
    const first = r.cells[0];
    for (const c of r.cells) {
      assert.strictEqual(c.w, first.w, `same width for ${n} sources`);
      assert.strictEqual(c.h, first.h, `same height for ${n} sources`);
    }
  }
});

test('fixed grids cap the number of placed sources', () => {
  const r = computeLayout(9, { ...CANVAS, layout: '2x2' });
  assert.strictEqual(r.cells.length, 4);
  assert.strictEqual(r.capacity, 4);
  assertNoOverlap(r);
  assertInsideCanvas(r);
});

test('fixed grids keep their shape when partly filled', () => {
  const r = computeLayout(2, { ...CANVAS, layout: '2x2' });
  assert.strictEqual(r.cells.length, 2);
  assert.strictEqual(r.cells[0].w, r.cells[1].w);
  assert.strictEqual(r.cells[0].y, r.cells[1].y, 'both are on the top row');
});

test('spotlight gives the first source the large cell', () => {
  const r = computeLayout(4, { ...CANVAS, layout: 'spotlight' });
  assert.strictEqual(r.cells.length, 4);
  const [main, ...side] = r.cells;
  for (const s of side) {
    assert.ok(main.w > s.w, 'the main cell is wider');
    assert.ok(main.h > s.h, 'the main cell is taller');
  }
  assertInsideCanvas(r);
  assertNoOverlap(r);
  assertEvenDimensions(r);
});

test('spotlight with one source is just a full-frame cell', () => {
  const r = computeLayout(1, { ...CANVAS, layout: 'spotlight' });
  assert.strictEqual(r.cells.length, 1);
  assertInsideCanvas(r);
});

test('row and column layouts behave', () => {
  const row = computeLayout(4, { ...CANVAS, layout: 'row' });
  assert.strictEqual(new Set(row.cells.map((c) => c.y)).size, 1, 'one row');
  const col = computeLayout(4, { ...CANVAS, layout: 'column' });
  assert.strictEqual(new Set(col.cells.map((c) => c.x)).size, 1, 'one column');
  assertInsideCanvas(row);
  assertInsideCanvas(col);
});

test('layouts survive unusual canvases', () => {
  for (const canvas of [
    { width: 1280, height: 720, gap: 0 },
    { width: 3840, height: 2160, gap: 16 },
    { width: 854, height: 480, gap: 2 },
    { width: 640, height: 360, gap: 8 },
  ]) {
    for (const layout of ['auto', 'spotlight', '3x3', 'row', 'column']) {
      for (const n of [1, 2, 5, 9]) {
        const r = computeLayout(n, { ...canvas, layout });
        assertInsideCanvas(r);
        assertEvenDimensions(r);
        assertNoOverlap(r);
      }
    }
  }
});
