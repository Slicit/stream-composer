package mediaproxy

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// PreviewMount serves a channel composition's composed output as one
// continuous MPEG-TS byte stream over plain HTTP — for VLC's "Open
// Network Stream" (or ffplay, or anything else that just wants bytes),
// which is exactly the point: unlike PreviewMount's HLS cousin
// (resolveComposedPreview, reached through HLSMount), a plain MPEG-TS
// stream has no manifest, no session, nothing for MediaMTX's LL-HLS
// machinery to invalidate out from under a viewer when a composition
// hands off to a new generation (see internal/compositionscheduler.
// Generations' own doc comment on why that happens at all, and why an
// HLS session can't survive it).
//
// ffmpeg can't add or remove a filtergraph input from a running process,
// so the compositor itself can never avoid restarting on a membership
// change — that's unavoidable and unrelated to this mount. What this
// mount avoids is forcing the *viewer* through that same restart: rather
// than proxying MediaMTX's own per-generation session straight through
// (as HLSMount does), ServePreview holds ONE persistent connection to
// the viewer open for as long as they're connected, and relays into it
// from its own short-lived ffmpeg process reading whichever generation
// is current — swapping that upstream process, transparently, the moment
// Generations reports a new one. The viewer's own TCP connection and
// player state never resets. A real handoff is a brief stutter while the
// new relay reconnects to a composed output that's already live (not a
// fresh encode — typically a second or two), never a dead connection
// that has to be reopened by hand.
const PreviewMount = "/mtx/preview"

var previewPathRe = regexp.MustCompile(`^c/([A-Za-z0-9_-]{1,64})/(horizontal|vertical)\.ts$`)

// pollInterval is how often ServePreview checks whether a new generation
// has gone live while it's mid-relay — short enough that a handoff is
// picked up promptly, long enough not to matter as load.
const previewPollInterval = 1 * time.Second

func (h *Handler) rtspBase() string {
	host, port := h.Resolver.Config.MediaMTX.RTSPHost, h.Resolver.Config.MediaMTX.RTSPPort
	user, pass := h.Resolver.Config.MediaMTX.InternalUser, h.Resolver.Config.MediaMTX.InternalPassword
	creds := ""
	if pass != "" {
		creds = fmt.Sprintf("%s:%s@", url.QueryEscape(user), url.QueryEscape(pass))
	}
	return fmt.Sprintf("rtsp://%s%s:%s", creds, host, port)
}

// ServePreview handles PreviewMount. GET/HEAD only — this is a read-only
// relay, nothing here ever publishes.
func (h *Handler) ServePreview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed.")
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, PreviewMount+"/")
	m := previewPathRe.FindStringSubmatch(rest)
	if m == nil {
		writeJSONError(w, http.StatusNotFound, "Unknown preview path.")
		return
	}
	channelID, orientation := m[1], m[2]
	token := r.URL.Query().Get("token")
	if !h.Resolver.authorizeComposedPreview(channelID, orientation, token) {
		writeJSONError(w, http.StatusNotFound, "Unknown composition or bad token.")
		return
	}
	if h.Resolver.Generations == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Preview is not available.")
		return
	}

	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	// The relay's own ffmpeg needs a moment to connect and produce its
	// first bytes — flush the headers now rather than leaving the client
	// waiting to see even a status code until that's done.
	if flusher != nil {
		flusher.Flush()
	}
	if r.Method == http.MethodHead {
		return
	}

	ctx := r.Context()
	currentGen := ""
	for {
		if ctx.Err() != nil {
			return
		}
		path, gen, live := h.Resolver.Generations.Current(channelID, orientation)
		if !live {
			select {
			case <-ctx.Done():
				return
			case <-time.After(previewPollInterval):
			}
			continue
		}
		currentGen = gen

		cmd, stdout, err := h.startPreviewRelay(ctx, path)
		if err != nil {
			h.Log.Warn("could not start preview relay", "channelId", channelID, "orientation", orientation, "error", err.Error())
			select {
			case <-ctx.Done():
				return
			case <-time.After(previewPollInterval):
			}
			continue
		}

		h.copyPreviewUntilGenerationChanges(ctx, w, flusher, stdout, channelID, orientation, currentGen)

		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}
}

// startPreviewRelay spawns a per-viewer ffmpeg that reads one composed
// output over RTSP and remuxes it to MPEG-TS on stdout — -c copy, never a
// re-encode: the compositor already encoded this feed, this only
// repackages it, so it costs a viewer effectively nothing in CPU.
// +resend_headers keeps PAT/PMT reappearing periodically in the output,
// which is what lets a player resync cleanly at the splice point the next
// time this function is called for a new generation, the same way a
// broadcast programme splice works.
func (h *Handler) startPreviewRelay(ctx context.Context, path string) (*exec.Cmd, io.ReadCloser, error) {
	args := []string{
		"-hide_banner", "-loglevel", "warning", "-nostdin",
		"-rtsp_transport", "tcp",
		"-i", h.rtspBase() + "/" + path,
		"-c", "copy",
		"-f", "mpegts", "-mpegts_flags", "+resend_headers", "-flush_packets", "1",
		"pipe:1",
	}
	cmd := exec.CommandContext(ctx, h.Resolver.Config.FFmpegPath, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	go drainPreviewStderr(h.Log, path, stderr)
	return cmd, stdout, nil
}

func drainPreviewStderr(log *slog.Logger, path string, stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		log.Debug("preview relay ffmpeg", "path", path, "line", scanner.Text())
	}
}

type previewReadResult struct {
	buf []byte
	err error
}

// copyPreviewUntilGenerationChanges owns the one goroutine allowed to
// write to w for the duration of one relay process — reading happens on a
// second goroutine that only ever sends over a channel, so there is never
// a risk of two goroutines writing to the same http.ResponseWriter, even
// across the moment a generation change causes this function to return
// and the caller starts a new relay. Returns whenever the relay's own
// stdout ends (the process exited or errored), a newer generation has
// gone live, or the viewer disconnected — the caller decides what to do
// next in each case, this function has no opinion.
func (h *Handler) copyPreviewUntilGenerationChanges(ctx context.Context, w http.ResponseWriter, flusher http.Flusher, stdout io.ReadCloser, channelID, orientation, gen string) {
	results := make(chan previewReadResult)
	done := make(chan struct{})
	defer close(done)
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := stdout.Read(buf)
			var chunk []byte
			if n > 0 {
				chunk = make([]byte, n)
				copy(chunk, buf[:n])
			}
			select {
			case results <- previewReadResult{buf: chunk, err: err}:
			case <-done:
				return
			}
			if err != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(previewPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case res := <-results:
			if len(res.buf) > 0 {
				if _, werr := w.Write(res.buf); werr != nil {
					return
				}
				if flusher != nil {
					flusher.Flush()
				}
			}
			if res.err != nil {
				return
			}
		case <-ticker.C:
			_, curGen, live := h.Resolver.Generations.Current(channelID, orientation)
			if !live || curGen != gen {
				return
			}
		}
	}
}
