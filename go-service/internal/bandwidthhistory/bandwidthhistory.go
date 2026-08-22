// Package bandwidthhistory tracks a long-horizon bandwidth trend, distinct
// from any short real-time sparkline. It tracks total inbound (ingest) and
// outbound (every read MediaMTX has served, from any path) bytes, sampled
// every fifteen minutes and kept for seven days — coarse on purpose, this
// is a capacity-planning trend, not a real-time monitor. Ported
// field-for-field from server/src/bandwidthHistory.js.
//
// "Outbound" is honestly labelled rather than narrowly accurate: MediaMTX
// does not distinguish a viewer's WHEP read from a restream destination
// pulling a source, so this is every read combined, not internet egress
// alone.
package bandwidthhistory

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
)

const (
	SampleInterval = 15 * time.Minute
	Retention      = 7 * 24 * time.Hour
)

type Point struct {
	At           time.Time `json:"at"`
	InboundKbps  int       `json:"inboundKbps"`
	OutboundKbps int       `json:"outboundKbps"`
}

type counters struct {
	at            time.Time
	inboundBytes  int64
	outboundBytes int64
}

// PathLister is the one MediaMTX capability Tracker needs — narrowed to an
// interface so it can be faked in tests without a real MediaMTX instance.
type PathLister interface {
	ListPaths(ctx context.Context) ([]mediamtx.Path, error)
}

// Tracker owns the sampled history and persists it to HistoryFile so it
// survives a restart, exactly like the Node version's own JSON file.
type Tracker struct {
	MediaMTX     PathLister
	IngestPrefix string
	HistoryFile  string // e.g. filepath.Join(dataDir, "bandwidth-history.json")
	Log          *slog.Logger

	mu      sync.Mutex
	history []Point
	last    *counters
}

func New(mtx PathLister, ingestPrefix, historyFile string, log *slog.Logger) *Tracker {
	if log == nil {
		log = slog.Default()
	}
	return &Tracker{MediaMTX: mtx, IngestPrefix: ingestPrefix, HistoryFile: historyFile, Log: log}
}

// Load reads any previously persisted history from disk. Safe to call once
// at boot; a missing or unreadable file just starts empty.
func (t *Tracker) Load() {
	data, err := os.ReadFile(t.HistoryFile)
	if err != nil {
		return
	}
	var points []Point
	if err := json.Unmarshal(data, &points); err != nil {
		return
	}
	t.mu.Lock()
	t.history = points
	t.prune()
	t.mu.Unlock()
}

// Get is a copy of the current history, oldest first — safe for a caller
// to hand straight to json.Marshal.
func (t *Tracker) Get() []Point {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]Point, len(t.history))
	copy(out, t.history)
	return out
}

// Start runs Sample immediately and then on every SampleInterval, until
// stop is closed.
func (t *Tracker) Start(ctx context.Context, stop <-chan struct{}) {
	t.Load()
	t.Sample(ctx)
	ticker := time.NewTicker(SampleInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			t.Sample(ctx)
		}
	}
}

// Sample takes one reading, computing a rate from the previous sample's
// counters, appends it to the history, prunes anything past Retention, and
// persists the result.
func (t *Tracker) Sample(ctx context.Context) {
	paths, err := t.MediaMTX.ListPaths(ctx)
	if err != nil {
		return
	}

	prefix := t.IngestPrefix + "/"
	var inboundBytes, outboundBytes int64
	for _, p := range paths {
		if len(p.Name) >= len(prefix) && p.Name[:len(prefix)] == prefix {
			inboundBytes += p.BytesReceived
		}
		outboundBytes += p.BytesSent
	}

	now := time.Now()
	point := Point{At: now}

	t.mu.Lock()
	defer t.mu.Unlock()

	// A counter going backwards means a publisher (or MediaMTX itself)
	// restarted since the last sample: record a zero rather than a
	// negative or a nonsense spike, and let the next sample re-establish
	// the baseline.
	if t.last != nil && inboundBytes >= t.last.inboundBytes && outboundBytes >= t.last.outboundBytes {
		seconds := now.Sub(t.last.at).Seconds()
		if seconds > 0 {
			point.InboundKbps = int((float64(inboundBytes-t.last.inboundBytes) * 8 / 1000 / seconds) + 0.5)
			point.OutboundKbps = int((float64(outboundBytes-t.last.outboundBytes) * 8 / 1000 / seconds) + 0.5)
		}
	}
	t.last = &counters{at: now, inboundBytes: inboundBytes, outboundBytes: outboundBytes}

	t.history = append(t.history, point)
	t.prune()
	t.persist()
}

// prune must be called with t.mu held.
func (t *Tracker) prune() {
	cutoff := time.Now().Add(-Retention)
	kept := t.history[:0]
	for _, p := range t.history {
		if !p.At.Before(cutoff) {
			kept = append(kept, p)
		}
	}
	t.history = kept
}

// persist must be called with t.mu held.
func (t *Tracker) persist() {
	if t.HistoryFile == "" {
		return
	}
	data, err := json.Marshal(t.history)
	if err != nil {
		t.Log.Warn("failed to persist bandwidth history", "error", err.Error())
		return
	}
	if err := os.MkdirAll(filepath.Dir(t.HistoryFile), 0o755); err != nil {
		t.Log.Warn("failed to persist bandwidth history", "error", err.Error())
		return
	}
	tmp := t.HistoryFile + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		t.Log.Warn("failed to persist bandwidth history", "error", err.Error())
		return
	}
	if err := os.Rename(tmp, t.HistoryFile); err != nil {
		t.Log.Warn("failed to persist bandwidth history", "error", err.Error())
	}
}
