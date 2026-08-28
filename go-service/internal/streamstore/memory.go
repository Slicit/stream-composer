package streamstore

import "sync"

// Memory is a Store held entirely in memory, safe for concurrent reads and
// for the test suite to mutate between assertions. It is also the store
// this service runs against standalone, before Rails/Postgres exist — see
// the package doc comment.
type Memory struct {
	mu                  sync.RWMutex
	streams             []Stream
	relays              []Relay
	channels            []Channel
	channelCompositions []ChannelComposition
	publicViewing       bool
	homepageChannelSlug string
	defaultLayoutMode   string
}

func NewMemory() *Memory {
	return &Memory{}
}

// Replace swaps the entire stream, relay, channel and composition set
// atomically — how a future JSON-file or polling-based loader would apply
// a refresh without a caller ever observing a half-updated set.
func (m *Memory) Replace(streams []Stream, relays []Relay, channels []Channel, channelCompositions []ChannelComposition, publicViewing bool, homepageChannelSlug string, defaultLayoutMode string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.streams = append([]Stream(nil), streams...)
	m.relays = append([]Relay(nil), relays...)
	m.channels = append([]Channel(nil), channels...)
	m.channelCompositions = append([]ChannelComposition(nil), channelCompositions...)
	m.publicViewing = publicViewing
	m.homepageChannelSlug = homepageChannelSlug
	m.defaultLayoutMode = defaultLayoutMode
}

func (m *Memory) FindByPlaybackID(playbackID string) (*Stream, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := range m.streams {
		if m.streams[i].PlaybackID == playbackID {
			s := m.streams[i]
			return &s, true
		}
	}
	return nil, false
}

func (m *Memory) FindByKey(key string) (*Stream, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := range m.streams {
		if m.streams[i].Key == key {
			s := m.streams[i]
			return &s, true
		}
	}
	return nil, false
}

func (m *Memory) FindByID(id string) (*Stream, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := range m.streams {
		if m.streams[i].ID == id {
			s := m.streams[i]
			return &s, true
		}
	}
	return nil, false
}

func (m *Memory) PublicViewingEnabled() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.publicViewing
}

func (m *Memory) Relays() []Relay {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]Relay(nil), m.relays...)
}

func (m *Memory) Streams() []Stream {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]Stream(nil), m.streams...)
}

func (m *Memory) Channels() []Channel {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]Channel(nil), m.channels...)
}

func (m *Memory) FindChannelBySlug(slug string) (*Channel, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := range m.channels {
		if m.channels[i].Slug == slug {
			c := m.channels[i]
			return &c, true
		}
	}
	return nil, false
}

func (m *Memory) HomepageChannelSlug() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.homepageChannelSlug
}

func (m *Memory) DefaultLayoutMode() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.defaultLayoutMode == "" {
		return "fixed"
	}
	return m.defaultLayoutMode
}

func (m *Memory) ChannelCompositions() []ChannelComposition {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]ChannelComposition(nil), m.channelCompositions...)
}

func (m *Memory) FindChannelComposition(channelID, orientation string) (*ChannelComposition, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := range m.channelCompositions {
		if m.channelCompositions[i].ChannelID == channelID && m.channelCompositions[i].Orientation == orientation {
			c := m.channelCompositions[i]
			return &c, true
		}
	}
	return nil, false
}

func (m *Memory) FindChannelCompositionByID(id string) (*ChannelComposition, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := range m.channelCompositions {
		if m.channelCompositions[i].ID == id {
			c := m.channelCompositions[i]
			return &c, true
		}
	}
	return nil, false
}
