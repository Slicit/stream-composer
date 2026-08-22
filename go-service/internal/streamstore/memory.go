package streamstore

import "sync"

// Memory is a Store held entirely in memory, safe for concurrent reads and
// for the test suite to mutate between assertions. It is also the store
// this service runs against standalone, before Rails/Postgres exist — see
// the package doc comment.
type Memory struct {
	mu            sync.RWMutex
	streams       []Stream
	relays        []Relay
	publicViewing bool
}

func NewMemory() *Memory {
	return &Memory{}
}

// Replace swaps the entire stream and relay set atomically — how a
// future JSON-file or polling-based loader would apply a refresh without a
// caller ever observing a half-updated set.
func (m *Memory) Replace(streams []Stream, relays []Relay, publicViewing bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.streams = append([]Stream(nil), streams...)
	m.relays = append([]Relay(nil), relays...)
	m.publicViewing = publicViewing
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
