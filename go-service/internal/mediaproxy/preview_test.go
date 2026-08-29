package mediaproxy

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/compositionscheduler"
	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

func testPreviewHandler(gens *compositionscheduler.Generations, cfg config.Config) *Handler {
	store := streamstore.NewMemory()
	store.Replace(nil, nil, nil, []streamstore.ChannelComposition{
		{ID: "cc1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true, PreviewToken: "the-real-token"},
		{ID: "cc2", ChannelID: "chan-1", Orientation: "vertical", Enabled: false, PreviewToken: "vertical-token"},
	}, false, "", "")
	return &Handler{
		Resolver: Resolver{Store: store, Config: cfg, Generations: gens},
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func TestServePreviewRejectsAWrongToken(t *testing.T) {
	h := testPreviewHandler(compositionscheduler.NewGenerations(), config.Config{})
	req := httptest.NewRequest(http.MethodGet, PreviewMount+"/c/chan-1/horizontal.ts?token=guessed", nil)
	rec := httptest.NewRecorder()
	h.ServePreview(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("SECURITY: got %d, want 404", rec.Code)
	}
}

func TestServePreviewRejectsAMissingToken(t *testing.T) {
	h := testPreviewHandler(compositionscheduler.NewGenerations(), config.Config{})
	req := httptest.NewRequest(http.MethodGet, PreviewMount+"/c/chan-1/horizontal.ts", nil)
	rec := httptest.NewRecorder()
	h.ServePreview(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("SECURITY: got %d, want 404", rec.Code)
	}
}

func TestServePreviewRejectsADisabledComposition(t *testing.T) {
	h := testPreviewHandler(compositionscheduler.NewGenerations(), config.Config{})
	req := httptest.NewRequest(http.MethodGet, PreviewMount+"/c/chan-1/vertical.ts?token=vertical-token", nil)
	rec := httptest.NewRecorder()
	h.ServePreview(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("a disabled composition must not stream, even with its real token; got %d", rec.Code)
	}
}

func TestServePreviewRejectsPost(t *testing.T) {
	h := testPreviewHandler(compositionscheduler.NewGenerations(), config.Config{})
	req := httptest.NewRequest(http.MethodPost, PreviewMount+"/c/chan-1/horizontal.ts?token=the-real-token", nil)
	rec := httptest.NewRecorder()
	h.ServePreview(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("got %d, want 405", rec.Code)
	}
}

func TestServePreviewRejectsAnUnknownPath(t *testing.T) {
	h := testPreviewHandler(compositionscheduler.NewGenerations(), config.Config{})
	req := httptest.NewRequest(http.MethodGet, PreviewMount+"/c/chan-1/sideways.ts?token=the-real-token", nil)
	rec := httptest.NewRecorder()
	h.ServePreview(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("got %d, want 404", rec.Code)
	}
}

// copyPreviewUntilGenerationChanges is the core swap-safety logic — tested
// directly, with a plain io.Pipe standing in for a relay's stdout, so
// these don't need a real ffmpeg process at all.

func TestCopyPreviewUntilGenerationChangesStopsOnEOF(t *testing.T) {
	gens := compositionscheduler.NewGenerations()
	gens.Set("chan-1", "horizontal", "composed/chan-1/horizontal/g1", "1")
	h := testPreviewHandler(gens, config.Config{})

	pr, pw := io.Pipe()
	go func() {
		_, _ = pw.Write([]byte("data"))
		_ = pw.Close()
	}()

	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		h.copyPreviewUntilGenerationChanges(context.Background(), rec, rec, pr, "chan-1", "horizontal", "1")
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("did not return once the relay's stdout hit EOF")
	}
	if rec.Body.String() != "data" {
		t.Errorf("got %q", rec.Body.String())
	}
}

func TestCopyPreviewUntilGenerationChangesStopsWhenTheViewerDisconnects(t *testing.T) {
	gens := compositionscheduler.NewGenerations()
	gens.Set("chan-1", "horizontal", "composed/chan-1/horizontal/g1", "1")
	h := testPreviewHandler(gens, config.Config{})

	pr, _ := io.Pipe() // never written to or closed — only ctx cancellation should end this
	rec := httptest.NewRecorder()
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		h.copyPreviewUntilGenerationChanges(ctx, rec, rec, pr, "chan-1", "horizontal", "1")
		close(done)
	}()
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("did not return once the viewer's context was cancelled")
	}
}

func TestCopyPreviewUntilGenerationChangesStopsWhenTheGenerationChanges(t *testing.T) {
	gens := compositionscheduler.NewGenerations()
	gens.Set("chan-1", "horizontal", "composed/chan-1/horizontal/g1", "1")
	h := testPreviewHandler(gens, config.Config{})

	pr, pw := io.Pipe()
	defer pw.Close()
	go func() { _, _ = pw.Write([]byte("hello")) }()

	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		h.copyPreviewUntilGenerationChanges(context.Background(), rec, rec, pr, "chan-1", "horizontal", "1")
		close(done)
	}()

	// Give the "hello" a moment to actually land, then move the current
	// generation on — the poll ticker should notice within a second.
	time.Sleep(50 * time.Millisecond)
	gens.Set("chan-1", "horizontal", "composed/chan-1/horizontal/g2", "2")

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("did not return once the generation changed")
	}
	if !strings.Contains(rec.Body.String(), "hello") {
		t.Errorf("expected bytes written before the swap to have reached the writer, got %q", rec.Body.String())
	}
}

// syncBuffer is a minimal, concurrency-safe http.ResponseWriter — needed
// only by TestServePreviewSwapsRelayWhenTheGenerationChanges, which reads
// the body while ServePreview is still writing to it from another
// goroutine (httptest.ResponseRecorder's bytes.Buffer is not safe for
// that).
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
	hdr http.Header
}

func (s *syncBuffer) Header() http.Header { return s.hdr }
func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}
func (s *syncBuffer) WriteHeader(int) {}
func (s *syncBuffer) Flush()          {}
func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

func fakePreviewFFmpeg(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-ffmpeg.sh")
	script := "#!/bin/sh\n" + body + "\n"
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

// The end-to-end case: a real (fake) ffmpeg process, spawned by the real
// handler, actually streams bytes to a real response — and when the
// current generation changes mid-connection, ServePreview kills that
// process and starts a new one against the new generation's path,
// without the viewer's own connection ever being torn down. The fake
// script picks its output based on which generation's path it was told
// to read (found in its own argv), so this proves the swap reaches an
// actually-different upstream, not just that *a* process restarted.
func TestServePreviewSwapsRelayWhenTheGenerationChanges(t *testing.T) {
	gens := compositionscheduler.NewGenerations()
	gens.Set("chan-1", "horizontal", "composed/chan-1/horizontal/g1", "1")
	cfg := config.Config{
		MediaMTX: config.MediaMTX{RTSPHost: "mediamtx", RTSPPort: "8554"},
		FFmpegPath: fakePreviewFFmpeg(t, `
MARKER=UNKNOWN
case "$*" in
  *g1*) MARKER=GEN1 ;;
  *g2*) MARKER=GEN2 ;;
esac
while true; do printf '%s' "$MARKER"; sleep 0.02; done`),
	}
	h := testPreviewHandler(gens, cfg)

	req := httptest.NewRequest(http.MethodGet, PreviewMount+"/c/chan-1/horizontal.ts?token=the-real-token", nil)
	ctx, cancel := context.WithCancel(context.Background())
	req = req.WithContext(ctx)

	w := &syncBuffer{hdr: make(http.Header)}
	handlerDone := make(chan struct{})
	go func() {
		h.ServePreview(w, req)
		close(handlerDone)
	}()

	waitFor := func(marker string) {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for !strings.Contains(w.String(), marker) {
			if time.Now().After(deadline) {
				t.Fatalf("never saw %q in the response, got %q", marker, w.String())
			}
			time.Sleep(10 * time.Millisecond)
		}
	}

	waitFor("GEN1")

	gens.Set("chan-1", "horizontal", "composed/chan-1/horizontal/g2", "2")
	waitFor("GEN2")

	cancel()
	select {
	case <-handlerDone:
	case <-time.After(2 * time.Second):
		t.Fatal("ServePreview did not return once the viewer disconnected")
	}
}
