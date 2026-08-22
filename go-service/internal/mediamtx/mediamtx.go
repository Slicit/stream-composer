// Package mediamtx is a thin client for MediaMTX's control API (v3) — just
// enough to answer "which ingest keys are currently live," which is all
// internal/relayrunner needs to decide whether a destination should be
// forwarding right now. Ported from the relevant slice of
// server/src/mediamtx.js's listPaths()/listIngest().
package mediamtx

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type Client struct {
	// BaseURL is MediaMTX's control API origin, e.g. http://mediamtx:9997.
	BaseURL      string
	IngestPrefix string // e.g. "live" -> live/<key>
	HTTPClient   *http.Client
}

func (c *Client) client() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: 4 * time.Second}
}

type pathItem struct {
	Name   string   `json:"name"`
	Ready  bool     `json:"ready"`
	Tracks []string `json:"tracks"`
}

var audioTrackPattern = regexp.MustCompile(`(?i)aac|opus|mpeg4-audio|audio|pcm`)

func hasAudioTrack(tracks []string) bool {
	for _, t := range tracks {
		if audioTrackPattern.MatchString(t) {
			return true
		}
	}
	return false
}

type pathsListResponse struct {
	Items     []pathItem `json:"items"`
	PageCount int        `json:"pageCount"`
}

// IngestPath is a live ingest slot, mapped from MediaMTX's own path name
// (live/<key>) down to just the key relayrunner cares about.
type IngestPath struct {
	Key      string
	Ready    bool
	HasAudio bool
}

// ListIngest returns every path under IngestPrefix, paginated the same way
// listPaths() in the Node backend does. A path whose key is empty or
// contains a nested "/" is skipped — the same defensive filter
// listIngest() applies, since a key is never expected to look like that.
func (c *Client) ListIngest(ctx context.Context) ([]IngestPath, error) {
	prefix := c.IngestPrefix + "/"
	var out []IngestPath

	page := 0
	for {
		items, pageCount, err := c.listPathsPage(ctx, page)
		if err != nil {
			return nil, err
		}
		for _, it := range items {
			if !strings.HasPrefix(it.Name, prefix) {
				continue
			}
			key := it.Name[len(prefix):]
			if key == "" || strings.Contains(key, "/") {
				continue
			}
			out = append(out, IngestPath{Key: key, Ready: it.Ready, HasAudio: hasAudioTrack(it.Tracks)})
		}
		page++
		if page >= pageCount {
			break
		}
	}
	return out, nil
}

func (c *Client) listPathsPage(ctx context.Context, page int) ([]pathItem, int, error) {
	url := fmt.Sprintf("%s/v3/paths/list?page=%d&itemsPerPage=200", strings.TrimSuffix(c.BaseURL, "/"), page)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}
	res, err := c.client().Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("mediamtx GET /v3/paths/list -> %d", res.StatusCode)
	}
	var body pathsListResponse
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, 0, fmt.Errorf("decode paths list: %w", err)
	}
	pageCount := body.PageCount
	if pageCount < 1 {
		pageCount = 1
	}
	return body.Items, pageCount, nil
}
