// Package playability answers "can a source be played straight to a
// browser?" Browsers freeze when presentation timestamps stop increasing,
// so MediaMTX refuses to serve H.264 containing B-frames over WebRTC — it
// accepts the publish, then closes every playback session with "WebRTC
// doesn't support H264 streams with B-frames." The viewer sees a black
// rectangle and nothing explains why.
//
// It never mattered while every viewer watched the composed programme:
// ffmpeg re-encodes, and the compositor's own settings emit no B-frames.
// It matters the moment a browser reads a source directly — web
// composition, and the per-source preview buttons in either mode.
//
// B-frames are not visible in MediaMTX's track list, so this probes the
// stream once per publishing session with ffprobe and remembers the
// answer. Ported field-for-field from server/src/playability.js.
package playability

import (
	"context"
	"encoding/json"
	"os/exec"
	"strconv"
	"sync"
	"time"
)

const probeTimeout = 8 * time.Second

type Info struct {
	Codec   string
	Profile string
	BFrames int
}

type Problem struct {
	Code    string `json:"code"`
	Summary string `json:"summary"`
	Fix     string `json:"fix"`
}

func ReasonFor(info *Info) *Problem {
	if info == nil {
		return nil
	}
	if info.BFrames > 0 {
		return &Problem{
			Code:    "b-frames",
			Summary: "This encoder is producing B-frames, which browsers cannot play over WebRTC.",
			Fix:     "In OBS: set Tune to \"zerolatency\", or add bframes=0 to the x264 options — on NVENC or QuickSync set B-frames to 0. Then restart streaming.",
		}
	}
	return nil
}

type Status struct {
	Codec          string
	Profile        string
	DirectPlayback bool
	Problem        *Problem
}

type cacheEntry struct {
	since    string
	checking bool
	result   *Info
}

// Checker caches a per-source playability verdict, keyed on the source's
// publishing session (its readyTime) so a republish re-probes instead of
// reporting a stale verdict about a stream the operator has just fixed.
type Checker struct {
	FFprobePath string

	mu    sync.Mutex
	cache map[string]*cacheEntry
}

func New(ffprobePath string) *Checker {
	return &Checker{FFprobePath: ffprobePath, cache: make(map[string]*cacheEntry)}
}

// Inspect probes a source unless it has already been checked for this
// publishing session. Never blocks the caller: the verdict lands in the
// cache asynchronously and shows up on the next poll.
func (c *Checker) Inspect(key, url, since string) {
	c.mu.Lock()
	entry, ok := c.cache[key]
	if ok && entry.since == since {
		c.mu.Unlock()
		return
	}
	c.cache[key] = &cacheEntry{since: since, checking: true}
	c.mu.Unlock()

	go func() {
		info := c.runProbe(url)

		c.mu.Lock()
		defer c.mu.Unlock()
		current, ok := c.cache[key]
		// A republish while we were probing invalidates this answer.
		if !ok || current.since != since {
			return
		}
		c.cache[key] = &cacheEntry{since: since, result: info}
	}()
}

// Status is what we know about a source, or nil when it has not been
// probed yet (or the probe is still in flight).
func (c *Checker) Status(key string) *Status {
	c.mu.Lock()
	entry, ok := c.cache[key]
	c.mu.Unlock()
	if !ok || entry.checking || entry.result == nil {
		return nil
	}
	problem := ReasonFor(entry.result)
	return &Status{
		Codec:          entry.result.Codec,
		Profile:        entry.result.Profile,
		DirectPlayback: problem == nil,
		Problem:        problem,
	}
}

// Forget drops everything known about a source — used when it stops
// publishing.
func (c *Checker) Forget(key string) {
	c.mu.Lock()
	delete(c.cache, key)
	c.mu.Unlock()
}

// Keep drops every cached source not present in liveKeys.
func (c *Checker) Keep(liveKeys map[string]bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for key := range c.cache {
		if !liveKeys[key] {
			delete(c.cache, key)
		}
	}
}

type ffprobeStream struct {
	CodecName  string      `json:"codec_name"`
	Profile    string      `json:"profile"`
	HasBFrames json.Number `json:"has_b_frames"`
}

type ffprobeOutput struct {
	Streams []ffprobeStream `json:"streams"`
}

func (c *Checker) runProbe(url string) *Info {
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()

	args := []string{
		"-v", "error",
		"-rtsp_transport", "tcp",
		// Give up rather than hang if the source stalls mid-probe.
		"-rw_timeout", strconv.Itoa(int(probeTimeout / time.Microsecond)),
		"-select_streams", "v:0",
		"-show_entries", "stream=codec_name,profile,has_b_frames",
		"-of", "json",
		url,
	}
	out, err := exec.CommandContext(ctx, c.FFprobePath, args...).Output()
	if err != nil {
		return nil
	}
	var parsed ffprobeOutput
	if err := json.Unmarshal(out, &parsed); err != nil || len(parsed.Streams) == 0 {
		return nil
	}
	s := parsed.Streams[0]
	bFrames, _ := s.HasBFrames.Int64()
	return &Info{Codec: s.CodecName, Profile: s.Profile, BFrames: int(bFrames)}
}
