package audiomonitor

import (
	"bufio"
	"context"
	"io"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

func (m *Monitor) statusLocked(key string) *Status {
	s, ok := m.health[key]
	if !ok {
		s = &Status{State: "off"}
		m.health[key] = s
	}
	return s
}

func (m *Monitor) resetBackoffLocked(key string) {
	delete(m.backoff, key)
}

// Tick is one reconciliation pass — the direct port of audioRelay.js's
// tick(). Safe to call on an interval; only touches what actually changed.
func (m *Monitor) Tick(ctx context.Context) {
	live, err := m.MediaMTX.ListIngest(ctx)
	if err != nil {
		m.Log.Debug("could not read the stream list", "error", err.Error())
		return
	}
	wanted := make(map[string]bool, len(live))
	for _, ip := range live {
		if ip.Ready && ip.HasAudio {
			wanted[ip.Key] = true
		}
	}

	m.mu.Lock()
	for key := range m.running {
		if !wanted[key] {
			m.stopLocked(key, "source stopped publishing or lost its audio track")
		}
	}
	for key := range m.health {
		if _, running := m.running[key]; !wanted[key] && !running {
			delete(m.health, key)
			delete(m.backoff, key)
		}
	}

	toStart := make([]string, 0, len(wanted))
	for key := range wanted {
		if _, running := m.running[key]; running {
			continue
		}
		if retryAt, has := m.retryAtLocked(key); has && time.Now().Before(retryAt) {
			continue
		}
		toStart = append(toStart, key)
	}
	m.mu.Unlock()

	for _, key := range toStart {
		m.startOne(key)
	}
}

func (m *Monitor) retryAtLocked(key string) (time.Time, bool) {
	s, ok := m.health[key]
	if !ok || s.RetryAt.IsZero() {
		return time.Time{}, false
	}
	return s.RetryAt, true
}

// stopLocked must be called with m.mu held.
func (m *Monitor) stopLocked(key, reason string) {
	proc, ok := m.running[key]
	if !ok {
		return
	}
	delete(m.running, key)
	s := m.statusLocked(key)
	s.State = "off"
	s.Since = time.Time{}
	m.Log.Info("audio transcode halted", "key", key, "reason", reason)
	_ = proc.cmd.Process.Signal(syscall.SIGTERM)
	go func(p *exec.Cmd) {
		time.Sleep(3 * time.Second)
		_ = p.Process.Kill()
	}(proc.cmd)
}

// scheduleRetryLocked must be called with m.mu held.
func (m *Monitor) scheduleRetryLocked(key, reason string) {
	s := m.statusLocked(key)
	s.Restarts++
	delay := m.backoff[key]
	if delay == 0 {
		delay = time.Duration(m.Config.RestartDelayMs) * time.Millisecond
	} else {
		delay *= 2
		max := time.Duration(m.Config.MaxRestartDelayMs) * time.Millisecond
		if delay > max {
			delay = max
		}
	}
	m.backoff[key] = delay
	s.RetryAt = time.Now().Add(delay)
	s.State = "retrying"
	m.Log.Debug("will retry an audio transcode", "key", key, "reason", reason, "inMs", delay.Milliseconds())
}

func (m *Monitor) startOne(key string) {
	args := m.buildArgs(key)
	cmd := exec.Command(m.Config.FFmpegPath, args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.Log.Warn("could not attach to ffmpeg stdout", "key", key, "error", err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		m.Log.Warn("could not attach to ffmpeg stderr", "key", key, "error", err.Error())
		return
	}

	if err := cmd.Start(); err != nil {
		m.mu.Lock()
		s := m.statusLocked(key)
		s.LastErr = err.Error()
		m.scheduleRetryLocked(key, "ffmpeg could not be started")
		m.mu.Unlock()
		return
	}

	m.Log.Info("audio transcode started", "key", key)

	m.mu.Lock()
	m.running[key] = &runningProc{cmd: cmd, key: key}
	s := m.statusLocked(key)
	s.State = "connecting"
	s.Since = time.Now()
	s.LastErr = ""
	m.mu.Unlock()

	sawData := false
	go m.readProgress(key, stdout, &sawData)
	go m.readStderr(key, stderr)

	go func() {
		err := cmd.Wait()

		m.mu.Lock()
		defer m.mu.Unlock()
		current, stillTracked := m.running[key]
		if !stillTracked || current.cmd != cmd {
			return // superseded by a newer process for the same key
		}
		delete(m.running, key)
		if err == nil {
			m.scheduleRetryLocked(key, "ffmpeg exited")
			return
		}
		m.scheduleRetryLocked(key, "ffmpeg exited: "+err.Error())
	}()
}

func (m *Monitor) readProgress(key string, stdout io.Reader, sawData *bool) {
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "out_time_ms=") && !*sawData {
			*sawData = true
			m.mu.Lock()
			if s, ok := m.health[key]; ok && s.State != "live" {
				s.State = "live"
				m.resetBackoffLocked(key)
			}
			m.mu.Unlock()
		}
	}
}

func (m *Monitor) readStderr(key string, stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		text := scanner.Text()
		m.Log.Debug("ffmpeg", "key", key, "line", text)
		if trimmed := strings.TrimSpace(text); trimmed != "" {
			m.mu.Lock()
			m.statusLocked(key).LastErr = trimmed
			m.mu.Unlock()
		}
	}
}
