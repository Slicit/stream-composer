package relayrunner

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/compositionscheduler"
	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

// fakeIngestLister lets a test declare exactly which keys are "live"
// without a real MediaMTX instance.
type fakeIngestLister struct {
	live map[string]bool
}

func (f *fakeIngestLister) ListIngest(context.Context) ([]mediamtx.IngestPath, error) {
	out := make([]mediamtx.IngestPath, 0, len(f.live))
	for k, ready := range f.live {
		out = append(out, mediamtx.IngestPath{Key: k, Ready: ready})
	}
	return out, nil
}

// fakeFFmpeg writes an executable shell script that ignores every argument
// buildArgs would give it (all ffmpeg-specific flags a shell would reject)
// and instead runs `body`, so process-lifecycle behavior (start, stop,
// clean/failing exit, backoff) can be exercised without a real ffmpeg
// binary or real media.
func fakeFFmpeg(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-ffmpeg.sh")
	script := "#!/bin/sh\n" + body + "\n"
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func testConfig(ffmpegPath string) config.Config {
	return config.Config{
		IngestPrefix:      "live",
		MediaMTX:          config.MediaMTX{RTSPHost: "mediamtx", RTSPPort: "8554"},
		FFmpegPath:        ffmpegPath,
		RestartDelayMs:    50,
		MaxRestartDelayMs: 200,
	}
}

func waitFor(t *testing.T, timeout time.Duration, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition never became true")
}

func TestTickDoesNotStartADisabledRelay(t *testing.T) {
	store := streamstore.NewMemory()
	stream := streamstore.Stream{ID: "s1", Key: "src-key", Enabled: true}
	relay := streamstore.Relay{ID: "r1", StreamID: "s1", Enabled: false, URL: "rtmp://example.test/live"}
	store.Replace([]streamstore.Stream{stream}, []streamstore.Relay{relay}, nil, nil, false, "", "")

	r := New(store, &fakeIngestLister{live: map[string]bool{"src-key": true}}, testConfig(fakeFFmpeg(t, "sleep 5")), silentLog(), nil)
	r.Tick(context.Background())

	if got := r.StatusOf("r1").State; got != "off" {
		t.Errorf("disabled relay should stay off, got %q", got)
	}
}

func TestTickWaitsWhenSourceIsNotLive(t *testing.T) {
	store := streamstore.NewMemory()
	stream := streamstore.Stream{ID: "s1", Key: "src-key", Enabled: true}
	relay := streamstore.Relay{ID: "r1", StreamID: "s1", Enabled: true, URL: "rtmp://example.test/live"}
	store.Replace([]streamstore.Stream{stream}, []streamstore.Relay{relay}, nil, nil, false, "", "")

	r := New(store, &fakeIngestLister{live: map[string]bool{}}, testConfig(fakeFFmpeg(t, "sleep 5")), silentLog(), nil)
	r.Tick(context.Background())

	if got := r.StatusOf("r1").State; got != "waiting" {
		t.Errorf("relay whose source is not live should be 'waiting', got %q", got)
	}
}

func TestTickStopsARelayWhoseSourceStreamIsGone(t *testing.T) {
	store := streamstore.NewMemory()
	// No matching stream for r1's StreamID at all.
	relay := streamstore.Relay{ID: "r1", StreamID: "missing", Enabled: true, URL: "rtmp://example.test/live"}
	store.Replace(nil, []streamstore.Relay{relay}, nil, nil, false, "", "")

	r := New(store, &fakeIngestLister{live: map[string]bool{}}, testConfig(fakeFFmpeg(t, "sleep 5")), silentLog(), nil)
	r.Tick(context.Background())

	if got := r.StatusOf("r1").State; got != "off" {
		t.Errorf("relay with no source stream should be off, got %q", got)
	}
}

func TestTickStartsAndStopsALiveRelay(t *testing.T) {
	store := streamstore.NewMemory()
	stream := streamstore.Stream{ID: "s1", Key: "src-key", Enabled: true}
	relay := streamstore.Relay{ID: "r1", StreamID: "s1", Enabled: true, URL: "rtmp://example.test/live", Audio: "copy"}
	store.Replace([]streamstore.Stream{stream}, []streamstore.Relay{relay}, nil, nil, false, "", "")

	lister := &fakeIngestLister{live: map[string]bool{"src-key": true}}
	r := New(store, lister, testConfig(fakeFFmpeg(t, "trap '' TERM; sleep 5")), silentLog(), nil)
	r.Tick(context.Background())

	waitFor(t, time.Second, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		_, running := r.running["r1"]
		return running
	})

	// The source stops publishing: the relay must be stopped, not backed off
	// (this is not a failure — see the comment in Tick()).
	lister.live = map[string]bool{}
	r.Tick(context.Background())

	waitFor(t, time.Second, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		_, running := r.running["r1"]
		return !running
	})
	if got := r.StatusOf("r1").State; got != "waiting" {
		t.Errorf("after the source stops, state should be 'waiting', got %q", got)
	}
}

func TestFailingFFmpegSchedulesABackoffThatGrows(t *testing.T) {
	store := streamstore.NewMemory()
	stream := streamstore.Stream{ID: "s1", Key: "src-key", Enabled: true}
	relay := streamstore.Relay{ID: "r1", StreamID: "s1", Enabled: true, URL: "rtmp://example.test/live"}
	store.Replace([]streamstore.Stream{stream}, []streamstore.Relay{relay}, nil, nil, false, "", "")

	r := New(store, &fakeIngestLister{live: map[string]bool{"src-key": true}}, testConfig(fakeFFmpeg(t, "exit 1")), silentLog(), nil)
	r.Tick(context.Background())

	waitFor(t, time.Second, func() bool {
		return r.StatusOf("r1").State == "retrying"
	})
	first := r.StatusOf("r1")
	if first.Restarts != 1 {
		t.Errorf("Restarts = %d, want 1", first.Restarts)
	}

	// Tick again before the backoff has elapsed: must not attempt to start again.
	r.Tick(context.Background())
	r.mu.Lock()
	_, running := r.running["r1"]
	r.mu.Unlock()
	if running {
		t.Error("a relay still inside its backoff window must not be restarted")
	}

	// Wait past the (short, test-configured) backoff and tick again — this
	// time it retries and fails again, and the delay must have grown.
	time.Sleep(80 * time.Millisecond)
	r.Tick(context.Background())
	waitFor(t, time.Second, func() bool {
		return r.StatusOf("r1").Restarts >= 2
	})
	second := r.StatusOf("r1")
	if !second.RetryAt.After(first.RetryAt) {
		t.Error("the retry delay should grow between consecutive failures")
	}
}

func TestTickStartsAChannelCompositionRelayFromTheComposedPath(t *testing.T) {
	store := streamstore.NewMemory()
	channel := streamstore.Channel{ID: "chan-1", StreamIDs: []string{"s1"}}
	stream := streamstore.Stream{ID: "s1", Key: "cam-1", Enabled: true}
	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	relay := streamstore.Relay{ID: "r1", ChannelCompositionID: "comp-1", Enabled: true, URL: "rtmp://example.test/live"}
	store.Replace([]streamstore.Stream{stream}, []streamstore.Relay{relay}, []streamstore.Channel{channel}, []streamstore.ChannelComposition{comp}, false, "", "")

	cfg := testConfig(fakeFFmpeg(t, "trap '' TERM; sleep 5"))
	cfg.ComposedPrefix = "composed"
	lister := &fakeIngestLister{live: map[string]bool{"cam-1": true}}
	gens := compositionscheduler.NewGenerations()
	// A live member alone isn't enough to relay — the compositor also has
	// to have actually gone live for this composition, which is what
	// Generations reflects.
	gens.Set("chan-1", "horizontal", "composed/chan-1/horizontal/g7", "7")
	r := New(store, lister, cfg, silentLog(), gens)
	r.Tick(context.Background())

	waitFor(t, time.Second, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		_, running := r.running["r1"]
		return running
	})
	r.mu.Lock()
	args := strings.Join(r.running["r1"].cmd.Args, " ")
	r.mu.Unlock()
	if !strings.Contains(args, "rtsp://mediamtx:8554/composed/chan-1/horizontal/g7") {
		t.Errorf("expected the current generation's composed path as the actual ffmpeg source, got: %s", args)
	}
}

func TestTickWaitsWhenAChannelCompositionHasNoLiveGenerationYet(t *testing.T) {
	store := streamstore.NewMemory()
	channel := streamstore.Channel{ID: "chan-1", StreamIDs: []string{"s1"}}
	stream := streamstore.Stream{ID: "s1", Key: "cam-1", Enabled: true}
	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	relay := streamstore.Relay{ID: "r1", ChannelCompositionID: "comp-1", Enabled: true, URL: "rtmp://example.test/live"}
	store.Replace([]streamstore.Stream{stream}, []streamstore.Relay{relay}, []streamstore.Channel{channel}, []streamstore.ChannelComposition{comp}, false, "", "")

	// A live member, but nothing registered in Generations yet — the
	// compositor hasn't actually gone live for this composition (e.g.
	// it's still warming up its first generation), so there's nothing
	// real to relay from yet.
	r := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(fakeFFmpeg(t, "sleep 5")), silentLog(), compositionscheduler.NewGenerations())
	r.Tick(context.Background())

	if got := r.StatusOf("r1").State; got != "waiting" {
		t.Errorf("a composition relay with no live generation yet should be 'waiting', got %q", got)
	}
}

func TestTickWaitsWhenAChannelCompositionHasNoLiveMember(t *testing.T) {
	store := streamstore.NewMemory()
	channel := streamstore.Channel{ID: "chan-1", StreamIDs: []string{"s1"}}
	stream := streamstore.Stream{ID: "s1", Key: "cam-1", Enabled: true}
	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	relay := streamstore.Relay{ID: "r1", ChannelCompositionID: "comp-1", Enabled: true, URL: "rtmp://example.test/live"}
	store.Replace([]streamstore.Stream{stream}, []streamstore.Relay{relay}, []streamstore.Channel{channel}, []streamstore.ChannelComposition{comp}, false, "", "")

	cfg := testConfig(fakeFFmpeg(t, "sleep 5"))
	r := New(store, &fakeIngestLister{live: map[string]bool{}}, cfg, silentLog(), nil)
	r.Tick(context.Background())

	if got := r.StatusOf("r1").State; got != "waiting" {
		t.Errorf("a composition relay with no live channel member should be 'waiting', got %q", got)
	}
}

func TestTickStopsAChannelCompositionRelayWhenTheCompositionIsDisabled(t *testing.T) {
	store := streamstore.NewMemory()
	channel := streamstore.Channel{ID: "chan-1", StreamIDs: []string{"s1"}}
	stream := streamstore.Stream{ID: "s1", Key: "cam-1", Enabled: true}
	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: false}
	relay := streamstore.Relay{ID: "r1", ChannelCompositionID: "comp-1", Enabled: true, URL: "rtmp://example.test/live"}
	store.Replace([]streamstore.Stream{stream}, []streamstore.Relay{relay}, []streamstore.Channel{channel}, []streamstore.ChannelComposition{comp}, false, "", "")

	r := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(fakeFFmpeg(t, "sleep 5")), silentLog(), nil)
	r.Tick(context.Background())

	if got := r.StatusOf("r1").State; got != "off" {
		t.Errorf("a relay for a disabled composition should be off, got %q", got)
	}
}

func silentLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
