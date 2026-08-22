// Package audiomonitor supervises one ffmpeg Opus transcode per live
// source that has an audio track — the process-supervision port of
// server/src/audioRelay.js. Every OBS-style source arrives over RTMP/SRT
// as AAC, which browsers cannot negotiate for WebRTC audio, so each
// source's audio track is re-encoded to Opus and republished to MediaMTX
// under <audioPrefix>/<key>, which the media proxy exposes to viewers as
// s/<playbackId>/audio.
//
// Unlike relayrunner, this package has no destination configuration to
// read from streamstore — it reacts purely to what MediaMTX reports is
// currently live, one encoder per source with audio, whether or not
// anyone is listening.
package audiomonitor

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os/exec"
	"sync"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
)

// Status mirrors relayrunner.Status — same fields, same meaning, kept as
// a separate type since the two packages supervise different things.
type Status struct {
	State    string // "off", "connecting", "live", "waiting", "retrying"
	Since    time.Time
	Restarts int
	LastErr  string
	RetryAt  time.Time
}

type runningProc struct {
	cmd *exec.Cmd
	key string
}

// IngestLister is the one MediaMTX capability Tick needs — the same
// narrowing relayrunner uses, so *mediamtx.Client satisfies both.
type IngestLister interface {
	ListIngest(ctx context.Context) ([]mediamtx.IngestPath, error)
}

// Monitor owns the mutable state startOne/stopOne/tick manage in the Node
// version: which transcodes are running, and each source's health.
type Monitor struct {
	MediaMTX IngestLister
	Config   config.Config
	Log      *slog.Logger

	mu      sync.Mutex
	running map[string]*runningProc
	health  map[string]*Status
	backoff map[string]time.Duration
}

func New(mtx IngestLister, cfg config.Config, log *slog.Logger) *Monitor {
	return &Monitor{
		MediaMTX: mtx,
		Config:   cfg,
		Log:      log,
		running:  make(map[string]*runningProc),
		health:   make(map[string]*Status),
		backoff:  make(map[string]time.Duration),
	}
}

// StatusOf returns the current status for a source key — "off" with a
// zero Status when nothing has run for it yet.
func (m *Monitor) StatusOf(key string) Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.health[key]; ok {
		return *s
	}
	return Status{State: "off"}
}

// Start runs Tick immediately and then on every interval, until stop is
// closed. Mirrors startLoop() in the Node version.
func (m *Monitor) Start(ctx context.Context, interval time.Duration, stop <-chan struct{}) {
	m.Tick(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			m.Tick(ctx)
		}
	}
}

// StopAll halts every currently-running transcode — for a clean shutdown,
// mirroring stop() in the Node version.
func (m *Monitor) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key := range m.running {
		m.stopLocked(key, "shutdown")
	}
}

// -------------------------------------------------------------- pure logic

func (m *Monitor) rtspBase() string {
	host := m.Config.MediaMTX.RTSPHost
	port := m.Config.MediaMTX.RTSPPort
	user := m.Config.MediaMTX.InternalUser
	pass := m.Config.MediaMTX.InternalPassword
	creds := ""
	if pass != "" {
		creds = fmt.Sprintf("%s:%s@", url.QueryEscape(user), url.QueryEscape(pass))
	}
	return fmt.Sprintf("rtsp://%s%s:%s", creds, host, port)
}

// buildArgs is ffmpeg's argument list for one source's audio transcode.
// Ported from audioRelay.js's buildArgs().
func (m *Monitor) buildArgs(key string) []string {
	base := m.rtspBase()
	return []string{
		"-hide_banner", "-loglevel", "warning", "-nostdin",
		"-thread_queue_size", "1024",
		"-rtsp_transport", "tcp",
		"-fflags", "+genpts+discardcorrupt",
		"-use_wallclock_as_timestamps", "1",
		"-i", fmt.Sprintf("%s/%s/%s", base, m.Config.IngestPrefix, key),
		"-map", "0:a:0",
		"-vn",
		"-c:a", "libopus", "-b:a", "96k", "-ar", "48000", "-ac", "2",
		"-muxdelay", "0", "-muxpreload", "0",
		"-progress", "pipe:1",
		"-nostats",
		"-f", "rtsp",
		"-rtsp_transport", "tcp",
		fmt.Sprintf("%s/%s/%s", base, m.Config.AudioPrefix, key),
	}
}
