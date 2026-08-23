package channelstate

import (
	"context"
	"testing"

	"github.com/Slicit/stream-composer/go-service/internal/audiomonitor"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/sourceselector"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

type fakeStore struct {
	streams  []streamstore.Stream
	channels []streamstore.Channel
}

func (f *fakeStore) FindByPlaybackID(string) (*streamstore.Stream, bool) { return nil, false }
func (f *fakeStore) FindByKey(string) (*streamstore.Stream, bool)        { return nil, false }
func (f *fakeStore) FindByID(string) (*streamstore.Stream, bool)         { return nil, false }
func (f *fakeStore) PublicViewingEnabled() bool                          { return false }
func (f *fakeStore) Relays() []streamstore.Relay                         { return nil }
func (f *fakeStore) Streams() []streamstore.Stream                       { return f.streams }
func (f *fakeStore) HomepageChannelSlug() string                         { return "" }
func (f *fakeStore) Channels() []streamstore.Channel                     { return f.channels }
func (f *fakeStore) FindChannelBySlug(slug string) (*streamstore.Channel, bool) {
	for i := range f.channels {
		if f.channels[i].Slug == slug {
			return &f.channels[i], true
		}
	}
	return nil, false
}

type fakeLister struct{ live []mediamtx.IngestPath }

func (f *fakeLister) ListIngest(context.Context) ([]mediamtx.IngestPath, error) { return f.live, nil }

type fakeAudioStatus struct{ states map[string]string }

func (f *fakeAudioStatus) StatusOf(key string) audiomonitor.Status {
	return audiomonitor.Status{State: f.states[key]}
}

var testComp = sourceselector.Composition{Layout: "auto", Width: 1920, Height: 1080, GapPx: 4}

func TestBuildReturnsNotFoundForAnUnknownSlug(t *testing.T) {
	store := &fakeStore{}
	_, found, err := Build(context.Background(), store, &fakeLister{}, nil, nil, testComp, "live", "nope", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if found {
		t.Error("an unknown slug must report found=false")
	}
}

func TestBuildReturnsNotFoundWhenTheCallerCannotSeeThePrivateChannel(t *testing.T) {
	store := &fakeStore{channels: []streamstore.Channel{
		{ID: "c1", Slug: "secret", Visibility: "private", OwnerID: "owner-1"},
	}}
	_, found, err := Build(context.Background(), store, &fakeLister{}, nil, nil, testComp, "live", "secret", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if found {
		t.Error("a private channel must report found=false for a caller who cannot see it, same as unknown")
	}
}

func TestBuildIncludesAnOwnerVisibleForAPrivateChannel(t *testing.T) {
	store := &fakeStore{channels: []streamstore.Channel{
		{ID: "c1", Slug: "secret", Visibility: "private", OwnerID: "owner-1"},
	}}
	_, found, err := Build(context.Background(), store, &fakeLister{}, nil, nil, testComp, "live", "secret", &streamstore.User{ID: "owner-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !found {
		t.Error("the owner must be able to see their own private channel")
	}
}

func TestBuildMarksAnInaccessibleMemberRestrictedWithNoPaths(t *testing.T) {
	store := &fakeStore{
		streams: []streamstore.Stream{
			{ID: "s1", Key: "k1", PlaybackID: "pid1", Name: "Public Cam", Enabled: true, Visibility: "public"},
			{ID: "s2", Key: "k2", PlaybackID: "pid2", Name: "Private Cam", Enabled: true, Visibility: "private", OwnerID: "someone-else"},
		},
		channels: []streamstore.Channel{
			{ID: "c1", Slug: "mixed", Visibility: "public", StreamIDs: []string{"s1", "s2"}},
		},
	}
	lister := &fakeLister{live: []mediamtx.IngestPath{
		{Key: "k1", Ready: true}, {Key: "k2", Ready: true},
	}}

	state, found, err := Build(context.Background(), store, lister, nil, nil, testComp, "live", "mixed", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !found {
		t.Fatal("a public channel must be visible to an anonymous caller")
	}
	if len(state.Streams) != 2 {
		t.Fatalf("expected 2 stream entries, got %d", len(state.Streams))
	}

	byKey := map[string]int{}
	for i, s := range state.Streams {
		byKey[s.Key] = i
	}

	pub := state.Streams[byKey["pid1"]]
	if pub.Restricted {
		t.Error("the public member must not be restricted")
	}
	if pub.Path == nil || *pub.Path != "s/pid1" {
		t.Errorf("public member Path = %v, want s/pid1", pub.Path)
	}

	priv := state.Streams[byKey["pid2"]]
	if !priv.Restricted {
		t.Error("the private member (owned by someone else) must be restricted for an anonymous caller")
	}
	if priv.Path != nil || priv.AudioPath != nil {
		t.Errorf("a restricted member must carry no path at all, got Path=%v AudioPath=%v", priv.Path, priv.AudioPath)
	}

	// Both are live, so both must still occupy a grid cell — a restricted
	// tile is a placeholder client-side, not an absence server-side.
	if len(state.OnAir) != 2 {
		t.Errorf("expected both members on air (including the restricted one), got %d", len(state.OnAir))
	}
	if state.Layout == nil || len(state.Layout.Cells) != 2 {
		t.Errorf("expected a 2-cell layout, got %+v", state.Layout)
	}
}

func TestBuildRespectsTheChannelsOwnMembershipOrder(t *testing.T) {
	store := &fakeStore{
		streams: []streamstore.Stream{
			{ID: "s1", Key: "k1", PlaybackID: "pid1", Name: "First", Enabled: true, Visibility: "public"},
			{ID: "s2", Key: "k2", PlaybackID: "pid2", Name: "Second", Enabled: true, Visibility: "public"},
		},
		channels: []streamstore.Channel{
			// Deliberately reversed relative to insertion order above.
			{ID: "c1", Slug: "ordered", Visibility: "public", StreamIDs: []string{"s2", "s1"}},
		},
	}
	lister := &fakeLister{live: []mediamtx.IngestPath{{Key: "k1", Ready: true}, {Key: "k2", Ready: true}}}

	state, found, err := Build(context.Background(), store, lister, nil, nil, testComp, "live", "ordered", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !found {
		t.Fatal("expected the public channel to be found")
	}
	if len(state.OnAir) != 2 || *state.OnAir[0].Key != "pid2" || *state.OnAir[1].Key != "pid1" {
		t.Fatalf("onAir should follow the channel's own StreamIDs order, got %+v", state.OnAir)
	}
}

func TestBuildOmitsAnOfflineMemberFromOnAirButKeepsItInStreams(t *testing.T) {
	store := &fakeStore{
		streams: []streamstore.Stream{
			{ID: "s1", Key: "k1", PlaybackID: "pid1", Name: "Offline Cam", Enabled: true, Visibility: "public"},
		},
		channels: []streamstore.Channel{
			{ID: "c1", Slug: "quiet", Visibility: "public", StreamIDs: []string{"s1"}},
		},
	}
	state, found, err := Build(context.Background(), store, &fakeLister{}, nil, nil, testComp, "live", "quiet", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !found {
		t.Fatal("expected the channel to be found")
	}
	if len(state.OnAir) != 0 {
		t.Errorf("an offline member should not be on air, got %+v", state.OnAir)
	}
	if len(state.Streams) != 1 || state.Streams[0].Live {
		t.Errorf("the offline member should still appear in streams, marked not live, got %+v", state.Streams)
	}
}

func TestBuildIncludesTheChannelInfo(t *testing.T) {
	store := &fakeStore{channels: []streamstore.Channel{
		{
			ID: "c1", Slug: "info-test", Name: "Info Test", Visibility: "public", BackgroundImage: "/uploads/x.png",
			Description: "A cozy corner", CurrentTopic: "Farming", FeaturedGame: "Stardew Valley",
		},
	}}
	state, found, err := Build(context.Background(), store, &fakeLister{}, nil, nil, testComp, "live", "info-test", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !found {
		t.Fatal("expected the channel to be found")
	}
	if state.Channel == nil || state.Channel.Name != "Info Test" || state.Channel.Slug != "info-test" || state.Channel.BackgroundImage != "/uploads/x.png" {
		t.Errorf("Channel = %+v, want the channel's own name/slug/backgroundImage", state.Channel)
	}
	if state.Channel.Description != "A cozy corner" || state.Channel.CurrentTopic != "Farming" || state.Channel.FeaturedGame != "Stardew Valley" {
		t.Errorf("Channel = %+v, want the channel's own description/currentTopic/featuredGame", state.Channel)
	}
}

func TestBuildHasAudioOnlyOnceTheOpusTranscodeIsLive(t *testing.T) {
	store := &fakeStore{
		streams: []streamstore.Stream{{ID: "s1", Key: "k1", PlaybackID: "pid1", Name: "Cam", Enabled: true, Visibility: "public"}},
		channels: []streamstore.Channel{
			{ID: "c1", Slug: "audio-test", Visibility: "public", StreamIDs: []string{"s1"}},
		},
	}
	lister := &fakeLister{live: []mediamtx.IngestPath{{Key: "k1", Ready: true, HasAudio: true}}}
	audio := &fakeAudioStatus{states: map[string]string{"k1": "connecting"}}

	state, found, err := Build(context.Background(), store, lister, nil, audio, testComp, "live", "audio-test", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !found {
		t.Fatal("expected the channel to be found")
	}
	if state.Streams[0].HasAudio {
		t.Error("hasAudio must stay false until the Opus republish is actually live")
	}
}
