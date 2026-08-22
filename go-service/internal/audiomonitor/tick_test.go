package audiomonitor

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
)

type fakeIngestLister struct {
	live map[string]bool // key -> hasAudio
}

func (f *fakeIngestLister) ListIngest(context.Context) ([]mediamtx.IngestPath, error) {
	out := make([]mediamtx.IngestPath, 0, len(f.live))
	for k, hasAudio := range f.live {
		out = append(out, mediamtx.IngestPath{Key: k, Ready: true, HasAudio: hasAudio})
	}
	return out, nil
}

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
		AudioPrefix:       "audio",
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

func silentLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestTickIgnoresASourceWithNoAudioTrack(t *testing.T) {
	lister := &fakeIngestLister{live: map[string]bool{"video-only-key": false}}
	m := New(lister, testConfig(fakeFFmpeg(t, "sleep 5")), silentLog())
	m.Tick(context.Background())

	if got := m.StatusOf("video-only-key").State; got != "off" {
		t.Errorf("a source with no audio track must never be transcoded, got state %q", got)
	}
}

func TestTickStartsAndStopsATranscodeForALiveAudioSource(t *testing.T) {
	lister := &fakeIngestLister{live: map[string]bool{"src-key": true}}
	m := New(lister, testConfig(fakeFFmpeg(t, "trap '' TERM; sleep 5")), silentLog())
	m.Tick(context.Background())

	waitFor(t, time.Second, func() bool {
		m.mu.Lock()
		defer m.mu.Unlock()
		_, running := m.running["src-key"]
		return running
	})

	lister.live = map[string]bool{}
	m.Tick(context.Background())

	waitFor(t, time.Second, func() bool {
		m.mu.Lock()
		defer m.mu.Unlock()
		_, running := m.running["src-key"]
		return !running
	})
	if got := m.StatusOf("src-key").State; got != "off" {
		t.Errorf("after the source disappears, state should be 'off', got %q", got)
	}
}

func TestFailingFFmpegSchedulesABackoffThatGrows(t *testing.T) {
	lister := &fakeIngestLister{live: map[string]bool{"src-key": true}}
	m := New(lister, testConfig(fakeFFmpeg(t, "exit 1")), silentLog())
	m.Tick(context.Background())

	waitFor(t, time.Second, func() bool {
		return m.StatusOf("src-key").State == "retrying"
	})
	first := m.StatusOf("src-key")
	if first.Restarts != 1 {
		t.Errorf("Restarts = %d, want 1", first.Restarts)
	}

	m.Tick(context.Background())
	m.mu.Lock()
	_, running := m.running["src-key"]
	m.mu.Unlock()
	if running {
		t.Error("a source still inside its backoff window must not be restarted")
	}

	time.Sleep(80 * time.Millisecond)
	m.Tick(context.Background())
	waitFor(t, time.Second, func() bool {
		return m.StatusOf("src-key").Restarts >= 2
	})
	second := m.StatusOf("src-key")
	if !second.RetryAt.After(first.RetryAt) {
		t.Error("the retry delay should grow between consecutive failures")
	}
}
