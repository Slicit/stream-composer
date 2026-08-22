// Package sessionauth resolves a viewer's sc_session cookie to their
// identity by asking the Rails control plane — the Go data plane holds no
// copy of the sessions table itself. Only the cookie's SHA-256 digest is
// ever sent to Rails, matching Session.digest's own one-way property: a
// leaked request or log line here is useless to replay.
package sessionauth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

// CookieName is the session cookie Rails' ApplicationController sets and
// reads — kept identical on purpose (see that file's own comment) so a
// shared reverse proxy could front either service during the migration.
const CookieName = "sc_session"

type Resolver struct {
	// BaseURL is the Rails service's origin, e.g. http://rails:3000.
	BaseURL string
	Token   string

	HTTPClient *http.Client
}

func (r *Resolver) client() *http.Client {
	if r.HTTPClient != nil {
		return r.HTTPClient
	}
	return &http.Client{Timeout: 4 * time.Second}
}

func digest(rawToken string) string {
	sum := sha256.Sum256([]byte(rawToken))
	return hex.EncodeToString(sum[:])
}

type sessionResponse struct {
	ID   string `json:"id"`
	Role string `json:"role"`
}

// Resolve looks up a raw cookie token's owner. Returns (nil, nil) for no
// session (missing/expired/unknown token — not an error, just anonymous),
// and a non-nil error only when the Rails call itself failed.
func (r *Resolver) Resolve(ctx context.Context, rawToken string) (*streamstore.User, error) {
	if strings.TrimSpace(rawToken) == "" {
		return nil, nil
	}

	base := strings.TrimSuffix(r.BaseURL, "/")
	url := fmt.Sprintf("%s/internal/%s/sessions/%s", base, r.Token, digest(rawToken))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := r.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("rails session lookup -> %d", res.StatusCode)
	}

	var body sessionResponse
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decode session response: %w", err)
	}
	return &streamstore.User{ID: body.ID, Role: body.Role}, nil
}
