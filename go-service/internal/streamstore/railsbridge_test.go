package streamstore

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRailsBridgeLoad(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewEncoder(w).Encode(map[string]any{
			"streams": []map[string]any{
				{"id": "s1", "key": "k1", "playbackId": "p1", "enabled": true, "visibility": "public", "ownerId": "", "sharedWith": []string{}},
				{"id": "s2", "key": "k2", "playbackId": "p2", "enabled": false, "visibility": "private", "ownerId": "u1", "sharedWith": []string{"u2"}},
			},
			"settings": map[string]any{"publicViewing": true},
		})
	}))
	defer server.Close()

	store := NewMemory()
	bridge := &RailsBridge{BaseURL: server.URL, Token: "secret-token", Store: store, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}

	if err := bridge.Load(); err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if gotPath != "/internal/secret-token/streams" {
		t.Errorf("request path = %q, want the token embedded in the URL", gotPath)
	}
	if !store.PublicViewingEnabled() {
		t.Error("publicViewing should be true")
	}
	s, ok := store.FindByKey("k1")
	if !ok || s.PlaybackID != "p1" || !s.Enabled {
		t.Errorf("k1: got %+v, ok=%v", s, ok)
	}
	s2, ok := store.FindByPlaybackID("p2")
	if !ok || s2.OwnerID != "u1" || len(s2.SharedWith) != 1 || s2.SharedWith[0] != "u2" {
		t.Errorf("p2: got %+v, ok=%v", s2, ok)
	}
}

func TestRailsBridgeLoadNon200(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	bridge := &RailsBridge{BaseURL: server.URL, Token: "wrong", Store: NewMemory(), Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := bridge.Load(); err == nil {
		t.Error("expected an error for a non-200 response")
	}
}

func TestRailsBridgeLoadUnreachable(t *testing.T) {
	bridge := &RailsBridge{BaseURL: "http://127.0.0.1:1", Token: "x", Store: NewMemory(), Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := bridge.Load(); err == nil {
		t.Error("expected an error when Rails is unreachable")
	}
}
