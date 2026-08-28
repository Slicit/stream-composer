package compositionscheduler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

func silentLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError + 1}))
}

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

// fakeCompositor records every /jobs request it receives, standing in for
// the real compositor service.
type fakeCompositor struct {
	mu      sync.Mutex
	starts  []startJobRequest
	deletes []string
}

func (f *fakeCompositor) server() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/jobs":
			var req startJobRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			f.starts = append(f.starts, req)
			w.WriteHeader(http.StatusAccepted)
		case r.Method == http.MethodDelete:
			f.deletes = append(f.deletes, r.URL.Path[len("/jobs/"):])
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func (f *fakeCompositor) startCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.starts)
}

func (f *fakeCompositor) deleteCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.deletes)
}

func testStore(comp streamstore.ChannelComposition, destinationEnabled bool) *streamstore.Memory {
	store := streamstore.NewMemory()
	channel := streamstore.Channel{ID: "chan-1", StreamIDs: []string{"s1", "s2"}}
	stream1 := streamstore.Stream{ID: "s1", Key: "cam-1", Enabled: true, Name: "Cam One"}
	stream2 := streamstore.Stream{ID: "s2", Key: "cam-2", Enabled: true, Name: "Cam Two"}
	relay := streamstore.Relay{ID: "r1", ChannelCompositionID: comp.ID, Enabled: destinationEnabled, URL: "rtmp://example.test/live"}
	store.Replace([]streamstore.Stream{stream1, stream2}, []streamstore.Relay{relay}, []streamstore.Channel{channel}, []streamstore.ChannelComposition{comp}, false, "", "")
	return store
}

func testConfig(compositorAPI string) config.Config {
	return config.Config{IngestPrefix: "live", ComposedPrefix: "composed", CompositorAPI: compositorAPI}
}

func TestTickStartsAnEnabledCompositionWithALiveMemberAndAnEnabledDestination(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true, Width: 1920, Height: 1080}
	store := testStore(comp, true)
	s := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(srv.URL), silentLog())
	s.Tick(context.Background())

	if got := fc.startCount(); got != 1 {
		t.Fatalf("expected 1 start request, got %d", got)
	}
	fc.mu.Lock()
	req := fc.starts[0]
	fc.mu.Unlock()
	if req.ID != "chan-1/horizontal" {
		t.Errorf("job id = %q, want chan-1/horizontal", req.ID)
	}
	if req.Options.OutputPath != "composed/chan-1/horizontal" {
		t.Errorf("outputPath = %q, want composed/chan-1/horizontal", req.Options.OutputPath)
	}
	if req.Options.Orientation != "horizontal" {
		t.Errorf("orientation = %q, want horizontal — the compositor needs this to pick the right grid algorithm", req.Options.Orientation)
	}
	if len(req.Sources) != 1 || req.Sources[0].Path != "live/cam-1" {
		t.Errorf("expected only the live member as a source, got: %+v", req.Sources)
	}
}

func TestTickDoesNotStartADisabledComposition(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: false}
	store := testStore(comp, true)
	s := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(srv.URL), silentLog())
	s.Tick(context.Background())

	if got := fc.startCount(); got != 0 {
		t.Errorf("expected no start request for a disabled composition, got %d", got)
	}
}

func TestTickDoesNotStartWithNoLiveMember(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp, true)
	s := New(store, &fakeIngestLister{live: map[string]bool{}}, testConfig(srv.URL), silentLog())
	s.Tick(context.Background())

	if got := fc.startCount(); got != 0 {
		t.Errorf("expected no start request with no live member, got %d", got)
	}
}

func TestTickDoesNotStartWithNoEnabledDestination(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp, false) // destination disabled
	s := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(srv.URL), silentLog())
	s.Tick(context.Background())

	if got := fc.startCount(); got != 0 {
		t.Errorf("expected no start request with no enabled destination, got %d", got)
	}
}

func TestTickDoesNotRestartAnUnchangedJob(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp, true)
	s := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(srv.URL), silentLog())

	s.Tick(context.Background())
	s.Tick(context.Background())
	s.Tick(context.Background())

	if got := fc.startCount(); got != 1 {
		t.Errorf("expected exactly 1 start request across 3 identical ticks, got %d", got)
	}
}

func TestTickRestartsWhenTheLiveSourceSetChanges(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp, true)
	lister := &fakeIngestLister{live: map[string]bool{"cam-1": true}}
	s := New(store, lister, testConfig(srv.URL), silentLog())

	s.Tick(context.Background())
	lister.live["cam-2"] = true // a second source joins
	s.Tick(context.Background())

	if got := fc.startCount(); got != 2 {
		t.Errorf("expected a second start request when the source set changed, got %d", got)
	}
}

func TestTickStopsAJobThatIsNoLongerWanted(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp, true)
	lister := &fakeIngestLister{live: map[string]bool{"cam-1": true}}
	s := New(store, lister, testConfig(srv.URL), silentLog())

	s.Tick(context.Background())
	lister.live = map[string]bool{} // the only member stops publishing
	s.Tick(context.Background())

	if got := fc.deleteCount(); got != 1 {
		t.Fatalf("expected 1 delete request, got %d", got)
	}
	fc.mu.Lock()
	id := fc.deletes[0]
	fc.mu.Unlock()
	if id != "chan-1/horizontal" {
		t.Errorf("deleted job id = %q, want chan-1/horizontal", id)
	}
}

// A quick, real end-to-end sanity check that Start's ticker actually fires
// Tick on the given interval.
func TestStartTicksUntilStopped(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp, true)
	s := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(srv.URL), silentLog())

	stop := make(chan struct{})
	go s.Start(context.Background(), 10*time.Millisecond, stop)
	time.Sleep(50 * time.Millisecond)
	close(stop)

	if got := fc.startCount(); got != 1 {
		t.Errorf("expected exactly 1 start request even across several ticks (signature unchanged), got %d", got)
	}
}
