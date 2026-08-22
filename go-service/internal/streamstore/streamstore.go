// Package streamstore defines the data-plane's view of streams, relays and
// users — exactly the fields the auth hook, the media proxy and the relay
// runner need, nothing else.
//
// This is the seam the migration plan calls for: today Store is backed by an
// in-memory snapshot refreshed from the legacy JSON file (see memory.go), so
// this service runs standalone before the Rails control plane exists. Once
// Rails/Postgres are live, a second implementation calls its internal API
// instead — nothing in authhook, mediaproxy or relayrunner needs to change,
// because all three packages depend only on this interface.
package streamstore

// Stream is the subset of a stream record the data plane ever needs to make
// an access, routing or restream decision.
type Stream struct {
	ID         string
	Key        string // the ingest credential; never sent to a browser
	PlaybackID string // the opaque id a viewer addresses instead
	Enabled    bool
	Visibility string // "public" or "private"
	OwnerID    string // "" when unowned (admin-managed)
	SharedWith []string
}

// Relay is a restream destination's configuration — everything
// internal/relayrunner needs to decide whether and how to forward a
// source. The key here is the real, unmasked credential (server-to-server
// only, same as streams.js's own internal callers always saw it).
type Relay struct {
	ID       string
	StreamID string
	Provider string
	Name     string
	URL      string
	Key      string
	Audio    string // "copy" or "aac"
	Enabled  bool
}

// User is the subset of a user record access decisions need.
type User struct {
	ID   string
	Role string // "admin", "streamer", "viewer"
}

// Store is read-only from the data plane's perspective — nothing here ever
// creates or mutates a stream or a user. Every method must be safe for
// concurrent use, since the HTTP handlers and the relay runner's own poll
// loop both call it.
type Store interface {
	// FindByPlaybackID looks up a stream by its public, opaque id.
	// Returns (nil, false) when unknown.
	FindByPlaybackID(playbackID string) (*Stream, bool)

	// FindByKey looks up a stream by its ingest key.
	// Returns (nil, false) when unknown.
	FindByKey(key string) (*Stream, bool)

	// FindByID looks up a stream by its internal id — what a Relay's
	// StreamID refers to.
	FindByID(id string) (*Stream, bool)

	// PublicViewingEnabled reports the site-wide setting that lets an
	// anonymous visitor watch the composed programme.
	PublicViewingEnabled() bool

	// Relays lists every configured restream destination, regardless of
	// whether its source stream is currently live.
	Relays() []Relay
}
