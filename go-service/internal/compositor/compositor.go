// Package compositor builds and supervises ffmpeg processes that composite
// several sources into one encoded video, publishing the result back into
// MediaMTX as its own path. Ported from server/src/compositor.js, which did
// this for the pre-migration app's single global "program" — this version
// supervises any number of independently identified jobs (one per channel +
// orientation, see the HTTP API in cmd/compositor), each read over RTSP
// from MediaMTX the same way.
//
// This package only ever runs the jobs it is explicitly told to (StartJob/
// StopJob) — it has no opinion on *which* channels should currently be
// compositing. That decision (is compositing enabled, is a member live, is
// a relay destination enabled) belongs to the Go data plane, which polls
// Rails and calls this service's HTTP API accordingly. Keeping this
// service "dumb" is deliberate: a heavy or misbehaving composition job
// must never be able to affect the data plane's own low-latency work
// (MediaMTX auth hook, WHEP proxying for ordinary viewers).
package compositor

import (
	"bufio"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/encoder"
	"github.com/Slicit/stream-composer/go-service/internal/layout"
)

// Source is one on-air stream to composite, in the order it should appear.
type Source struct {
	Path  string // e.g. "live/<playbackId>", read over RTSP from MediaMTX
	Label string // burned into its cell via drawtext, when Options.Labels is set
}

// Options is one job's encode/layout settings — mirrors a ChannelComposition
// row field-for-field (rails-service/app/models/channel_composition.rb).
type Options struct {
	Width, Height int
	FPS           int
	BitrateKbps   int
	Preset        string
	Encoder       string // "auto" | "software" | "vaapi" | "qsv"
	Background    string // "#rrggbb"
	Labels        bool
	LabelSize     int
	OutputPath    string // MediaMTX path to publish the composed feed to, e.g. "composed/<channelId>/horizontal"
}

// escapeDrawtext truncates before escaping so a cut never lands mid-escape-
// sequence, and leaves `%` alone — drawtext runs with expansion=none, where
// a literal % is fine and an escaped one is rejected outright, silently
// dropping the whole label. Ported from compositor.js's escapeDrawtext.
func escapeDrawtext(text string) string {
	s := strings.NewReplacer("\r", " ", "\n", " ").Replace(text)
	if len(s) > 48 {
		s = s[:48]
	}
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `:`, `\:`)
	s = strings.ReplaceAll(s, `'`, "’")
	return s
}

func hexColor(value, fallback string) string {
	v := strings.TrimPrefix(strings.TrimSpace(value), "#")
	if len(v) == 6 && isHex(v) {
		return "0x" + v
	}
	return fallback
}

func isHex(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func rtspBase(cfg config.Config) string {
	host, port := cfg.MediaMTX.RTSPHost, cfg.MediaMTX.RTSPPort
	user, pass := cfg.MediaMTX.InternalUser, cfg.MediaMTX.InternalPassword
	creds := ""
	if pass != "" {
		creds = user + ":" + pass + "@"
	}
	return fmt.Sprintf("rtsp://%s%s:%s", creds, host, port)
}

// BuildArgs is the complete ffmpeg argument list for one job. Cells come
// from layout.Compute in "auto" mode — the same grid math a "fixed"-layout
// browser viewer uses, so a channel's composed restream matches what a
// fixed-mode viewer sees. Each source is scaled, padded and optionally
// captioned, then overlaid onto a solid background — overlay rather than
// xstack, since xstack can only tile a perfect matrix and overlay lets a
// partial row stay centered. The output is video-only: mixing several
// rooms' audio into one track is unlistenable, so a relayed destination
// gets a silent picture, matching the pre-migration compositor exactly.
func BuildArgs(sources []Source, opts Options, cfg config.Config, caps encoder.Caps) (args []string, result layout.Result) {
	result = layout.Compute(len(sources), layout.Options{Width: opts.Width, Height: opts.Height, Gap: 4, Layout: "auto"})
	placed := sources
	if len(placed) > len(result.Cells) {
		placed = placed[:len(result.Cells)]
	}

	kind := encoder.Resolve(opts.Encoder, caps)

	args = []string{"-hide_banner", "-loglevel", "warning", "-nostdin"}

	// VA-API needs its device up front so the filtergraph can hwupload
	// into it. Quick Sync deliberately does not: -vaapi_device would give
	// the graph a VAAPI frames context, and h264_qsv only accepts
	// nv12/qsv frames, so the graph would fail to configure on every start.
	if kind == "vaapi" {
		args = append(args, "-vaapi_device", cfg.VAAPIDevice)
	}

	base := rtspBase(cfg)
	for _, src := range placed {
		args = append(args,
			"-thread_queue_size", "1024",
			"-rtsp_transport", "tcp",
			"-fflags", "+genpts+discardcorrupt",
			"-use_wallclock_as_timestamps", "1",
			"-i", base+"/"+src.Path,
		)
	}

	fps := opts.FPS
	if fps <= 0 {
		fps = 30
	}
	bg := hexColor(opts.Background, "0x0b1220")
	useLabels := opts.Labels && caps.Drawtext

	var parts []string
	parts = append(parts, fmt.Sprintf("color=c=%s:s=%dx%d:r=%d[bg]", bg, result.Width, result.Height, fps))

	for i, src := range placed {
		cell := result.Cells[i]
		chain := fmt.Sprintf("[%d:v]fps=%d,scale=%d:%d:force_original_aspect_ratio=decrease:flags=bilinear,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1",
			i, fps, cell.W, cell.H, cell.W, cell.H)
		caption := strings.TrimSpace(src.Label)
		if useLabels && caption != "" {
			size := opts.LabelSize
			if size < 10 {
				size = 10
			}
			if size > 72 {
				size = 72
			}
			font := ""
			if caps.FontFile != "" {
				font = "fontfile='" + caps.FontFile + "':"
			}
			border := size / 8
			if border < 2 {
				border = 2
			}
			margin := size / 2
			if margin < 8 {
				margin = 8
			}
			chain += fmt.Sprintf(",drawtext=%stext='%s':expansion=none:fontcolor=white:fontsize=%d:borderw=%d:bordercolor=black:x=(w-text_w)/2:y=h-th-%d",
				font, escapeDrawtext(caption), size, border, margin)
		}
		parts = append(parts, chain+fmt.Sprintf("[c%d]", i))
	}

	last := "bg"
	for i := range placed {
		cell := result.Cells[i]
		out := fmt.Sprintf("o%d", i)
		if i == len(placed)-1 {
			out = "stacked"
		}
		parts = append(parts, fmt.Sprintf("[%s][c%d]overlay=x=%d:y=%d:eof_action=pass:repeatlast=1[%s]", last, i, cell.X, cell.Y, out))
		last = out
	}
	if len(placed) == 0 {
		last = "bg"
	}

	switch kind {
	case "vaapi":
		parts = append(parts, fmt.Sprintf("[%s]format=nv12,hwupload[outv]", last))
	case "qsv":
		parts = append(parts, fmt.Sprintf("[%s]format=nv12[outv]", last))
	default:
		parts = append(parts, fmt.Sprintf("[%s]format=yuv420p[outv]", last))
	}

	args = append(args, "-filter_complex", strings.Join(parts, ";"))
	args = append(args, "-map", "[outv]", "-an")
	args = append(args, encoder.OutputArgs(kind, encoder.EncodeOptions{FPS: fps, BitrateKbps: opts.BitrateKbps, Preset: opts.Preset})...)
	args = append(args,
		"-fps_mode", "cfr",
		"-flags", "+low_delay",
		"-muxdelay", "0",
		"-muxpreload", "0",
		"-progress", "pipe:1",
		"-nostats",
		"-f", "rtsp",
		"-rtsp_transport", "tcp",
		base+"/"+opts.OutputPath,
	)

	return args, result
}

// ---------------------------------------------------------------- runner

// Status is one job's current supervision state.
type Status struct {
	State    string // "starting" | "live" | "retrying" | "off"
	Since    time.Time
	Restarts int
	LastErr  string
	RetryAt  time.Time
	Command  string // the exact ffmpeg command in use — no secrets in it (RTSP paths only), safe to expose
}

type runningJob struct {
	cmd   *exec.Cmd
	jobID string
}

// Runner supervises any number of composition jobs, keyed by an opaque job
// ID the caller picks (cmd/compositor uses "<channelId>/<orientation>").
// Mirrors internal/relayrunner.Runner's supervision shape (spawn, track,
// back off on crash) — the difference is what decides when to start/stop:
// relayrunner reconciles against streamstore on a timer, this is driven
// entirely by StartJob/StopJob calls from the HTTP API.
type Runner struct {
	Config config.Config
	Caps   encoder.Caps
	Log    *slog.Logger

	mu      sync.Mutex
	running map[string]*runningJob
	health  map[string]*Status
	backoff map[string]time.Duration
}

func New(cfg config.Config, caps encoder.Caps, log *slog.Logger) *Runner {
	return &Runner{
		Config:  cfg,
		Caps:    caps,
		Log:     log,
		running: make(map[string]*runningJob),
		health:  make(map[string]*Status),
		backoff: make(map[string]time.Duration),
	}
}

func (r *Runner) statusLocked(id string) *Status {
	s, ok := r.health[id]
	if !ok {
		s = &Status{State: "off"}
		r.health[id] = s
	}
	return s
}

// StartJob (re)starts a job with the given sources/options — if one is
// already running under this ID, it is stopped first. The caller (the Go
// data plane, or a human validating this service directly) decides when
// that's warranted; this package does not diff configs itself.
func (r *Runner) StartJob(id string, sources []Source, opts Options) {
	r.mu.Lock()
	if _, running := r.running[id]; running {
		r.stopLocked(id, "restarting with new configuration")
	}
	delete(r.backoff, id)
	r.mu.Unlock()

	r.startOne(id, sources, opts)
}

// StopJob halts a job. A no-op if nothing is running under this ID.
func (r *Runner) StopJob(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stopLocked(id, "stopped")
	delete(r.health, id)
	delete(r.backoff, id)
}

// StopAll halts every running job — for a clean shutdown.
func (r *Runner) StopAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id := range r.running {
		r.stopLocked(id, "shutdown")
	}
}

func (r *Runner) stopLocked(id, reason string) {
	proc, ok := r.running[id]
	if !ok {
		return
	}
	delete(r.running, id)
	s := r.statusLocked(id)
	s.State = "off"
	s.Since = time.Time{}
	r.Log.Info("compositor job stopped", "id", id, "reason", reason)
	_ = proc.cmd.Process.Signal(syscall.SIGTERM)
	go func(p *exec.Cmd) {
		time.Sleep(3 * time.Second)
		_ = p.Process.Kill()
	}(proc.cmd)
}

// StatusOf returns the current status for a job — "off" with a zero Status
// when nothing has run under this ID yet.
func (r *Runner) StatusOf(id string) Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.health[id]; ok {
		return *s
	}
	return Status{State: "off"}
}

// List returns every job this Runner currently has any state for —
// running or mid-backoff.
func (r *Runner) List() map[string]Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[string]Status, len(r.health))
	for id, s := range r.health {
		out[id] = *s
	}
	return out
}

func (r *Runner) scheduleRetryLocked(id, reason string) {
	s := r.statusLocked(id)
	s.Restarts++
	delay := r.backoff[id]
	if delay == 0 {
		delay = time.Duration(r.Config.RestartDelayMs) * time.Millisecond
	} else {
		delay *= 2
		max := time.Duration(r.Config.MaxRestartDelayMs) * time.Millisecond
		if delay > max {
			delay = max
		}
	}
	r.backoff[id] = delay
	s.RetryAt = time.Now().Add(delay)
	s.State = "retrying"
	r.Log.Warn("compositor job will retry", "id", id, "reason", reason, "inMs", delay.Milliseconds())
}

func (r *Runner) startOne(id string, sources []Source, opts Options) {
	args, _ := BuildArgs(sources, opts, r.Config, r.Caps)
	cmd := exec.Command(r.Config.FFmpegPath, args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		r.Log.Warn("could not attach to ffmpeg stdout", "id", id, "error", err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		r.Log.Warn("could not attach to ffmpeg stderr", "id", id, "error", err.Error())
		return
	}

	if err := cmd.Start(); err != nil {
		r.mu.Lock()
		s := r.statusLocked(id)
		s.LastErr = err.Error()
		r.scheduleRetryLocked(id, "ffmpeg could not be started")
		r.mu.Unlock()
		return
	}

	r.Log.Info("compositor job started", "id", id, "sources", len(sources), "output", opts.OutputPath)

	r.mu.Lock()
	r.running[id] = &runningJob{cmd: cmd, jobID: id}
	s := r.statusLocked(id)
	s.State = "starting"
	s.Since = time.Now()
	s.LastErr = ""
	s.Command = r.Config.FFmpegPath + " " + strings.Join(args, " ")
	r.mu.Unlock()

	sawData := false
	go r.readProgress(id, stdout, &sawData)
	go r.readStderr(id, stderr)

	go func() {
		waitErr := cmd.Wait()

		r.mu.Lock()
		defer r.mu.Unlock()
		current, stillTracked := r.running[id]
		if !stillTracked || current.cmd != cmd {
			return // superseded by StartJob or StopJob while this was running
		}
		delete(r.running, id)
		if waitErr == nil {
			// A clean exit with no signal from us is still unexpected —
			// ffmpeg does not stop on its own while its inputs are live.
			r.scheduleRetryLocked(id, "ffmpeg exited")
			return
		}
		r.scheduleRetryLocked(id, "ffmpeg exited: "+waitErr.Error())
	}()
}

func (r *Runner) readProgress(id string, stdout io.Reader, sawData *bool) {
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		idx := strings.IndexByte(line, '=')
		if idx < 0 {
			continue
		}
		key, value := line[:idx], strings.TrimSpace(line[idx+1:])
		if key == "frame" {
			if n, err := strconv.Atoi(value); err == nil && n > 0 && !*sawData {
				*sawData = true
				r.mu.Lock()
				if s, ok := r.health[id]; ok && s.State != "live" {
					s.State = "live"
					delete(r.backoff, id)
				}
				r.mu.Unlock()
			}
		}
	}
}

func (r *Runner) readStderr(id string, stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		text := scanner.Text()
		r.Log.Debug("ffmpeg", "id", id, "line", text)
		if trimmed := strings.TrimSpace(text); trimmed != "" {
			r.mu.Lock()
			r.statusLocked(id).LastErr = trimmed
			r.mu.Unlock()
		}
	}
}
