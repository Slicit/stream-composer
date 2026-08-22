package streamstore

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"
)

// jsonConfig mirrors just the fields server/src/store.js's config.json ever
// writes that this service cares about. Also reused by RailsBridge, since
// Internal::StreamsController's response is shaped identically on purpose.
type jsonConfig struct {
	Streams []struct {
		ID         string   `json:"id"`
		Key        string   `json:"key"`
		PlaybackID string   `json:"playbackId"`
		Enabled    bool     `json:"enabled"`
		Visibility string   `json:"visibility"`
		OwnerID    string   `json:"ownerId"`
		SharedWith []string `json:"sharedWith"`
		Name       string   `json:"name"`
		Nickname   string   `json:"nickname"`
	} `json:"streams"`
	Relays []struct {
		ID       string `json:"id"`
		StreamID string `json:"streamId"`
		Provider string `json:"provider"`
		Name     string `json:"name"`
		URL      string `json:"url"`
		Key      string `json:"key"`
		Audio    string `json:"audio"`
		Enabled  bool   `json:"enabled"`
	} `json:"relays"`
	Channels []struct {
		ID              string   `json:"id"`
		Name            string   `json:"name"`
		Slug            string   `json:"slug"`
		Visibility      string   `json:"visibility"`
		OwnerID         string   `json:"ownerId"`
		SharedWith      []string `json:"sharedWith"`
		StreamIDs       []string `json:"streamIds"`
		BackgroundImage string   `json:"backgroundImage"`
	} `json:"channels"`
	Settings struct {
		PublicViewing       bool   `json:"publicViewing"`
		HomepageChannelSlug string `json:"homepageChannelSlug"`
	} `json:"settings"`
}

func (cfg jsonConfig) toStreams() []Stream {
	streams := make([]Stream, 0, len(cfg.Streams))
	for _, s := range cfg.Streams {
		streams = append(streams, Stream{
			ID:         s.ID,
			Key:        s.Key,
			PlaybackID: s.PlaybackID,
			Enabled:    s.Enabled,
			Visibility: s.Visibility,
			OwnerID:    s.OwnerID,
			SharedWith: s.SharedWith,
			Name:       s.Name,
			Nickname:   s.Nickname,
		})
	}
	return streams
}

func (cfg jsonConfig) toRelays() []Relay {
	relays := make([]Relay, 0, len(cfg.Relays))
	for _, r := range cfg.Relays {
		relays = append(relays, Relay{
			ID:       r.ID,
			StreamID: r.StreamID,
			Provider: r.Provider,
			Name:     r.Name,
			URL:      r.URL,
			Key:      r.Key,
			Audio:    r.Audio,
			Enabled:  r.Enabled,
		})
	}
	return relays
}

func (cfg jsonConfig) toChannels() []Channel {
	channels := make([]Channel, 0, len(cfg.Channels))
	for _, c := range cfg.Channels {
		channels = append(channels, Channel{
			ID:              c.ID,
			Name:            c.Name,
			Slug:            c.Slug,
			Visibility:      c.Visibility,
			OwnerID:         c.OwnerID,
			SharedWith:      c.SharedWith,
			StreamIDs:       c.StreamIDs,
			BackgroundImage: c.BackgroundImage,
		})
	}
	return channels
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
	b.Store.Replace(cfg.toStreams(), cfg.toRelays(), cfg.toChannels(), cfg.Settings.PublicViewing, cfg.Settings.HomepageChannelSlug)
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
