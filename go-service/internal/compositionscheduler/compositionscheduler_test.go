package compositionscheduler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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
// the real compositor service. A started job reports "live" immediately
// unless held(id) is called — held jobs report "starting" until released,
// for tests that need to control exactly when a warm-up is seen to finish.
type fakeCompositor struct {
	mu      sync.Mutex
	starts  []startJobRequest
	deletes []string
	held    map[string]bool
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
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/jobs/"):
			id := r.URL.Path[len("/jobs/"):]
			state := "live"
			if f.held[id] {
				state = "starting"
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(jobStatusResponse{State: state})
		case r.Method == http.MethodDelete:
			f.deletes = append(f.deletes, r.URL.Path[len("/jobs/"):])
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func (f *fakeCompositor) hold(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.held == nil {
		f.held = make(map[string]bool)
	}
	f.held[id] = true
}

func (f *fakeCompositor) release(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.held, id)
}

func (f *fakeCompositor) startCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.starts)
}

func (f *fakeCompositor) startIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	ids := make([]string, len(f.starts))
	for i, s := range f.starts {
		ids[i] = s.ID
	}
	return ids
}

func (f *fakeCompositor) deleteCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.deletes)
}

func (f *fakeCompositor) deletedIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.deletes))
	copy(out, f.deletes)
	return out
}

func testStore(comp streamstore.ChannelComposition) *streamstore.Memory {
	store := streamstore.NewMemory()
	channel := streamstore.Channel{ID: "chan-1", StreamIDs: []string{"s1", "s2"}}
	stream1 := streamstore.Stream{ID: "s1", Key: "cam-1", Enabled: true, Name: "Cam One"}
	stream2 := streamstore.Stream{ID: "s2", Key: "cam-2", Enabled: true, Name: "Cam Two"}
	store.Replace([]streamstore.Stream{stream1, stream2}, nil, []streamstore.Channel{channel}, []streamstore.ChannelComposition{comp}, false, "", "")
	return store
}

// testConfig uses millisecond-scale debounce/drain windows — tiny real
// sleeps in a test are enough to cross them, instead of the multi-second
// production defaults.
func testConfig(compositorAPI string) config.Config {
	return config.Config{
		IngestPrefix: "live", ComposedPrefix: "composed", CompositorAPI: compositorAPI,
		CompositionStabilizeMs:    1,
		CompositionMaxStabilizeMs: 30,
		CompositionDrainMs:        1,
	}
}

// settle ticks s repeatedly (with tiny real sleeps, so the debounce window
// actually elapses) until channelID/orientation is live in gens, or fails
// the test after a bounded number of attempts — the debounce-then-warm-up-
// then-confirm-live sequence now always takes more than one Tick.
func settle(t *testing.T, s *Scheduler, gens *Generations, channelID, orientation string) {
	t.Helper()
	for i := 0; i < 20; i++ {
		s.Tick(context.Background())
		if _, _, ok := gens.Current(channelID, orientation); ok {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("%s/%s never went live", channelID, orientation)
}

func TestTickStartsAnEnabledCompositionWithALiveMember(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true, Width: 1920, Height: 1080}
	store := testStore(comp)
	gens := NewGenerations()
	s := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(srv.URL), silentLog(), gens)
	settle(t, s, gens, "chan-1", "horizontal")

	if got := fc.startCount(); got != 1 {
		t.Fatalf("expected 1 start request, got %d", got)
	}
	fc.mu.Lock()
	req := fc.starts[0]
	fc.mu.Unlock()
	if req.ID != "chan-1/horizontal/g1" {
		t.Errorf("job id = %q, want chan-1/horizontal/g1", req.ID)
	}
	if req.Options.OutputPath != "composed/chan-1/horizontal/g1" {
		t.Errorf("outputPath = %q, want composed/chan-1/horizontal/g1", req.Options.OutputPath)
	}
	if req.Options.Orientation != "horizontal" {
		t.Errorf("orientation = %q, want horizontal — the compositor needs this to pick the right grid algorithm", req.Options.Orientation)
	}
	if len(req.Sources) != 1 || req.Sources[0].Path != "live/cam-1" {
		t.Errorf("expected only the live member as a source, got: %+v", req.Sources)
	}

	path, gen, ok := gens.Current("chan-1", "horizontal")
	if !ok || path != "composed/chan-1/horizontal/g1" || gen != "1" {
		t.Errorf("Generations.Current = (%q, %q, %v), want (composed/chan-1/horizontal/g1, 1, true)", path, gen, ok)
	}
}

func TestTickDoesNotStartADisabledComposition(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: false}
	store := testStore(comp)
	s := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(srv.URL), silentLog(), NewGenerations())
	for i := 0; i < 5; i++ {
		s.Tick(context.Background())
		time.Sleep(2 * time.Millisecond)
	}

	if got := fc.startCount(); got != 0 {
		t.Errorf("expected no start request for a disabled composition, got %d", got)
	}
}

func TestTickDoesNotStartWithNoLiveMember(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp)
	s := New(store, &fakeIngestLister{live: map[string]bool{}}, testConfig(srv.URL), silentLog(), NewGenerations())
	for i := 0; i < 5; i++ {
		s.Tick(context.Background())
		time.Sleep(2 * time.Millisecond)
	}

	if got := fc.startCount(); got != 0 {
		t.Errorf("expected no start request with no live member, got %d", got)
	}
}

// A relay destination is not, and was deliberately made not to be, a
// precondition — the whole point of the composed-preview HLS mount is
// checking a composition looks right before wiring up a real one.
func TestTickStartsEvenWithNoRelayDestinationAtAll(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp)
	gens := NewGenerations()
	s := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(srv.URL), silentLog(), gens)
	settle(t, s, gens, "chan-1", "horizontal")

	if got := fc.startCount(); got != 1 {
		t.Errorf("expected a start request even with no relay destination at all, got %d", got)
	}
}

func TestTickDoesNotRestartAnUnchangedJob(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp)
	gens := NewGenerations()
	s := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(srv.URL), silentLog(), gens)
	settle(t, s, gens, "chan-1", "horizontal")

	for i := 0; i < 5; i++ {
		s.Tick(context.Background())
		time.Sleep(2 * time.Millisecond)
	}

	if got := fc.startCount(); got != 1 {
		t.Errorf("expected exactly 1 start request across several identical ticks, got %d", got)
	}
}

// A source joining/leaving means a warm handoff, not an in-place restart:
// the new generation starts under its own id while the old one keeps
// running, so both a start and (eventually, once drained) a stop happen —
// never an instant swap under one shared id.
func TestTickHandsOffToANewGenerationWhenTheLiveSourceSetChanges(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp)
	lister := &fakeIngestLister{live: map[string]bool{"cam-1": true}}
	gens := NewGenerations()
	s := New(store, lister, testConfig(srv.URL), silentLog(), gens)
	settle(t, s, gens, "chan-1", "horizontal")

	lister.live["cam-2"] = true // a second source joins
	// The signature just changed — settle() alone would see the *old*
	// generation still current and return immediately, so poll for the
	// generation number to advance instead.
	for i := 0; i < 20; i++ {
		s.Tick(context.Background())
		if _, gen, ok := gens.Current("chan-1", "horizontal"); ok && gen == "2" {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}

	ids := fc.startIDs()
	if len(ids) != 2 || ids[0] != "chan-1/horizontal/g1" || ids[1] != "chan-1/horizontal/g2" {
		t.Fatalf("expected g1 then g2 to be started, got: %v", ids)
	}
	path, gen, ok := gens.Current("chan-1", "horizontal")
	if !ok || gen != "2" || path != "composed/chan-1/horizontal/g2" {
		t.Errorf("Generations.Current = (%q, %q, %v), want g2 current", path, gen, ok)
	}

	// g1 must still be running immediately after the handoff — it drains
	// on a grace period, it is not stopped on the spot.
	if fc.deleteCount() != 0 {
		t.Errorf("expected g1 not to be stopped yet, got %d deletes: %v", fc.deleteCount(), fc.deletedIDs())
	}

	// Once CompositionDrainMs elapses, a later tick stops it.
	time.Sleep(5 * time.Millisecond)
	s.Tick(context.Background())
	deleted := fc.deletedIDs()
	if len(deleted) != 1 || deleted[0] != "chan-1/horizontal/g1" {
		t.Errorf("expected g1 to be stopped after draining, got: %v", deleted)
	}
}

func TestTickStopsTheLiveGenerationWhenNoLongerWanted(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp)
	lister := &fakeIngestLister{live: map[string]bool{"cam-1": true}}
	gens := NewGenerations()
	s := New(store, lister, testConfig(srv.URL), silentLog(), gens)
	settle(t, s, gens, "chan-1", "horizontal")

	lister.live = map[string]bool{} // the only member stops publishing
	s.Tick(context.Background())

	if got := fc.deleteCount(); got != 1 {
		t.Fatalf("expected 1 delete request, got %d", got)
	}
	if id := fc.deletedIDs()[0]; id != "chan-1/horizontal/g1" {
		t.Errorf("deleted job id = %q, want chan-1/horizontal/g1", id)
	}
	// Final shutdown, not a handoff — nothing should be current anymore,
	// immediately, not after a drain.
	if _, _, ok := gens.Current("chan-1", "horizontal"); ok {
		t.Error("Generations should have nothing current once the composition is no longer wanted at all")
	}
}

// A source flapping in and out shouldn't thrash the encoder — a burst of
// signature changes within the debounce window collapses into a single
// start reflecting the final, settled state.
func TestTickDebouncesRapidSourceChanges(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp)
	// cam-1 stays live throughout — only cam-2 flaps — so every tick
	// still has a non-empty source list and reaches the debounce logic
	// (an empty source list skips reconciliation for this composition
	// entirely, which would not exercise debouncing at all).
	lister := &fakeIngestLister{live: map[string]bool{"cam-1": true}}
	cfg := testConfig(srv.URL)
	cfg.CompositionStabilizeMs = 30
	cfg.CompositionMaxStabilizeMs = 1000
	gens := NewGenerations()
	s := New(store, lister, cfg, silentLog(), gens)

	// Flap for a bit, well inside the 30ms stabilize window each time.
	for i := 0; i < 4; i++ {
		lister.live["cam-2"] = i%2 == 0
		s.Tick(context.Background())
		time.Sleep(3 * time.Millisecond)
	}
	if got := fc.startCount(); got != 0 {
		t.Fatalf("expected no start yet — still inside the debounce window, got %d", got)
	}

	lister.live["cam-2"] = false // settle on "cam-1 only" and stop touching it
	settle(t, s, gens, "chan-1", "horizontal")

	if got := fc.startCount(); got != 1 {
		t.Errorf("expected exactly 1 start once settled, got %d", got)
	}
}

// Churn that never actually stops changing must still eventually start,
// rather than deferring forever — degrades to "starts a little late", per
// the pre-migration compositor.js this is ported from.
func TestTickForcesAStartAfterMaxStabilizeWaitEvenIfStillChanging(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp)
	lister := &fakeIngestLister{live: map[string]bool{"cam-1": true}}
	cfg := testConfig(srv.URL)
	cfg.CompositionStabilizeMs = 1000  // never naturally settles within this test
	cfg.CompositionMaxStabilizeMs = 20 // ...but forced well before that
	gens := NewGenerations()
	s := New(store, lister, cfg, silentLog(), gens)

	deadline := time.Now().Add(200 * time.Millisecond)
	for fc.startCount() == 0 && time.Now().Before(deadline) {
		lister.live["cam-2"] = !lister.live["cam-2"] // keep the signature changing
		s.Tick(context.Background())
		time.Sleep(3 * time.Millisecond)
	}

	if got := fc.startCount(); got != 1 {
		t.Fatalf("expected the max-wait cap to force exactly 1 start, got %d", got)
	}
}

// A signature change that arrives before a warming generation ever goes
// live abandons that attempt rather than handing off to a configuration
// nobody wants anymore.
func TestTickAbandonsAWarmupSupersededBeforeGoingLive(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp)
	lister := &fakeIngestLister{live: map[string]bool{"cam-1": true}}
	gens := NewGenerations()
	s := New(store, lister, testConfig(srv.URL), silentLog(), gens)

	fc.hold("chan-1/horizontal/g1") // g1 will never report live
	for i := 0; i < 5; i++ {
		s.Tick(context.Background())
		time.Sleep(2 * time.Millisecond)
	}
	if fc.startCount() != 1 {
		t.Fatalf("expected g1 to have started warming, got %d starts", fc.startCount())
	}
	if _, _, ok := gens.Current("chan-1", "horizontal"); ok {
		t.Fatal("g1 must not be current yet — it's held at 'starting'")
	}

	lister.live["cam-2"] = true // supersede it before it ever goes live
	settle(t, s, gens, "chan-1", "horizontal")

	if deleted := fc.deletedIDs(); len(deleted) != 1 || deleted[0] != "chan-1/horizontal/g1" {
		t.Errorf("expected the abandoned g1 to be stopped, got: %v", deleted)
	}
	if _, gen, ok := gens.Current("chan-1", "horizontal"); !ok || gen != "2" {
		t.Errorf("expected g2 (for the superseding signature) to be current, got gen=%q ok=%v", gen, ok)
	}
}

// A composition that stops being wanted at all (disabled, or its live
// member drops) while a generation is still warming up has nobody who
// could possibly be watching it — cancel outright, no drain needed.
func TestTickCancelsAWarmupWhenTheCompositionBecomesUnwanted(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp)
	lister := &fakeIngestLister{live: map[string]bool{"cam-1": true}}
	gens := NewGenerations()
	s := New(store, lister, testConfig(srv.URL), silentLog(), gens)

	fc.hold("chan-1/horizontal/g1")
	for i := 0; i < 5; i++ {
		s.Tick(context.Background())
		time.Sleep(2 * time.Millisecond)
	}
	if fc.startCount() != 1 {
		t.Fatalf("expected g1 to have started warming, got %d starts", fc.startCount())
	}

	lister.live = map[string]bool{} // no live member anymore
	s.Tick(context.Background())

	if deleted := fc.deletedIDs(); len(deleted) != 1 || deleted[0] != "chan-1/horizontal/g1" {
		t.Errorf("expected the warming g1 to be cancelled, got: %v", deleted)
	}
}

// A quick, real end-to-end sanity check that Start's ticker actually fires
// Tick on the given interval.
func TestStartTicksUntilStopped(t *testing.T) {
	fc := &fakeCompositor{}
	srv := fc.server()
	defer srv.Close()

	comp := streamstore.ChannelComposition{ID: "comp-1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true}
	store := testStore(comp)
	s := New(store, &fakeIngestLister{live: map[string]bool{"cam-1": true}}, testConfig(srv.URL), silentLog(), NewGenerations())

	stop := make(chan struct{})
	go s.Start(context.Background(), 5*time.Millisecond, stop)
	time.Sleep(100 * time.Millisecond)
	close(stop)

	if got := fc.startCount(); got != 1 {
		t.Errorf("expected exactly 1 start request even across several ticks (signature unchanged once settled), got %d", got)
	}
}
