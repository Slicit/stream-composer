package bandwidthhistory

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
)

type fakeLister struct {
	paths []mediamtx.Path
}

func (f *fakeLister) ListPaths(context.Context) ([]mediamtx.Path, error) {
	return f.paths, nil
}

func TestSampleRecordsZeroOnTheFirstReading(t *testing.T) {
	lister := &fakeLister{paths: []mediamtx.Path{{Name: "live/a", BytesReceived: 1000}}}
	tr := New(lister, "live", "", nil)

	tr.Sample(context.Background())

	points := tr.Get()
	if len(points) != 1 {
		t.Fatalf("got %d points, want 1", len(points))
	}
	if points[0].InboundKbps != 0 || points[0].OutboundKbps != 0 {
		t.Errorf("first sample has no baseline yet, should be zero, got %+v", points[0])
	}
}

func TestSampleComputesARateFromTheSecondReadingOnward(t *testing.T) {
	lister := &fakeLister{paths: []mediamtx.Path{{Name: "live/a", BytesReceived: 0, BytesSent: 0}}}
	tr := New(lister, "live", "", nil)
	tr.Sample(context.Background())

	// Simulate a second sample one second later with 125000 bytes received
	// (1,000,000 bits = 1000 kbit in 1 second = 1000 kbps).
	tr.mu.Lock()
	tr.last.at = time.Now().Add(-1 * time.Second)
	tr.mu.Unlock()
	lister.paths = []mediamtx.Path{{Name: "live/a", BytesReceived: 125000, BytesSent: 0}}
	tr.Sample(context.Background())

	points := tr.Get()
	if len(points) != 2 {
		t.Fatalf("got %d points, want 2", len(points))
	}
	if points[1].InboundKbps < 900 || points[1].InboundKbps > 1100 {
		t.Errorf("InboundKbps = %d, want roughly 1000", points[1].InboundKbps)
	}
}

func TestSampleOnlyCountsInboundUnderTheIngestPrefix(t *testing.T) {
	lister := &fakeLister{paths: []mediamtx.Path{
		{Name: "live/a", BytesReceived: 1000, BytesSent: 500},
		{Name: "program", BytesReceived: 999999, BytesSent: 200}, // not under the ingest prefix
	}}
	tr := New(lister, "live", "", nil)
	tr.Sample(context.Background())
	tr.mu.Lock()
	tr.last.at = time.Now().Add(-1 * time.Second)
	inboundBefore := tr.last.inboundBytes
	outboundBefore := tr.last.outboundBytes
	tr.mu.Unlock()

	if inboundBefore != 1000 {
		t.Errorf("inbound baseline should only include live/a's bytes, got %d", inboundBefore)
	}
	if outboundBefore != 700 {
		t.Errorf("outbound baseline should sum every path regardless of prefix, got %d", outboundBefore)
	}
}

func TestSampleResetsBaselineWhenACounterGoesBackwards(t *testing.T) {
	lister := &fakeLister{paths: []mediamtx.Path{{Name: "live/a", BytesReceived: 100000}}}
	tr := New(lister, "live", "", nil)
	tr.Sample(context.Background())
	tr.mu.Lock()
	tr.last.at = time.Now().Add(-1 * time.Second)
	tr.mu.Unlock()

	// A restarted publisher: the counter goes back to near zero.
	lister.paths = []mediamtx.Path{{Name: "live/a", BytesReceived: 500}}
	tr.Sample(context.Background())

	points := tr.Get()
	last := points[len(points)-1]
	if last.InboundKbps != 0 {
		t.Errorf("a backwards counter should record zero, not a negative/nonsense rate, got %d", last.InboundKbps)
	}
}

func TestPruneDropsPointsOlderThanRetention(t *testing.T) {
	tr := New(&fakeLister{}, "live", "", nil)
	tr.mu.Lock()
	tr.history = []Point{
		{At: time.Now().Add(-8 * 24 * time.Hour)}, // past retention
		{At: time.Now().Add(-1 * time.Hour)},      // within retention
	}
	tr.prune()
	tr.mu.Unlock()

	points := tr.Get()
	if len(points) != 1 {
		t.Fatalf("got %d points after prune, want 1", len(points))
	}
}

func TestLoadAndPersistRoundTrip(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "bandwidth-history.json")

	tr := New(&fakeLister{paths: []mediamtx.Path{{Name: "live/a", BytesReceived: 1000}}}, "live", file, nil)
	tr.Sample(context.Background())

	if _, err := os.Stat(file); err != nil {
		t.Fatalf("expected the history file to be written: %v", err)
	}

	tr2 := New(&fakeLister{}, "live", file, nil)
	tr2.Load()
	if len(tr2.Get()) != 1 {
		t.Fatalf("Load should have picked up the persisted point, got %d points", len(tr2.Get()))
	}
}
