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
	Name       string // operator-facing label; falls back to Key when unset
	Nickname   string // caption override; falls back to Name when unset
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

// Channel is a curated, browser-composed stream list — configuration
// only, the same split Channel's own Rails model doc comment describes:
// viewing a channel's live state (layout, on-air status) is entirely a
// data-plane concern, not stored here.
type Channel struct {
	ID              string
	Name            string
	Slug            string
	Visibility      string // "public" or "private"
	OwnerID         string
	SharedWith      []string
	StreamIDs       []string // ordered — defines membership AND layout order
	BackgroundImage string
	Description     string
	CurrentTopic    string
	FeaturedGame    string // resolved game name, or "" — Rails owns the games table
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

	// Streams lists every configured stream, live or not — what a
	// selection/ordering decision (e.g. sourceselector) needs to resolve a
	// live ingest key back to its name, nickname and enabled flag.
	Streams() []Stream

	// FindChannelBySlug looks up a channel by its public slug. Returns
	// (nil, false) when unknown.
	FindChannelBySlug(slug string) (*Channel, bool)

	// Channels lists every configured channel — the left nav's bulk live-
	// status check (internal/channelstate.BuildLiveMap) needs the whole
	// set, unlike everything else here which resolves one at a time.
	Channels() []Channel

	// HomepageChannelSlug is the channel "/" should redirect to, or ""
	// when none is configured.
	HomepageChannelSlug() string
}
