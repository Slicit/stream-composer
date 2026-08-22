// Package layout turns "N live streams" into concrete pixel rectangles on
// the output canvas. Everything downstream (the ffmpeg filtergraph, the
// browser-composed grid) is generated from these rectangles, so the layout
// rules live in exactly one place for both. Ported field-for-field from
// server/src/layout.js.
//
// All rectangles are clamped to even pixel values because H.264 chroma
// subsampling requires even dimensions.
package layout

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

type Rect struct {
	X, Y, W, H int
}

type Result struct {
	Cells     []Rect
	Cols      int
	Rows      int
	Layout    string
	Capacity  int
	Width     int
	Height    int
	Spotlight bool
}

type Options struct {
	Width  int
	Height int
	Gap    int
	Layout string
}

// even rounds down to the nearest even number, never below min.
func even(n float64, min int) int {
	v := int(math.Floor(n/2)) * 2
	if v < min {
		return min
	}
	return v
}

// clampToCanvas keeps a rectangle inside the canvas. Cell sizes bottom out
// at 2px but the running offset does not, so a large gutter with many rows
// could otherwise place cells past the edge, where they simply vanish with
// no error.
func clampToCanvas(cell Rect, width, height int) Rect {
	w := cell.W
	if w > width {
		w = width
	}
	h := cell.H
	if h > height {
		h = height
	}
	x := cell.X
	if x > width-w {
		x = width - w
	}
	if x < 0 {
		x = 0
	}
	y := cell.Y
	if y > height-h {
		y = height - h
	}
	if y < 0 {
		y = 0
	}
	return Rect{X: even(float64(x), 0), Y: even(float64(y), 0), W: w, H: h}
}

// distribute splits count items across rows rows, filling the top rows
// first. 5 items over 2 rows -> [3, 2]; 7 over 3 -> [3, 2, 2].
func distribute(count, rows int) []int {
	base := count / rows
	extra := count % rows
	out := make([]int, rows)
	for i := range out {
		out[i] = base
		if i < extra {
			out[i]++
		}
	}
	return out
}

// gridCells lays out a uniform grid: every cell is the same size, partial
// rows are centred. When fill is set, the cells of a partial row stretch to
// use the width.
func gridCells(count int, opts Options, cols, rows int, fill bool) Result {
	perRow := distribute(count, rows)
	maxPerRow := 0
	for _, n := range perRow {
		if n > maxPerRow {
			maxPerRow = n
		}
	}
	width, height, gap := opts.Width, opts.Height, opts.Gap
	cellW := even(float64(width-gap*(maxPerRow+1))/float64(maxPerRow), 2)
	cellH := even(float64(height-gap*(rows+1))/float64(rows), 2)

	gridH := cellH*rows + gap*(rows+1)
	offsetY := even(float64(height-gridH)/2, 0)

	var cells []Rect
	y := gap + offsetY
	for _, inRow := range perRow {
		w := cellW
		if fill {
			w = even(float64(width-gap*(inRow+1))/float64(inRow), 2)
		}
		rowW := w*inRow + gap*(inRow-1)
		x := even(float64(width-rowW)/2, 0)
		for i := 0; i < inRow; i++ {
			cells = append(cells, clampToCanvas(Rect{X: x, Y: y, W: w, H: cellH}, width, height))
			x += w + gap
		}
		y += cellH + gap
	}
	return Result{Cells: cells, Cols: cols, Rows: rows}
}

// spotlightCells places one large cell plus a stack of smaller ones down
// the right-hand side.
func spotlightCells(count int, opts Options) Result {
	width, height, gap := opts.Width, opts.Height, opts.Gap
	if count == 1 {
		return Result{
			Cells: []Rect{{X: gap, Y: gap, W: even(float64(width-gap*2), 2), H: even(float64(height-gap*2), 2)}},
			Cols:  1, Rows: 1,
		}
	}
	sideCount := count - 1
	sideW := even(math.Max(float64(width)*0.22, 220), 2)
	mainW := even(float64(width-sideW-gap*3), 2)
	mainH := even(float64(height-gap*2), 2)
	sideH := even(float64(height-gap*(sideCount+1))/float64(sideCount), 2)

	cells := []Rect{clampToCanvas(Rect{X: gap, Y: gap, W: mainW, H: mainH}, width, height)}
	y := gap
	for i := 0; i < sideCount; i++ {
		cells = append(cells, clampToCanvas(Rect{X: gap*2 + mainW, Y: y, W: sideW, H: sideH}, width, height))
		y += sideH + gap
	}
	return Result{Cells: cells, Cols: 2, Rows: sideCount, Spotlight: true}
}

// fixedPattern is bounded on purpose: an unbounded digit run would need
// guarding against overflow turning into a filtergraph ffmpeg cannot
// configure, leaving the encoder in a permanent restart loop.
var fixedPattern = regexp.MustCompile(`^([1-9]|1[0-9]|2[0-4])x([1-9]|1[0-9]|2[0-4])$`)

// Compute turns count sources into a Result. Ported field-for-field from
// computeLayout() in layout.js.
func Compute(count int, opts Options) Result {
	width := even(float64(nonZero(opts.Width, 1920)), 2)
	height := even(float64(nonZero(opts.Height, 1080)), 2)
	gap := opts.Gap
	if gap < 0 {
		gap = 0
	}
	layoutName := strings.ToLower(opts.Layout)
	if layoutName == "" {
		layoutName = "auto"
	}
	o := Options{Width: width, Height: height, Gap: gap, Layout: layoutName}

	if count <= 0 {
		return Result{Layout: layoutName, Width: width, Height: height}
	}

	full := Rect{X: 0, Y: 0, W: width, H: height}

	if count == 1 && (layoutName == "auto" || layoutName == "solo") {
		return Result{Cells: []Rect{full}, Cols: 1, Rows: 1, Layout: layoutName, Capacity: 1, Width: width, Height: height}
	}
	if layoutName == "solo" {
		return Result{Cells: []Rect{full}, Cols: 1, Rows: 1, Layout: layoutName, Capacity: 1, Width: width, Height: height}
	}
	if layoutName == "spotlight" {
		r := spotlightCells(count, o)
		r.Layout, r.Capacity, r.Width, r.Height = layoutName, count, width, height
		return r
	}
	if layoutName == "row" {
		r := gridCells(count, o, count, 1, false)
		r.Layout, r.Capacity, r.Width, r.Height = layoutName, count, width, height
		return r
	}
	if layoutName == "column" {
		r := gridCells(count, o, 1, count, false)
		r.Layout, r.Capacity, r.Width, r.Height = layoutName, count, width, height
		return r
	}

	if m := fixedPattern.FindStringSubmatch(layoutName); m != nil {
		cols := atoiAtLeast(m[1], 1)
		rows := atoiAtLeast(m[2], 1)
		capacity := cols * rows
		used := count
		if used > capacity {
			used = capacity
		}
		cellW := even(float64(width-gap*(cols+1))/float64(cols), 2)
		cellH := even(float64(height-gap*(rows+1))/float64(rows), 2)
		cells := make([]Rect, 0, used)
		for i := 0; i < used; i++ {
			r, c := i/cols, i%cols
			cells = append(cells, clampToCanvas(Rect{
				X: gap + c*(cellW+gap), Y: gap + r*(cellH+gap), W: cellW, H: cellH,
			}, width, height))
		}
		return Result{Cells: cells, Cols: cols, Rows: rows, Layout: layoutName, Capacity: capacity, Width: width, Height: height}
	}

	// auto
	cols := int(math.Ceil(math.Sqrt(float64(count))))
	rows := int(math.Ceil(float64(count) / float64(cols)))
	r := gridCells(count, o, cols, rows, false)
	r.Layout, r.Capacity, r.Width, r.Height = "auto", count, width, height
	return r
}

func nonZero(v, def int) int {
	if v == 0 {
		return def
	}
	return v
}

func atoiAtLeast(s string, min int) int {
	n, _ := strconv.Atoi(s)
	if n < min {
		return min
	}
	return n
}

type LayoutOption struct {
	ID    string
	Label string
	Hint  string
}

var Layouts = []LayoutOption{
	{"auto", "Auto grid", "Balances rows and columns for however many streams are live"},
	{"solo", "Single", "Shows only the first stream, full frame"},
	{"row", "Single row", "All streams side by side"},
	{"column", "Single column", "All streams stacked"},
	{"spotlight", "Spotlight", "One large stream with the rest down the side"},
	{"2x1", "2 x 1", "Fixed two-up"},
	{"2x2", "2 x 2", "Fixed quad"},
	{"3x3", "3 x 3", "Fixed nine-up"},
	{"4x4", "4 x 4", "Fixed sixteen-up"},
}

func IsValidLayout(id string) bool {
	for _, l := range Layouts {
		if l.ID == id {
			return true
		}
	}
	return fixedPattern.MatchString(id)
}
