// Package streamstore defines the data-plane's view of streams and users —
// exactly the fields the auth hook and the media proxy need, nothing else.
//
// This is the seam the migration plan calls for: today Store is backed by an
// in-memory snapshot refreshed from the legacy JSON file (see memory.go), so
// this service runs standalone before the Rails control plane exists. Once
// Rails/Postgres are live, a second implementation calls its internal API
// instead — nothing in authhook or mediaproxy needs to change, because both
// packages depend only on this interface.
package streamstore

// Stream is the subset of a stream record the data plane ever needs to make
// an access or routing decision.
type Stream struct {
	ID         string
	Key        string // the ingest credential; never sent to a browser
	PlaybackID string // the opaque id a viewer addresses instead
	Enabled    bool
	Visibility string // "public" or "private"
	OwnerID    string // "" when unowned (admin-managed)
	SharedWith []string
}

// User is the subset of a user record access decisions need.
type User struct {
	ID   string
	Role string // "admin", "streamer", "viewer"
}

// Store is read-only from the data plane's perspective — nothing here ever
// creates or mutates a stream or a user. Every method must be safe for
// concurrent use, since the HTTP handlers that call it are.
type Store interface {
	// FindByPlaybackID looks up a stream by its public, opaque id.
	// Returns (nil, false) when unknown.
	FindByPlaybackID(playbackID string) (*Stream, bool)

	// FindByKey looks up a stream by its ingest key.
	// Returns (nil, false) when unknown.
	FindByKey(key string) (*Stream, bool)

	// PublicViewingEnabled reports the site-wide setting that lets an
	// anonymous visitor watch the composed programme.
	PublicViewingEnabled() bool
}
