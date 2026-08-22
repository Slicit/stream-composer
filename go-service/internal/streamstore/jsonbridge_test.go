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
			{"key": "k1", "playbackId": "p1", "enabled": true, "visibility": "public", "ownerId": "", "sharedWith": []string{}},
			{"key": "k2", "playbackId": "p2", "enabled": false, "visibility": "private", "ownerId": "u1", "sharedWith": []string{"u2"}},
		},
		"settings": map[string]any{"publicViewing": true},
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
}

func TestJSONBridgeLoadMissingFile(t *testing.T) {
	store := NewMemory()
	b := &JSONBridge{Path: filepath.Join(t.TempDir(), "missing.json"), Store: store, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := b.Load(); err == nil {
		t.Error("expected an error for a missing file")
	}
}
