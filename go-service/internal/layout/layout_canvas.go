package layout

import "math"

// sourceAspect assumes a source is roughly 16:9 — used only to score
// candidate grid shapes (how much of a cell a source would actually fill,
// never to distort the cell itself), same assumption and same purpose as
// react-app/src/lib/clientLayout.ts's bestGrid, which this file ports.
const sourceAspect = 16.0 / 9.0

// bestGridForCanvas picks cols/rows for an arbitrary target canvas
// (portrait included) by trying every (cols, rows) that fits count cells
// with no wasted full row, and keeping whichever gives the largest picture
// once a ~16:9 source fills its cell — the grid a source ends up biggest
// and least-letterboxed in, not Compute's fixed ceil(sqrt(count)) guess,
// which only ever suits a landscape canvas (on a canvas actually taller
// than it is wide, that guess can leave a 2-across grid mostly empty where
// a single column would fill the space). Ported from clientLayout.ts's
// bestGrid — deliberately not shared with Compute's own "auto" case, which
// is a golden-master port of layout.js pinned to match it exactly (see
// layout_test.go); this is a new, unconstrained algorithm with no such
// requirement.
func bestGridForCanvas(count, width, height int) (cols, rows int) {
	bestCols, bestRows, bestArea := count, 1, -1.0
	for c := 1; c <= count; c++ {
		r := (count + c - 1) / c // ceil(count/c)
		// A full row would go unused with fewer columns — skip it, it can
		// only ever be a worse packing of the same count.
		if c > 1 && (c-1)*r >= count {
			continue
		}
		cellW := float64(width) / float64(c)
		cellH := float64(height) / float64(r)
		pictureW := math.Min(cellW, cellH*sourceAspect)
		pictureH := pictureW / sourceAspect
		area := pictureW * pictureH
		// >=, not >: on an exact tie (e.g. 2 items on a plain 16:9 canvas —
		// stacked and side-by-side both crop identically), prefer the
		// later, wider candidate. Columns are tried ascending, so this
		// favours the more landscape-leaning of two equally-good options.
		if area >= bestArea {
			bestCols, bestRows, bestArea = c, r, area
		}
	}
	return bestCols, bestRows
}

// ComputeForCanvas is Compute's "auto" case generalized to an arbitrary
// target canvas aspect ratio (portrait included) via bestGridForCanvas —
// used for a "vertical" ChannelComposition, where Compute's landscape-only
// guess would pack badly. Horizontal keeps using Compute, unchanged; see
// each function's own doc comment for why they stay separate.
func ComputeForCanvas(count int, opts Options) Result {
	width := even(float64(nonZero(opts.Width, 1920)), 2)
	height := even(float64(nonZero(opts.Height, 1080)), 2)
	gap := opts.Gap
	if gap < 0 {
		gap = 0
	}
	o := Options{Width: width, Height: height, Gap: gap, Layout: "auto"}

	if count <= 0 {
		return Result{Layout: "auto", Width: width, Height: height}
	}
	if count == 1 {
		return Result{Cells: []Rect{{X: 0, Y: 0, W: width, H: height}}, Cols: 1, Rows: 1, Layout: "auto", Capacity: 1, Width: width, Height: height}
	}

	cols, rows := bestGridForCanvas(count, width, height)
	r := gridCells(count, o, cols, rows, false)
	r.Layout, r.Capacity, r.Width, r.Height = "auto", count, width, height
	return r
}
