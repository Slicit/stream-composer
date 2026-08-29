// Package compositionscheduler decides which channel compositions should
// currently be compositing — enabled, at least one member actually live —
// and tells the compositor service (a separate container, see
// internal/compositor's package comment) to start or stop each job
// accordingly, over its small HTTP job API. It never runs ffmpeg itself,
// and it never mutates Store — purely a reconciliation loop, the same
// shape internal/relayrunner's Tick already uses for a very similar
// decision.
//
// A relay destination is deliberately not a precondition for a job to run
// (it once was): the composed output is worth having the moment it's
// enabled and live, even with nothing relayed out yet, because
// internal/mediaproxy's composed-preview HLS mount lets an owner/admin
// pull it up directly (e.g. in VLC) to check it looks right before wiring
// up a real destination.
//
// A source joining or leaving means restarting ffmpeg — it cannot add or
// remove a filtergraph input from a running process — and a straight
// restart under one fixed output path is worse for an already-connected
// viewer than the outage itself suggests: MediaMTX's LL-HLS reader
// sessions are scoped to a specific publisher instance, so the moment the
// old ffmpeg process is replaced, an already-open session doesn't just
// stall, it dies outright (confirmed live — the exact same session URL
// that returned 200 before a restart returns 401 afterward, forever).
// Tick instead debounces a config change (mirrors the pre-migration
// compositor.js's own "stabilize" delay, so a source flapping in and out
// doesn't thrash the encoder) and then drives a *warm handoff*: the new
// configuration starts under its own generation-scoped MediaMTX path
// (composed/<channelId>/<orientation>/g<N>, see Generations) while the
// previous generation, if any, keeps running untouched — only once the
// new one is confirmed live does Generations flip to it, and only after a
// grace period does the old generation actually stop, giving an
// already-connected viewer's player time to naturally revisit the
// top-level playlist and pick up the new generation on its own rather
// than losing video the instant the swap happens.
package compositionscheduler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

// IngestLister is the one MediaMTX capability Tick needs — narrowed to an
// interface so it can be faked in tests, same pattern as relayrunner's own.
type IngestLister interface {
	ListIngest(ctx context.Context) ([]mediamtx.IngestPath, error)
}

// jobID is this composition's stable logical identifier — the tail of its
// base output path (composed/<channelId>/<orientation>) — used as the map
// key for every piece of per-composition state Tick tracks. It is never
// itself sent to the compositor service as a job id once a generation has
// started (see warmState.genID) — only the very shape "<channelId>/
// <orientation>" other packages (relayrunner) still build directly.
func jobID(channelID, orientation string) string {
	return channelID + "/" + orientation
}

// splitID reverses jobID. channelID is always a UUID, so it never itself
// contains "/" — the first one is unambiguously the separator.
func splitID(id string) (channelID, orientation string) {
	parts := strings.SplitN(id, "/", 2)
	if len(parts) != 2 {
		return id, ""
	}
	return parts[0], parts[1]
}

// OutputPath is the base MediaMTX path a composition's job publishes to,
// before any generation suffix — exported so internal/relayrunner and
// internal/mediaproxy can fall back to it (via Generations.CurrentPath)
// before any generation has ever gone live.
func OutputPath(cfg config.Config, channelID, orientation string) string {
	return cfg.ComposedPrefix + "/" + jobID(channelID, orientation)
}

type apiSource struct {
	Path  string `json:"path"`
	Label string `json:"label"`
}

type apiOptions struct {
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	FPS         int    `json:"fps"`
	BitrateKbps int    `json:"bitrateKbps"`
	Preset      string `json:"preset"`
	Encoder     string `json:"encoder"`
	Background  string `json:"background"`
	Labels      bool   `json:"labels"`
	LabelSize   int    `json:"labelSize"`
	OutputPath  string `json:"outputPath"`
	Orientation string `json:"orientation"`
}

type startJobRequest struct {
	ID      string      `json:"id"`
	Sources []apiSource `json:"sources"`
	Options apiOptions  `json:"options"`
}

type jobStatusResponse struct {
	State string `json:"state"`
}

// warmState is a generation that's been requested but not yet confirmed
// live — sig is what it's for, so a superseding config change (one that
// arrives before this generation ever gets the chance to go live) can be
// detected and the attempt abandoned rather than handed off to.
type warmState struct {
	genID      string
	gen        string // e.g. "5" — the bare number, matching Generations' own shape
	outputPath string
	sig        string
}

// drainEntry is a generation that was handed off away from, kept running
// only so its already-connected viewers have time to notice and reconnect
// on their own before it actually stops.
type drainEntry struct {
	genID  string
	stopAt time.Time
}

// Scheduler owns every piece of mutable state Tick manages, keyed by a
// composition's logical id (jobID): which generation is currently live and
// what it was started with, any generation still warming up, any old
// generation still draining, and the debounce bookkeeping for a config
// change that hasn't settled yet.
type Scheduler struct {
	Store       streamstore.Store
	MediaMTX    IngestLister
	Config      config.Config
	Log         *slog.Logger
	HTTPClient  *http.Client
	Generations *Generations

	mu              sync.Mutex
	running         map[string]bool
	signatures      map[string]string
	currentGenID    map[string]string
	generationNum   map[string]int
	lastObservedSig map[string]string
	sigChangedAt    map[string]time.Time
	pendingSince    map[string]time.Time
	warming         map[string]*warmState
	draining        map[string][]drainEntry
}

func New(store streamstore.Store, mtx IngestLister, cfg config.Config, log *slog.Logger, gens *Generations) *Scheduler {
	return &Scheduler{
		Store: store, MediaMTX: mtx, Config: cfg, Log: log, Generations: gens,
		running:         make(map[string]bool),
		signatures:      make(map[string]string),
		currentGenID:    make(map[string]string),
		generationNum:   make(map[string]int),
		lastObservedSig: make(map[string]string),
		sigChangedAt:    make(map[string]time.Time),
		pendingSince:    make(map[string]time.Time),
		warming:         make(map[string]*warmState),
		draining:        make(map[string][]drainEntry),
	}
}

func (s *Scheduler) client() *http.Client {
	if s.HTTPClient != nil {
		return s.HTTPClient
	}
	return http.DefaultClient
}

func (s *Scheduler) stabilizeInterval() time.Duration {
	if s.Config.CompositionStabilizeMs > 0 {
		return time.Duration(s.Config.CompositionStabilizeMs) * time.Millisecond
	}
	return 5 * time.Second
}

func (s *Scheduler) maxStabilizeWait() time.Duration {
	if s.Config.CompositionMaxStabilizeMs > 0 {
		return time.Duration(s.Config.CompositionMaxStabilizeMs) * time.Millisecond
	}
	return 20 * time.Second
}

func (s *Scheduler) drainGrace() time.Duration {
	if s.Config.CompositionDrainMs > 0 {
		return time.Duration(s.Config.CompositionDrainMs) * time.Millisecond
	}
	return 20 * time.Second
}

// Start runs Tick immediately and then on every interval, until stop is
// closed — mirrors relayrunner.Runner.Start.
func (s *Scheduler) Start(ctx context.Context, interval time.Duration, stop <-chan struct{}) {
	s.Tick(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			s.Tick(ctx)
		}
	}
}

// liveSources resolves a channel's currently-live members, in the
// channel's own StreamIDs order — what the compositor should composite,
// same ordering rule server/src/compositor.js's selectSources() used.
func liveSources(channel streamstore.Channel, streamByID map[string]streamstore.Stream, liveKeys map[string]bool, ingestPrefix string) []apiSource {
	var out []apiSource
	for _, sid := range channel.StreamIDs {
		st, ok := streamByID[sid]
		if !ok || !st.Enabled || !liveKeys[st.Key] {
			continue
		}
		label := st.Nickname
		if label == "" {
			label = st.Name
		}
		out = append(out, apiSource{Path: ingestPrefix + "/" + st.Key, Label: label})
	}
	return out
}

func signatureOf(sources []apiSource, comp streamstore.ChannelComposition) string {
	var b strings.Builder
	for _, s := range sources {
		b.WriteString(s.Path)
		b.WriteByte('\x00')
		b.WriteString(s.Label)
		b.WriteByte('\x00')
	}
	fmt.Fprintf(&b, "|%d|%d|%d|%d|%s|%s|%s|%v|%d",
		comp.Width, comp.Height, comp.FPS, comp.BitrateKbps, comp.Preset, comp.Encoder, comp.Background, comp.Labels, comp.LabelSize)
	return b.String()
}

// Tick is one reconciliation pass: every enabled composition with a live
// member should have a job running; everything else should not.
func (s *Scheduler) Tick(ctx context.Context) {
	compositions := s.Store.ChannelCompositions()

	channelByID := make(map[string]streamstore.Channel)
	for _, c := range s.Store.Channels() {
		channelByID[c.ID] = c
	}
	streamByID := make(map[string]streamstore.Stream)
	for _, st := range s.Store.Streams() {
		streamByID[st.ID] = st
	}

	var liveKeys map[string]bool
	if len(compositions) > 0 {
		live, err := s.MediaMTX.ListIngest(ctx)
		if err != nil {
			s.Log.Debug("could not read the stream list", "error", err.Error())
			return
		}
		liveKeys = make(map[string]bool, len(live))
		for _, l := range live {
			if l.Ready {
				liveKeys[l.Key] = true
			}
		}
	}

	now := time.Now()
	wanted := make(map[string]bool, len(compositions))
	for _, comp := range compositions {
		id := jobID(comp.ChannelID, comp.Orientation)
		if !comp.Enabled {
			continue
		}
		channel, ok := channelByID[comp.ChannelID]
		if !ok {
			continue
		}
		sources := liveSources(channel, streamByID, liveKeys, s.Config.IngestPrefix)
		if len(sources) == 0 {
			continue
		}
		wanted[id] = true
		s.reconcileOne(ctx, id, comp, sources, signatureOf(sources, comp), now)
	}

	s.processDraining(ctx, now)
	s.cancelUnwanted(ctx, wanted)
	s.stopUnwanted(ctx, wanted)
}

// reconcileOne handles one composition that should currently be running,
// for exactly one Tick.
func (s *Scheduler) reconcileOne(ctx context.Context, id string, comp streamstore.ChannelComposition, sources []apiSource, sig string, now time.Time) {
	s.mu.Lock()
	w := s.warming[id]
	liveRunning := s.running[id]
	liveSig := s.signatures[id]
	s.mu.Unlock()

	if w != nil {
		if w.sig == sig {
			s.checkWarmupReady(ctx, id, w, now)
			return
		}
		// Superseded before it ever got the chance to go live — abandon
		// it and fall through to (re)debounce for the newer signature.
		s.mu.Lock()
		delete(s.warming, id)
		s.mu.Unlock()
		if err := s.stopJob(ctx, w.genID); err != nil {
			s.Log.Warn("could not cancel a superseded warming compositor generation", "id", w.genID, "error", err.Error())
		}
	}

	if liveRunning && liveSig == sig {
		s.mu.Lock()
		delete(s.pendingSince, id)
		delete(s.sigChangedAt, id)
		delete(s.lastObservedSig, id)
		s.mu.Unlock()
		return // steady state
	}

	s.mu.Lock()
	if s.lastObservedSig[id] != sig {
		s.lastObservedSig[id] = sig
		s.sigChangedAt[id] = now
		if s.pendingSince[id].IsZero() {
			s.pendingSince[id] = now
		}
	}
	changedAt := s.sigChangedAt[id]
	pendingSince := s.pendingSince[id]
	s.mu.Unlock()

	settled := now.Sub(changedAt) >= s.stabilizeInterval()
	forced := !pendingSince.IsZero() && now.Sub(pendingSince) >= s.maxStabilizeWait()
	if !settled && !forced {
		return // still debouncing — a source flapping shouldn't thrash the encoder
	}

	s.startWarmup(ctx, id, comp, sources, sig)
}

func (s *Scheduler) startWarmup(ctx context.Context, id string, comp streamstore.ChannelComposition, sources []apiSource, sig string) {
	s.mu.Lock()
	s.generationNum[id]++
	gen := s.generationNum[id]
	s.mu.Unlock()

	channelID, orientation := splitID(id)
	genStr := strconv.Itoa(gen)
	genID := id + "/g" + genStr
	outputPath := GenerationOutputPath(s.Config, channelID, orientation, genStr)

	if err := s.startJob(ctx, genID, outputPath, sources, comp); err != nil {
		s.Log.Warn("could not start a compositor generation", "id", genID, "error", err.Error())
		return
	}
	s.mu.Lock()
	s.warming[id] = &warmState{genID: genID, gen: genStr, outputPath: outputPath, sig: sig}
	delete(s.pendingSince, id)
	delete(s.sigChangedAt, id)
	delete(s.lastObservedSig, id)
	s.mu.Unlock()
	s.Log.Info("compositor generation starting", "id", genID, "sources", len(sources))
}

// checkWarmupReady polls a warming generation's status; once it reports
// live, Generations flips to it (so every *new* reader resolves to it
// immediately) and the previous generation, if any, is scheduled to drain
// rather than stopped on the spot.
func (s *Scheduler) checkWarmupReady(ctx context.Context, id string, w *warmState, now time.Time) {
	state, err := s.jobStatus(ctx, w.genID)
	if err != nil {
		s.Log.Debug("could not check a warming compositor generation's status", "id", w.genID, "error", err.Error())
		return
	}
	if state != "live" {
		return
	}

	s.mu.Lock()
	oldGenID := s.currentGenID[id]
	s.running[id] = true
	s.signatures[id] = w.sig
	s.currentGenID[id] = w.genID
	delete(s.warming, id)
	if oldGenID != "" && oldGenID != w.genID {
		s.draining[id] = append(s.draining[id], drainEntry{genID: oldGenID, stopAt: now.Add(s.drainGrace())})
	}
	s.mu.Unlock()

	channelID, orientation := splitID(id)
	s.Generations.Set(channelID, orientation, w.outputPath, w.gen)
	s.Log.Info("compositor generation live — handoff complete", "id", w.genID, "previousId", oldGenID)
}

// processDraining stops any old generation whose grace period has elapsed
// — independent of whether its composition is still wanted at all, since
// a drain that's already in flight should run to its own schedule either
// way.
func (s *Scheduler) processDraining(ctx context.Context, now time.Time) {
	s.mu.Lock()
	var due []string
	for id, entries := range s.draining {
		var remaining []drainEntry
		for _, e := range entries {
			if now.Before(e.stopAt) {
				remaining = append(remaining, e)
				continue
			}
			due = append(due, e.genID)
		}
		if len(remaining) == 0 {
			delete(s.draining, id)
		} else {
			s.draining[id] = remaining
		}
	}
	s.mu.Unlock()

	for _, genID := range due {
		if err := s.stopJob(ctx, genID); err != nil {
			s.Log.Warn("could not stop a drained compositor generation", "id", genID, "error", err.Error())
			continue
		}
		s.Log.Info("drained compositor generation stopped", "id", genID)
	}
}

// cancelUnwanted stops any in-flight warm-up for a composition that isn't
// wanted at all this tick (disabled, or nothing live) — nobody could be
// watching a generation that never went live, so there's nothing to drain,
// only to cancel outright.
func (s *Scheduler) cancelUnwanted(ctx context.Context, wanted map[string]bool) {
	s.mu.Lock()
	var toCancel []*warmState
	for id, w := range s.warming {
		if wanted[id] {
			continue
		}
		toCancel = append(toCancel, w)
		delete(s.warming, id)
		delete(s.pendingSince, id)
		delete(s.sigChangedAt, id)
		delete(s.lastObservedSig, id)
	}
	s.mu.Unlock()

	for _, w := range toCancel {
		if err := s.stopJob(ctx, w.genID); err != nil {
			s.Log.Warn("could not cancel a warming compositor generation", "id", w.genID, "error", err.Error())
		}
	}
}

// stopUnwanted tears down the live generation for any composition that
// isn't wanted at all this tick — the final shutdown, not a handoff, so
// unlike processDraining this stops immediately: there is no new
// generation to protect an already-connected viewer's session in favor
// of.
func (s *Scheduler) stopUnwanted(ctx context.Context, wanted map[string]bool) {
	s.mu.Lock()
	var toStop []string
	for id := range s.running {
		if !wanted[id] {
			toStop = append(toStop, id)
		}
	}
	s.mu.Unlock()

	for _, id := range toStop {
		s.mu.Lock()
		genID := s.currentGenID[id]
		s.mu.Unlock()

		if err := s.stopJob(ctx, genID); err != nil {
			s.Log.Warn("could not stop a compositor generation", "id", genID, "error", err.Error())
			continue
		}
		s.mu.Lock()
		delete(s.running, id)
		delete(s.signatures, id)
		delete(s.currentGenID, id)
		delete(s.generationNum, id)
		s.mu.Unlock()

		channelID, orientation := splitID(id)
		s.Generations.Clear(channelID, orientation)
		s.Log.Info("compositor generation stopped", "id", genID)
	}
}

func (s *Scheduler) apiBase() string {
	return strings.TrimSuffix(s.Config.CompositorAPI, "/")
}

func (s *Scheduler) startJob(ctx context.Context, id, outputPath string, sources []apiSource, comp streamstore.ChannelComposition) error {
	body := startJobRequest{
		ID:      id,
		Sources: sources,
		Options: apiOptions{
			Width: comp.Width, Height: comp.Height, FPS: comp.FPS, BitrateKbps: comp.BitrateKbps,
			Preset: comp.Preset, Encoder: comp.Encoder, Background: comp.Background,
			Labels: comp.Labels, LabelSize: comp.LabelSize,
			OutputPath:  outputPath,
			Orientation: comp.Orientation,
		},
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.apiBase()+"/jobs", bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return s.do(req)
}

func (s *Scheduler) stopJob(ctx context.Context, id string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, s.apiBase()+"/jobs/"+id, nil)
	if err != nil {
		return err
	}
	return s.do(req)
}

func (s *Scheduler) jobStatus(ctx context.Context, id string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.apiBase()+"/jobs/"+id, nil)
	if err != nil {
		return "", err
	}
	res, err := s.client().Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("compositor returned %d", res.StatusCode)
	}
	var sr jobStatusResponse
	if err := json.NewDecoder(res.Body).Decode(&sr); err != nil {
		return "", err
	}
	return sr.State, nil
}

func (s *Scheduler) do(req *http.Request) error {
	res, err := s.client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 1024))
		return fmt.Errorf("compositor returned %d: %s", res.StatusCode, strings.TrimSpace(string(msg)))
	}
	return nil
}
