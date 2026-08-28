package layout

import "testing"

// These mirror react-app/src/lib/clientLayout.test.ts's own bestGrid
// coverage exactly (same shapes, same expectations) — ComputeForCanvas is
// a direct port of that algorithm, so it should make the same choices.

func TestComputeForCanvasStacksAPortraitCanvasInsteadOfALeftoverRow(t *testing.T) {
	// Narrow and tall — e.g. a vertical composition's own 1080x1920 canvas.
	r := ComputeForCanvas(2, Options{Width: 700, Height: 1400, Gap: 4})
	if len(r.Cells) != 2 {
		t.Fatalf("expected 2 cells, got %d", len(r.Cells))
	}
	if r.Cells[0].X != r.Cells[1].X {
		t.Errorf("expected both cells to share an X (stacked), got %d and %d", r.Cells[0].X, r.Cells[1].X)
	}
	if !(r.Cells[0].Y < r.Cells[1].Y) {
		t.Errorf("expected the second cell below the first, got Y=%d then Y=%d", r.Cells[0].Y, r.Cells[1].Y)
	}
	if r.Cells[0].W <= 600 {
		t.Errorf("expected a near-full-width cell when stacked, got W=%d", r.Cells[0].W)
	}
}

func TestComputeForCanvasKeepsALandscapeCanvasSideBySide(t *testing.T) {
	r := ComputeForCanvas(2, Options{Width: 1920, Height: 1080, Gap: 4})
	if len(r.Cells) != 2 {
		t.Fatalf("expected 2 cells, got %d", len(r.Cells))
	}
	if r.Cells[0].Y != r.Cells[1].Y {
		t.Errorf("expected both cells to share a Y (side by side), got %d and %d", r.Cells[0].Y, r.Cells[1].Y)
	}
	if !(r.Cells[0].X < r.Cells[1].X) {
		t.Errorf("expected the second cell to the right of the first")
	}
}

func TestComputeForCanvasPicksTheLeastWastedGridNotAFixedSqrtGuess(t *testing.T) {
	// 3 sources on a very wide, short canvas: a naive ceil(sqrt(3))=2
	// columns grid would need 2 rows (half the canvas height each), when a
	// single row of 3 already fits and uses the width far better.
	r := ComputeForCanvas(3, Options{Width: 3000, Height: 500, Gap: 4})
	if len(r.Cells) != 3 {
		t.Fatalf("expected 3 cells, got %d", len(r.Cells))
	}
	y := r.Cells[0].Y
	for _, c := range r.Cells {
		if c.Y != y {
			t.Errorf("expected all 3 cells on one row, got Y values %d and %d", y, c.Y)
		}
	}
}

func TestComputeForCanvasSingleSourceFillsTheWholeCanvas(t *testing.T) {
	r := ComputeForCanvas(1, Options{Width: 1080, Height: 1920, Gap: 4})
	if len(r.Cells) != 1 {
		t.Fatalf("expected 1 cell, got %d", len(r.Cells))
	}
	if r.Cells[0].W != 1080 || r.Cells[0].H != 1920 {
		t.Errorf("expected the single cell to fill the full canvas, got %+v", r.Cells[0])
	}
}

func TestComputeForCanvasZeroSourcesReturnsNoCells(t *testing.T) {
	r := ComputeForCanvas(0, Options{Width: 1080, Height: 1920})
	if len(r.Cells) != 0 {
		t.Errorf("expected no cells for 0 sources, got %d", len(r.Cells))
	}
}

func TestComputeForCanvasDefaultsAnUnsetCanvasTo1920x1080(t *testing.T) {
	r := ComputeForCanvas(1, Options{})
	if r.Width != 1920 || r.Height != 1080 {
		t.Errorf("expected the 1920x1080 default, got %dx%d", r.Width, r.Height)
	}
}
