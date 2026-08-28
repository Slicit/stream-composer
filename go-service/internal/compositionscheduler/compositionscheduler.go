// Package compositionscheduler decides which channel compositions should
// currently be compositing — enabled, at least one member actually live,
// at least one relay destination enabled — and tells the compositor
// service (a separate container, see internal/compositor's package
// comment) to start or stop each job accordingly, over its small HTTP
// job API. It never runs ffmpeg itself, and it never mutates Store —
// purely a reconciliation loop, the same shape internal/relayrunner's
// Tick already uses for a very similar decision.
package compositionscheduler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
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

// jobID is the compositor service's own job identifier and the tail of its
// output path (composed/<channelId>/<orientation>) — one canonical shape
// used everywhere a composition needs naming.
func jobID(channelID, orientation string) string {
	return channelID + "/" + orientation
}

// OutputPath is the MediaMTX path a composition's job publishes to —
// exported so internal/relayrunner can resolve the same value for a
// ChannelCompositionID relay's source, without this package and that one
// needing to agree on the shape any other way than calling this function.
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
}

type startJobRequest struct {
	ID      string      `json:"id"`
	Sources []apiSource `json:"sources"`
	Options apiOptions  `json:"options"`
}

// Scheduler owns exactly the mutable state Tick manages: which job ids it
// currently believes are running, and the signature (source list + config)
// each was last started with, so an unchanged composition is never
// restarted on every poll — only the process supervisor
// (internal/compositor.Runner) restarts on its own for a crash; nothing
// here should mimic that.
type Scheduler struct {
	Store      streamstore.Store
	MediaMTX   IngestLister
	Config     config.Config
	Log        *slog.Logger
	HTTPClient *http.Client

	mu         sync.Mutex
	running    map[string]bool
	signatures map[string]string
}

func New(store streamstore.Store, mtx IngestLister, cfg config.Config, log *slog.Logger) *Scheduler {
	return &Scheduler{
		Store: store, MediaMTX: mtx, Config: cfg, Log: log,
		running:    make(map[string]bool),
		signatures: make(map[string]string),
	}
}

func (s *Scheduler) client() *http.Client {
	if s.HTTPClient != nil {
		return s.HTTPClient
	}
	return http.DefaultClient
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
// member and at least one enabled destination should have a job running;
// everything else should not.
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
	hasEnabledDestination := make(map[string]bool)
	for _, r := range s.Store.Relays() {
		if r.ChannelCompositionID != "" && r.Enabled {
			hasEnabledDestination[r.ChannelCompositionID] = true
		}
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

	wanted := make(map[string]bool, len(compositions))
	for _, comp := range compositions {
		id := jobID(comp.ChannelID, comp.Orientation)
		if !comp.Enabled || !hasEnabledDestination[comp.ID] {
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
		sig := signatureOf(sources, comp)

		s.mu.Lock()
		unchanged := s.running[id] && s.signatures[id] == sig
		s.mu.Unlock()
		if unchanged {
			continue
		}

		if err := s.startJob(ctx, id, sources, comp); err != nil {
			s.Log.Warn("could not start a compositor job", "id", id, "error", err.Error())
			continue
		}
		s.mu.Lock()
		s.running[id] = true
		s.signatures[id] = sig
		s.mu.Unlock()
		s.Log.Info("compositor job requested", "id", id, "sources", len(sources))
	}

	s.mu.Lock()
	var toStop []string
	for id := range s.running {
		if !wanted[id] {
			toStop = append(toStop, id)
		}
	}
	s.mu.Unlock()

	for _, id := range toStop {
		if err := s.stopJob(ctx, id); err != nil {
			s.Log.Warn("could not stop a compositor job", "id", id, "error", err.Error())
			continue
		}
		s.mu.Lock()
		delete(s.running, id)
		delete(s.signatures, id)
		s.mu.Unlock()
		s.Log.Info("compositor job stopped", "id", id)
	}
}

func (s *Scheduler) apiBase() string {
	return strings.TrimSuffix(s.Config.CompositorAPI, "/")
}

func (s *Scheduler) startJob(ctx context.Context, id string, sources []apiSource, comp streamstore.ChannelComposition) error {
	body := startJobRequest{
		ID:      id,
		Sources: sources,
		Options: apiOptions{
			Width: comp.Width, Height: comp.Height, FPS: comp.FPS, BitrateKbps: comp.BitrateKbps,
			Preset: comp.Preset, Encoder: comp.Encoder, Background: comp.Background,
			Labels: comp.Labels, LabelSize: comp.LabelSize,
			OutputPath: OutputPath(s.Config, comp.ChannelID, comp.Orientation),
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
