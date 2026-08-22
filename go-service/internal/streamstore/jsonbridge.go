package streamstore

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"
)

// jsonConfig mirrors just the fields server/src/store.js's config.json ever
// writes that this service cares about.
type jsonConfig struct {
	Streams []struct {
		Key        string   `json:"key"`
		PlaybackID string   `json:"playbackId"`
		Enabled    bool     `json:"enabled"`
		Visibility string   `json:"visibility"`
		OwnerID    string   `json:"ownerId"`
		SharedWith []string `json:"sharedWith"`
	} `json:"streams"`
	Settings struct {
		PublicViewing bool `json:"publicViewing"`
	} `json:"settings"`
}

// JSONBridge polls the legacy JSON config file on an interval and refreshes
// a Memory store from it.
//
// This exists only for the migration window: today there is no Rails
// control plane to ask, so this service reads the same config.json the Node
// backend already writes, to be genuinely runnable and testable end-to-end
// before Rails/Postgres exist. Once the internal API is live, this file is
// deleted and Memory is refreshed from an HTTP client instead — nothing in
// authhook or mediaproxy needs to change either time, since both depend
// only on the Store interface.
type JSONBridge struct {
	Path  string
	Store *Memory
	Log   *slog.Logger
}

// Load reads the file once and applies it to Store.
func (b *JSONBridge) Load() error {
	data, err := os.ReadFile(b.Path)
	if err != nil {
		return fmt.Errorf("read %s: %w", b.Path, err)
	}
	var cfg jsonConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("parse %s: %w", b.Path, err)
	}

	streams := make([]Stream, 0, len(cfg.Streams))
	for _, s := range cfg.Streams {
		streams = append(streams, Stream{
			Key:        s.Key,
			PlaybackID: s.PlaybackID,
			Enabled:    s.Enabled,
			Visibility: s.Visibility,
			OwnerID:    s.OwnerID,
			SharedWith: s.SharedWith,
		})
	}
	b.Store.Replace(streams, cfg.Settings.PublicViewing)
	return nil
}

// Poll reloads the file on every tick until ctx-equivalent stop is closed.
// Errors are logged, not fatal — a transient read failure (e.g. the file
// being rewritten mid-poll) should not take the data plane down.
func (b *JSONBridge) Poll(interval time.Duration, stop <-chan struct{}) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if err := b.Load(); err != nil {
				b.Log.Warn("failed to refresh stream config", "error", err.Error())
			}
		}
	}
}
