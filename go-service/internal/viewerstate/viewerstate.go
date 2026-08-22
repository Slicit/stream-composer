// Package viewerstate builds the payload a viewer needs to render and
// drive the player — the Go, browser-composition-only equivalent of
// server/src/routes/api.js's GET /api/state. There is no server-side
// programme in this deployment (see internal/sourceselector's package doc
// for why): "program.mode" is always "web", and the grid is whatever
// internal/sourceselector places, exactly as compositor.js's own
// comp.mode === 'web' branch already behaved.
package viewerstate

import (
	"context"
	"strings"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/audiomonitor"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/playability"
	"github.com/Slicit/stream-composer/go-service/internal/sourceselector"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

type Settings struct {
	PublicViewing bool `json:"publicViewing"`
}

type Program struct {
	Mode   string `json:"mode"`  // always "web" in this deployment
	Ready  bool   `json:"ready"` // true once at least one source is on air
	Width  int    `json:"width"`
	Height int    `json:"height"`
	GapPx  int    `json:"gapPx"`
}

type Cell struct{ X, Y, W, H int }

type Layout struct {
	Name   string `json:"name"`
	Cols   int    `json:"cols"`
	Rows   int    `json:"rows"`
	Cells  []Cell `json:"cells"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type OnAirEntry struct {
	Key  *string `json:"key"` // playback id, or null when the stream is unconfigured/unpublished
	Name string  `json:"name"`
}

type StreamEntry struct {
	Key       string               `json:"key"` // playback id — the ingest key is deliberately never sent
	Name      string               `json:"name"`
	Live      bool                 `json:"live"`
	HasAudio  bool                 `json:"hasAudio"`
	Problem   *playability.Problem `json:"problem"`
	Path      *string              `json:"path"`
	AudioPath *string              `json:"audioPath"`
}

type State struct {
	Settings   Settings      `json:"settings"`
	Program    Program       `json:"program"`
	Layout     *Layout       `json:"layout"`
	OnAir      []OnAirEntry  `json:"onAir"`
	Streams    []StreamEntry `json:"streams"`
	ServerTime string        `json:"serverTime"`
}

// IngestLister is the one MediaMTX capability Build needs — the same
// narrowing relayrunner/audiomonitor use.
type IngestLister interface {
	ListIngest(ctx context.Context) ([]mediamtx.IngestPath, error)
}

// AudioStatusOf is satisfied by *audiomonitor.Monitor — narrowed to an
// interface so Build is testable without spawning ffmpeg.
type AudioStatusOf interface {
	StatusOf(key string) audiomonitor.Status
}

// Build assembles the full viewer state in one pass: which sources are on
// air, where they go on the grid, and everything the player needs to open
// a WHEP session for each.
func Build(ctx context.Context, store streamstore.Store, mtx IngestLister, checker *playability.Checker, audio AudioStatusOf, comp sourceselector.Composition, ingestPrefix string) (State, error) {
	live, err := mtx.ListIngest(ctx)
	if err != nil {
		return State{}, err
	}

	sources := sourceselector.Select(live, store, comp, ingestPrefix)
	placement := sourceselector.PlanLayout(sources, comp)

	playbackIDByKey := make(map[string]string)
	streamByKey := make(map[string]streamstore.Stream)
	for _, s := range store.Streams() {
		streamByKey[s.Key] = s
		if s.PlaybackID != "" {
			playbackIDByKey[s.Key] = s.PlaybackID
		}
	}

	onAir := make([]OnAirEntry, 0, len(placement.Placed))
	for _, s := range placement.Placed {
		caption := s.Label
		if caption == "" {
			caption = s.Name
		}
		entry := OnAirEntry{Name: caption}
		if pid, ok := playbackIDByKey[s.Key]; ok {
			pid := pid
			entry.Key = &pid
		}
		onAir = append(onAir, entry)
	}

	streamEntries := make([]StreamEntry, 0, len(store.Streams()))
	for _, s := range store.Streams() {
		if !s.Enabled || s.PlaybackID == "" {
			continue
		}
		var liveInfo *mediamtx.IngestPath
		for i := range live {
			if live[i].Key == s.Key {
				liveInfo = &live[i]
				break
			}
		}
		isLive := liveInfo != nil && liveInfo.Ready
		hasAudio := liveInfo != nil && liveInfo.HasAudio

		name := s.Name
		if strings.TrimSpace(s.Nickname) != "" {
			name = strings.TrimSpace(s.Nickname)
		}

		var problem *playability.Problem
		if checker != nil {
			if st := checker.Status(s.Key); st != nil {
				problem = st.Problem
			}
		}

		var hasAudioForViewer bool
		var audioReady bool
		if audio != nil {
			audioReady = audio.StatusOf(s.Key).State == "live"
		}
		hasAudioForViewer = hasAudio && audioReady

		pathVal := "s/" + s.PlaybackID
		audioPathVal := "s/" + s.PlaybackID + "/audio"

		streamEntries = append(streamEntries, StreamEntry{
			Key:       s.PlaybackID,
			Name:      name,
			Live:      isLive,
			HasAudio:  hasAudioForViewer,
			Problem:   problem,
			Path:      &pathVal,
			AudioPath: &audioPathVal,
		})
	}

	var layout *Layout
	if placement.Layout.Layout != "" || len(placement.Layout.Cells) > 0 {
		cells := make([]Cell, len(placement.Layout.Cells))
		for i, c := range placement.Layout.Cells {
			cells[i] = Cell{X: c.X, Y: c.Y, W: c.W, H: c.H}
		}
		layout = &Layout{
			Name: placement.Layout.Layout, Cols: placement.Layout.Cols, Rows: placement.Layout.Rows,
			Cells: cells, Width: placement.Layout.Width, Height: placement.Layout.Height,
		}
	}

	return State{
		Settings: Settings{PublicViewing: store.PublicViewingEnabled()},
		Program: Program{
			Mode:   "web",
			Ready:  len(placement.Placed) > 0,
			Width:  comp.Width,
			Height: comp.Height,
			GapPx:  comp.GapPx,
		},
		Layout:     layout,
		OnAir:      onAir,
		Streams:    streamEntries,
		ServerTime: time.Now().UTC().Format(time.RFC3339),
	}, nil
}
