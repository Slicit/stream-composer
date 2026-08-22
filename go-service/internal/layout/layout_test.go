package layout

import (
	"bufio"
	"encoding/json"
	"os"
	"testing"
)

// jsCase mirrors one line of testdata/js_cases.jsonl — captured by running
// the real server/src/layout.js's computeLayout() on the box (node
// available there) for a spread of counts/options, so this test proves the
// Go port matches the shipped Node behavior exactly rather than just
// matching itself.
type jsCase struct {
	Count int `json:"count"`
	Opts  struct {
		Width  int    `json:"width"`
		Height int    `json:"height"`
		Gap    *int   `json:"gap"`
		Layout string `json:"layout"`
	} `json:"opts"`
	Result struct {
		Cells []struct {
			X, Y, W, H int
		} `json:"cells"`
		Cols      int    `json:"cols"`
		Rows      int    `json:"rows"`
		Layout    string `json:"layout"`
		Capacity  int    `json:"capacity"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
		Spotlight bool   `json:"spotlight"`
	} `json:"result"`
}

func TestComputeMatchesTheNodeImplementation(t *testing.T) {
	f, err := os.Open("testdata/js_cases.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	n := 0
	for scanner.Scan() {
		var c jsCase
		if err := json.Unmarshal(scanner.Bytes(), &c); err != nil {
			t.Fatal(err)
		}
		n++

		gap := 4
		if c.Opts.Gap != nil {
			gap = *c.Opts.Gap
		}
		got := Compute(c.Count, Options{Width: c.Opts.Width, Height: c.Opts.Height, Gap: gap, Layout: c.Opts.Layout})

		if got.Layout != c.Result.Layout || got.Cols != c.Result.Cols || got.Rows != c.Result.Rows ||
			got.Capacity != c.Result.Capacity || got.Width != c.Result.Width || got.Height != c.Result.Height ||
			got.Spotlight != c.Result.Spotlight {
			t.Errorf("case %d (count=%d opts=%+v): metadata mismatch\ngot  %+v\nwant %+v", n, c.Count, c.Opts, got, c.Result)
			continue
		}
		if len(got.Cells) != len(c.Result.Cells) {
			t.Errorf("case %d: got %d cells, want %d", n, len(got.Cells), len(c.Result.Cells))
			continue
		}
		for i, cell := range got.Cells {
			want := c.Result.Cells[i]
			if cell.X != want.X || cell.Y != want.Y || cell.W != want.W || cell.H != want.H {
				t.Errorf("case %d cell %d: got %+v, want %+v", n, i, cell, want)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if n == 0 {
		t.Fatal("no cases loaded from testdata/js_cases.jsonl")
	}
}

func TestIsValidLayout(t *testing.T) {
	for _, id := range []string{"auto", "solo", "row", "column", "spotlight", "2x2", "4x4", "24x24"} {
		if !IsValidLayout(id) {
			t.Errorf("IsValidLayout(%q) = false, want true", id)
		}
	}
	for _, id := range []string{"", "bogus", "0x0", "25x25", "2x"} {
		if IsValidLayout(id) {
			t.Errorf("IsValidLayout(%q) = true, want false", id)
		}
	}
}
