package streamstore

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// RailsBridge polls the Rails control plane's internal API on an interval
// and refreshes a Memory store from it — the same role JSONBridge played
// during the window before Rails existed, now with a real backend instead
// of a shared file. Neither authhook nor mediaproxy change at all for this
// swap, since both depend only on the Store interface.
type RailsBridge struct {
	// BaseURL is the Rails service's origin, e.g. http://rails:3000.
	BaseURL string
	// Token is the shared secret carried in the URL path, matching
	// Internal::StreamsController's own convention (and the MediaMTX auth
	// hook's) — the only channel available for a caller that presents no
	// session and must never be reachable from a browser.
	Token      string
	Store      *Memory
	Log        *slog.Logger
	HTTPClient *http.Client
}

func (b *RailsBridge) client() *http.Client {
	if b.HTTPClient != nil {
		return b.HTTPClient
	}
	return http.DefaultClient
}

func (b *RailsBridge) url() string {
	base := strings.TrimSuffix(b.BaseURL, "/")
	return fmt.Sprintf("%s/internal/%s/streams", base, b.Token)
}

// Load fetches the current stream set once and applies it to Store.
func (b *RailsBridge) Load() error {
	req, err := http.NewRequest(http.MethodGet, b.url(), nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}

	res, err := b.client().Do(req)
	if err != nil {
		return fmt.Errorf("request %s: %w", b.BaseURL, err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("rails internal API returned %d", res.StatusCode)
	}

	var cfg jsonConfig
	if err := json.NewDecoder(res.Body).Decode(&cfg); err != nil {
		return fmt.Errorf("decode response: %w", err)
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

// Poll reloads from Rails on every tick until stop is closed. Errors are
// logged, not fatal — a transient network blip must not take the data
// plane's already-loaded stream set away; it keeps serving the last known
// good snapshot until the next successful poll.
func (b *RailsBridge) Poll(interval time.Duration, stop <-chan struct{}) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if err := b.Load(); err != nil {
				b.Log.Warn("failed to refresh stream config from Rails", "error", err.Error())
			}
		}
	}
}
