package relayrunner

import (
	"bufio"
	"context"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

func (r *Runner) statusLocked(relayID string) *Status {
	s, ok := r.health[relayID]
	if !ok {
		s = &Status{State: "off"}
		r.health[relayID] = s
	}
	return s
}

func (r *Runner) resetBackoffLocked(relayID string) {
	delete(r.backoff, relayID)
}

// Tick is one reconciliation pass — the direct port of relays.js's tick().
// Safe to call on an interval; only touches what actually changed.
func (r *Runner) Tick(ctx context.Context) {
	relays := r.Store.Relays()
	wanted := make(map[string]streamstore.Relay, len(relays))
	byID := make(map[string]streamstore.Relay, len(relays))
	for _, rl := range relays {
		byID[rl.ID] = rl
		if rl.Enabled {
			wanted[rl.ID] = rl
		}
	}

	r.mu.Lock()
	// Anything running that should not be — switched off, deleted, reassigned.
	for id := range r.running {
		if _, ok := wanted[id]; !ok {
			r.stopLocked(id, "no longer wanted")
		}
	}
	// Forget health for relays that no longer exist at all.
	for id := range r.health {
		if _, ok := byID[id]; !ok {
			delete(r.health, id)
			delete(r.backoff, id)
		}
	}
	for id, rl := range byID {
		if !rl.Enabled {
			s := r.statusLocked(id)
			s.State = "off"
			s.Since = time.Time{}
		}
	}
	r.mu.Unlock()

	if len(wanted) == 0 {
		return
	}

	live, err := r.MediaMTX.ListIngest(ctx)
	if err != nil {
		r.Log.Debug("could not read the stream list", "error", err.Error())
		return
	}
	liveKeys := make(map[string]bool, len(live))
	for _, ip := range live {
		if ip.Ready {
			liveKeys[ip.Key] = true
		}
	}

	channelByID := make(map[string]streamstore.Channel)
	for _, c := range r.Store.Channels() {
		channelByID[c.ID] = c
	}
	streamByID := make(map[string]streamstore.Stream)
	for _, st := range r.Store.Streams() {
		streamByID[st.ID] = st
	}

	for id, rl := range wanted {
		sourcePath, unavailableReason, waitingReason := r.resolveSource(rl, channelByID, streamByID, liveKeys)

		r.mu.Lock()
		s := r.statusLocked(id)

		if unavailableReason != "" {
			r.stopLocked(id, unavailableReason)
			s.State = "off"
			r.mu.Unlock()
			continue
		}
		if waitingReason != "" {
			// The source is not publishing (or, for a composition relay,
			// none of the channel's members are). Not a failure, so no
			// backoff — a reconnect should resume immediately.
			if _, running := r.running[id]; running {
				r.stopLocked(id, waitingReason)
			}
			s.State = "waiting"
			s.Since = time.Time{}
			r.resetBackoffLocked(id)
			r.mu.Unlock()
			continue
		}
		if _, running := r.running[id]; running {
			r.mu.Unlock()
			continue
		}
		if retryAt, has := r.retryAtLocked(id); has && time.Now().Before(retryAt) {
			r.mu.Unlock()
			continue
		}
		r.mu.Unlock()

		r.startOne(rl, sourcePath)
	}
}

// resolveSource works out the RTSP path a relay should read from, and
// whether it can right now — a raw stream (StreamID set) reads its own
// ingest path; a channel composition's output (ChannelCompositionID set)
// reads the compositor's composed/<channelId>/<orientation> path, "live"
// meaning the channel has at least one live member (the compositor
// service itself decides, independently, whether to actually be
// publishing there — see internal/compositionscheduler; this only decides
// whether relaying it onward is worth attempting).
func (r *Runner) resolveSource(rl streamstore.Relay, channelByID map[string]streamstore.Channel, streamByID map[string]streamstore.Stream, liveKeys map[string]bool) (sourcePath, unavailableReason, waitingReason string) {
	if rl.StreamID != "" {
		stream, ok := streamByID[rl.StreamID]
		if !ok || !stream.Enabled {
			return "", "the source stream is unavailable", ""
		}
		if !liveKeys[stream.Key] {
			return "", "", "the source stopped publishing"
		}
		return r.Config.IngestPrefix + "/" + stream.Key, "", ""
	}

	comp, ok := r.Store.FindChannelCompositionByID(rl.ChannelCompositionID)
	if !ok || !comp.Enabled {
		return "", "the channel composition is unavailable", ""
	}
	channel, ok := channelByID[comp.ChannelID]
	if !ok || !channelHasLiveMember(channel, streamByID, liveKeys) {
		return "", "", "the channel has no live member"
	}
	// Never the base, non-generation path — the compositor only ever
	// publishes to a generation-scoped one (see
	// internal/compositionscheduler.Generations' own doc comment on why),
	// so a live member alone isn't enough; the compositor also has to have
	// actually gone live for this composition yet.
	if r.Generations == nil {
		return "", "", "the composed output is not live yet"
	}
	path, _, live := r.Generations.Current(comp.ChannelID, comp.Orientation)
	if !live {
		return "", "", "the composed output is not live yet"
	}
	return path, "", ""
}

func channelHasLiveMember(channel streamstore.Channel, streamByID map[string]streamstore.Stream, liveKeys map[string]bool) bool {
	for _, sid := range channel.StreamIDs {
		st, ok := streamByID[sid]
		if ok && st.Enabled && liveKeys[st.Key] {
			return true
		}
	}
	return false
}

// retryAtLocked and the map it reads live alongside backoff (delay), since
// both are consulted/reset together; kept in Status for simplicity.
func (r *Runner) retryAtLocked(relayID string) (time.Time, bool) {
	s, ok := r.health[relayID]
	if !ok || s.RetryAt.IsZero() {
		return time.Time{}, false
	}
	return s.RetryAt, true
}

// stopLocked must be called with r.mu held.
func (r *Runner) stopLocked(relayID, reason string) {
	proc, ok := r.running[relayID]
	if !ok {
		return
	}
	delete(r.running, relayID)
	s := r.statusLocked(relayID)
	s.State = "off"
	s.Since = time.Time{}
	r.Log.Info("forwarding halted", "id", relayID, "reason", reason)
	_ = proc.cmd.Process.Signal(syscall.SIGTERM)
	go func(p *exec.Cmd) {
		time.Sleep(3 * time.Second)
		_ = p.Process.Kill()
	}(proc.cmd)
}

// scheduleRetryLocked backs off after a failure — a rejected stream key
// fails instantly and forever, so without this one typo becomes an ffmpeg
// spawn every couple of seconds. Must be called with r.mu held.
func (r *Runner) scheduleRetryLocked(relayID, reason string) {
	s := r.statusLocked(relayID)
	s.Restarts++
	delay := r.backoff[relayID]
	if delay == 0 {
		delay = time.Duration(r.Config.RestartDelayMs) * time.Millisecond
	} else {
		delay *= 2
		max := time.Duration(r.Config.MaxRestartDelayMs) * time.Millisecond
		if delay > max {
			delay = max
		}
	}
	r.backoff[relayID] = delay
	s.RetryAt = time.Now().Add(delay)
	s.State = "retrying"
	r.Log.Debug("will retry a destination", "id", relayID, "reason", reason, "inMs", delay.Milliseconds())
}

func (r *Runner) startOne(relay streamstore.Relay, sourcePath string) {
	args := r.buildArgs(relay, sourcePath)
	cmd := exec.Command(r.Config.FFmpegPath, args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		r.Log.Warn("could not attach to ffmpeg stdout", "relay", relay.ID, "error", err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		r.Log.Warn("could not attach to ffmpeg stderr", "relay", relay.ID, "error", err.Error())
		return
	}

	if err := cmd.Start(); err != nil {
		r.mu.Lock()
		s := r.statusLocked(relay.ID)
		s.LastErr = err.Error()
		r.scheduleRetryLocked(relay.ID, "ffmpeg could not be started")
		r.mu.Unlock()
		return
	}

	r.Log.Info("forwarding started", "relay", relay.Name, "provider", relay.Provider, "from", sourcePath, "audio", relay.Audio)

	r.mu.Lock()
	r.running[relay.ID] = &runningProc{cmd: cmd, relayID: relay.ID}
	s := r.statusLocked(relay.ID)
	s.State = "connecting"
	s.Since = time.Now()
	s.LastErr = ""
	r.mu.Unlock()

	sawData := false
	go r.readProgress(relay.ID, stdout, &sawData)
	go r.readStderr(relay, stderr)

	go func() {
		err := cmd.Wait()

		r.mu.Lock()
		defer r.mu.Unlock()
		current, stillTracked := r.running[relay.ID]
		if !stillTracked || current.cmd != cmd {
			return // superseded by a newer process for the same relay
		}
		delete(r.running, relay.ID)
		if err == nil {
			// A clean exit with no signal from us is still unexpected —
			// ffmpeg does not stop on its own while its input is live.
			r.scheduleRetryLocked(relay.ID, "ffmpeg exited")
			return
		}
		r.scheduleRetryLocked(relay.ID, "ffmpeg exited: "+err.Error())
	}()
}

func (r *Runner) readProgress(relayID string, stdout io.Reader, sawData *bool) {
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		idx := strings.IndexByte(line, '=')
		if idx < 0 {
			continue
		}
		key, value := line[:idx], strings.TrimSpace(line[idx+1:])
		if key == "total_size" {
			if bytes, err := strconv.ParseInt(value, 10, 64); err == nil && bytes > 0 && !*sawData {
				*sawData = true
				r.mu.Lock()
				if s, ok := r.health[relayID]; ok && s.State != "live" {
					s.State = "live"
					r.resetBackoffLocked(relayID)
				}
				r.mu.Unlock()
			}
		}
	}
}

func (r *Runner) readStderr(relay streamstore.Relay, stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		text := scanner.Text()
		// The destination URL contains the stream key and ffmpeg echoes it
		// in errors, so scrub it before anything reaches the log.
		if relay.Key != "" {
			text = strings.ReplaceAll(text, relay.Key, "•••")
		}
		r.Log.Debug("ffmpeg", "relay", relay.Name, "line", text)
		if trimmed := strings.TrimSpace(text); trimmed != "" {
			r.mu.Lock()
			r.statusLocked(relay.ID).LastErr = trimmed
			r.mu.Unlock()
		}
	}
}
