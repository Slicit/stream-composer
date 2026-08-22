package mediamtx

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListIngestFiltersAndPaginates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		page := r.URL.Query().Get("page")
		w.Header().Set("Content-Type", "application/json")
		switch page {
		case "0":
			_ = json.NewEncoder(w).Encode(pathsListResponse{
				Items: []pathItem{
					{Name: "live/good-key", Ready: true},
					{Name: "live/offline-key", Ready: false},
					{Name: "program", Ready: true},         // not under the ingest prefix
					{Name: "live/nested/key", Ready: true}, // nested, must be skipped
				},
				PageCount: 2,
			})
		case "1":
			_ = json.NewEncoder(w).Encode(pathsListResponse{
				Items:     []pathItem{{Name: "live/second-page-key", Ready: true}},
				PageCount: 2,
			})
		default:
			t.Fatalf("unexpected page %q", page)
		}
	}))
	defer server.Close()

	client := &Client{BaseURL: server.URL, IngestPrefix: "live"}
	got, err := client.ListIngest(context.Background())
	if err != nil {
		t.Fatalf("ListIngest() error = %v", err)
	}

	want := map[string]bool{"good-key": true, "offline-key": false, "second-page-key": true}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %d entries", got, len(want))
	}
	for _, ip := range got {
		ready, ok := want[ip.Key]
		if !ok {
			t.Errorf("unexpected key %q in result", ip.Key)
			continue
		}
		if ip.Ready != ready {
			t.Errorf("key %q: ready = %v, want %v", ip.Key, ip.Ready, ready)
		}
	}
}

func TestListIngestReportsWhetherAnAudioTrackIsPresent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(pathsListResponse{
			Items: []pathItem{
				{Name: "live/with-audio", Ready: true, Tracks: []string{"H264", "MPEG-4 Audio"}},
				{Name: "live/video-only", Ready: true, Tracks: []string{"H264"}},
				{Name: "live/opus-only", Ready: true, Tracks: []string{"Opus"}},
			},
			PageCount: 1,
		})
	}))
	defer server.Close()

	client := &Client{BaseURL: server.URL, IngestPrefix: "live"}
	got, err := client.ListIngest(context.Background())
	if err != nil {
		t.Fatalf("ListIngest() error = %v", err)
	}

	want := map[string]bool{"with-audio": true, "video-only": false, "opus-only": true}
	for _, ip := range got {
		if ip.HasAudio != want[ip.Key] {
			t.Errorf("key %q: HasAudio = %v, want %v", ip.Key, ip.HasAudio, want[ip.Key])
		}
	}
}

func TestListIngestNon200(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := &Client{BaseURL: server.URL, IngestPrefix: "live"}
	if _, err := client.ListIngest(context.Background()); err == nil {
		t.Error("expected an error for a non-200 response")
	}
}
