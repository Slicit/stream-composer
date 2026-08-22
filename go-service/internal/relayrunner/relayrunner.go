// Package relayrunner supervises one ffmpeg process per enabled restream
// destination — the process-supervision half of server/src/relays.js
// (buildArgs/startOne/stopOne/tick/scheduleRetry). The *data* half
// (validation, provider defaults, key masking) is Rails' RelayDestination
// model; this package only ever reads relay configuration from
// streamstore.Store, never mutates it.
//
// One source, any number of destinations. Each destination is an
// independently supervised ffmpeg doing a straight remux — RTSP in from
// MediaMTX, FLV out over RTMP — with no filtering and no video encode.
package relayrunner

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

// Status is a relay's current supervision state — enough for a future
// status API, and what tests assert on.
type Status struct {
	State    string // "off", "connecting", "live", "waiting", "retrying"
	Since    time.Time
	Restarts int
	LastErr  string
	RetryAt  time.Time
}

type runningProc struct {
	cmd     *exec.Cmd
	relayID string
}

// IngestLister is the one MediaMTX capability Tick needs — narrowed to an
// interface so it can be faked in tests without a real MediaMTX instance.
// *mediamtx.Client already satisfies this.
type IngestLister interface {
	ListIngest(ctx context.Context) ([]mediamtx.IngestPath, error)
}

// Runner owns exactly the mutable state startOne/stopOne/tick manage in the
// Node version: which processes are running, and each relay's health.
type Runner struct {
	Store    streamstore.Store
	MediaMTX IngestLister
	Config   config.Config
	Log      *slog.Logger

	mu      sync.Mutex
	running map[string]*runningProc
	health  map[string]*Status
	backoff map[string]time.Duration
}

func New(store streamstore.Store, mtx IngestLister, cfg config.Config, log *slog.Logger) *Runner {
	return &Runner{
		Store:    store,
		MediaMTX: mtx,
		Config:   cfg,
		Log:      log,
		running:  make(map[string]*runningProc),
		health:   make(map[string]*Status),
		backoff:  make(map[string]time.Duration),
	}
}

// StatusOf returns the current status for a relay id — "off" with a zero
// Status when nothing has run for it yet, the same "no history" meaning
// stateOf() in the Node version defaults to.
func (r *Runner) StatusOf(relayID string) Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.health[relayID]; ok {
		return *s
	}
	return Status{State: "off"}
}

// Start runs Tick immediately and then on every interval, until stop is
// closed. Mirrors startLoop() in the Node version.
func (r *Runner) Start(ctx context.Context, interval time.Duration, stop <-chan struct{}) {
	r.Tick(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			r.Tick(ctx)
		}
	}
}

// StopAll halts every currently-running destination — for a clean
// shutdown, mirroring stop() in the Node version.
func (r *Runner) StopAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id := range r.running {
		r.stopLocked(id, "shutdown")
	}
}

// -------------------------------------------------------------- pure logic

// destinationURL joins a server URL and a stream key the way every RTMP
// platform expects: the key as the final path segment, kept *after* the
// query string. Ported from relays.js's destinationUrl() /
// RelayDestination.destination_url — identical on all three
// implementations on purpose.
func destinationURL(rawURL, key string) string {
	raw := strings.TrimSpace(rawURL)
	k := strings.TrimSpace(key)
	if k == "" {
		return raw
	}
	q := strings.IndexByte(raw, '?')
	base := raw
	query := ""
	if q >= 0 {
		base, query = raw[:q], raw[q:]
	}
	base = strings.TrimRight(base, "/")
	return base + "/" + k + query
}

func (r *Runner) rtspBase() string {
	host := r.Config.MediaMTX.RTSPHost
	port := r.Config.MediaMTX.RTSPPort
	user := r.Config.MediaMTX.InternalUser
	pass := r.Config.MediaMTX.InternalPassword
	creds := ""
	if pass != "" {
		creds = fmt.Sprintf("%s:%s@", url.QueryEscape(user), url.QueryEscape(pass))
	}
	return fmt.Sprintf("rtsp://%s%s:%s", creds, host, port)
}

// buildArgs is ffmpeg's argument list for one destination. Video is never
// touched; audio is either copied or transcoded to AAC (RTMP can only
// carry AAC). Ported from relays.js's buildArgs().
func (r *Runner) buildArgs(relay streamstore.Relay, sourcePath string) []string {
	args := []string{
		"-hide_banner", "-loglevel", "warning", "-nostdin",
		"-thread_queue_size", "1024",
		"-rtsp_transport", "tcp",
		"-i", fmt.Sprintf("%s/%s", r.rtspBase(), sourcePath),
		"-map", "0:v:0", "-map", "0:a:0?",
		"-c:v", "copy",
	}
	if relay.Audio == "aac" {
		args = append(args, "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2")
	} else {
		args = append(args, "-c:a", "copy")
	}
	args = append(args,
		"-f", "flv",
		"-flvflags", "no_duration_filesize",
		"-progress", "pipe:1",
		"-nostats",
		destinationURL(relay.URL, relay.Key),
	)
	return args
}

// PreviewCommand is what ffmpeg would run, with the key redacted — for a
// "show me the command" admin/debug affordance later.
func (r *Runner) PreviewCommand(relay streamstore.Relay, sourcePath string) string {
	redacted := relay
	if redacted.Key != "" {
		redacted.Key = "STREAM-KEY"
	}
	return "ffmpeg " + strings.Join(r.buildArgs(redacted, sourcePath), " ")
}
