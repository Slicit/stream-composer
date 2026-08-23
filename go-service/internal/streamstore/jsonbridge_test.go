package streamstore

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

func TestJSONBridgeLoad(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	doc := map[string]any{
		"streams": []map[string]any{
			{"id": "s1", "key": "k1", "playbackId": "p1", "enabled": true, "visibility": "public", "ownerId": "", "sharedWith": []string{}},
			{"id": "s2", "key": "k2", "playbackId": "p2", "enabled": false, "visibility": "private", "ownerId": "u1", "sharedWith": []string{"u2"}},
		},
		"relays": []map[string]any{
			{"id": "r1", "streamId": "s1", "provider": "twitch", "name": "Twitch", "url": "rtmp://live.twitch.tv/app", "key": "relay-key", "audio": "copy", "enabled": true},
		},
		"channels": []map[string]any{
			{
				"id": "c1", "name": "Community Room", "slug": "community-room", "visibility": "public", "ownerId": "u1",
				"sharedWith": []string{}, "streamIds": []string{"s1"}, "backgroundImage": "",
				"description": "A cozy corner", "currentTopic": "Farming", "featuredGame": "Stardew Valley",
			},
		},
		"settings": map[string]any{"publicViewing": true, "homepageChannelSlug": "community-room"},
	}
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}

	store := NewMemory()
	b := &JSONBridge{Path: path, Store: store, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := b.Load(); err != nil {
		t.Fatal(err)
	}

	if !store.PublicViewingEnabled() {
		t.Error("publicViewing should be true")
	}
	s, ok := store.FindByKey("k1")
	if !ok || s.PlaybackID != "p1" || !s.Enabled || s.Visibility != "public" {
		t.Errorf("k1: got %+v, ok=%v", s, ok)
	}
	s2, ok := store.FindByPlaybackID("p2")
	if !ok || s2.OwnerID != "u1" || len(s2.SharedWith) != 1 || s2.SharedWith[0] != "u2" {
		t.Errorf("p2: got %+v, ok=%v", s2, ok)
	}
	byID, ok := store.FindByID("s1")
	if !ok || byID.Key != "k1" {
		t.Errorf("FindByID(s1): got %+v, ok=%v", byID, ok)
	}

	relays := store.Relays()
	if len(relays) != 1 || relays[0].StreamID != "s1" || relays[0].Key != "relay-key" {
		t.Errorf("relays: got %+v", relays)
	}

	channel, ok := store.FindChannelBySlug("community-room")
	if !ok || channel.Name != "Community Room" || len(channel.StreamIDs) != 1 || channel.StreamIDs[0] != "s1" {
		t.Errorf("channel: got %+v, ok=%v", channel, ok)
	}
	if channel.Description != "A cozy corner" || channel.CurrentTopic != "Farming" || channel.FeaturedGame != "Stardew Valley" {
		t.Errorf("channel description/currentTopic/featuredGame: got %+v", channel)
	}
	if store.HomepageChannelSlug() != "community-room" {
		t.Errorf("HomepageChannelSlug() = %q, want community-room", store.HomepageChannelSlug())
	}
}

func TestJSONBridgeLoadMissingFile(t *testing.T) {
	store := NewMemory()
	b := &JSONBridge{Path: filepath.Join(t.TempDir(), "missing.json"), Store: store, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := b.Load(); err == nil {
		t.Error("expected an error for a missing file")
	}
}
