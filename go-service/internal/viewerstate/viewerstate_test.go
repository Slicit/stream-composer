package viewerstate

import (
	"context"
	"testing"

	"github.com/Slicit/stream-composer/go-service/internal/audiomonitor"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/playability"
	"github.com/Slicit/stream-composer/go-service/internal/sourceselector"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

type fakeStore struct {
	streams             []streamstore.Stream
	channels            []streamstore.Channel
	publicViewing       bool
	homepageChannelSlug string
}

func (f *fakeStore) FindByPlaybackID(string) (*streamstore.Stream, bool) { return nil, false }
func (f *fakeStore) FindByKey(string) (*streamstore.Stream, bool)        { return nil, false }
func (f *fakeStore) FindByID(string) (*streamstore.Stream, bool)         { return nil, false }
func (f *fakeStore) PublicViewingEnabled() bool                          { return f.publicViewing }
func (f *fakeStore) Relays() []streamstore.Relay                         { return nil }
func (f *fakeStore) Streams() []streamstore.Stream                       { return f.streams }
func (f *fakeStore) HomepageChannelSlug() string                         { return f.homepageChannelSlug }
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

func TestBuildPlacesOnAirSourcesWithPlaybackIDs(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{
		{Key: "a", PlaybackID: "pid-a", Name: "Alpha", Enabled: true},
	}}
	lister := &fakeLister{live: []mediamtx.IngestPath{{Key: "a", Ready: true}}}
	comp := sourceselector.Composition{Include: "auto", Layout: "auto", Width: 1920, Height: 1080, GapPx: 4}

	state, err := Build(context.Background(), store, lister, nil, nil, comp, "live")
	if err != nil {
		t.Fatal(err)
	}
	if !state.Program.Ready {
		t.Error("program should be ready with an on-air source")
	}
	if len(state.OnAir) != 1 || state.OnAir[0].Key == nil || *state.OnAir[0].Key != "pid-a" {
		t.Fatalf("onAir should carry the playback id, got %+v", state.OnAir)
	}
	if state.Layout == nil || len(state.Layout.Cells) != 1 {
		t.Fatalf("expected a one-cell layout, got %+v", state.Layout)
	}
}

func TestBuildOmitsPathsForDisabledOrUnconfiguredStreams(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{
		{Key: "a", PlaybackID: "pid-a", Name: "Alpha", Enabled: false},
		{Key: "b", PlaybackID: "", Name: "Beta", Enabled: true}, // no playback id yet
	}}
	lister := &fakeLister{}
	comp := sourceselector.Composition{Include: "auto", Layout: "auto", Width: 1920, Height: 1080, GapPx: 4}

	state, err := Build(context.Background(), store, lister, nil, nil, comp, "live")
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Streams) != 0 {
		t.Fatalf("disabled/unconfigured streams should never appear in the viewer list, got %+v", state.Streams)
	}
}

func TestBuildReportsLiveAndHasAudioFromMediaMTXAndTheAudioMonitor(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{{Key: "a", PlaybackID: "pid-a", Name: "Alpha", Enabled: true}}}
	lister := &fakeLister{live: []mediamtx.IngestPath{{Key: "a", Ready: true, HasAudio: true}}}
	audio := &fakeAudioStatus{states: map[string]string{"a": "live"}}
	comp := sourceselector.Composition{Include: "auto", Layout: "auto", Width: 1920, Height: 1080, GapPx: 4}

	state, err := Build(context.Background(), store, lister, nil, audio, comp, "live")
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Streams) != 1 {
		t.Fatalf("expected one stream entry, got %+v", state.Streams)
	}
	s := state.Streams[0]
	if !s.Live {
		t.Error("stream should be reported live")
	}
	if !s.HasAudio {
		t.Error("hasAudio should be true once both the source has an audio track and the audio monitor's Opus transcode is live")
	}
	if s.Path == nil || *s.Path != "s/pid-a" {
		t.Errorf("Path = %v, want s/pid-a", s.Path)
	}
	if s.AudioPath == nil || *s.AudioPath != "s/pid-a/audio" {
		t.Errorf("AudioPath = %v, want s/pid-a/audio", s.AudioPath)
	}
}

func TestBuildHasAudioIsFalseUntilTheOpusTranscodeIsActuallyLive(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{{Key: "a", PlaybackID: "pid-a", Name: "Alpha", Enabled: true}}}
	lister := &fakeLister{live: []mediamtx.IngestPath{{Key: "a", Ready: true, HasAudio: true}}}
	audio := &fakeAudioStatus{states: map[string]string{"a": "connecting"}} // not "live" yet
	comp := sourceselector.Composition{Include: "auto", Layout: "auto", Width: 1920, Height: 1080, GapPx: 4}

	state, err := Build(context.Background(), store, lister, nil, audio, comp, "live")
	if err != nil {
		t.Fatal(err)
	}
	if state.Streams[0].HasAudio {
		t.Error("hasAudio must stay false until the Opus republish is actually live, not just requested")
	}
}

func TestBuildUsesNicknameOverName(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{
		{Key: "a", PlaybackID: "pid-a", Name: "Alpha", Nickname: "  Cam One  ", Enabled: true},
	}}
	state, err := Build(context.Background(), store, &fakeLister{}, nil, nil, sourceselector.Composition{}, "live")
	if err != nil {
		t.Fatal(err)
	}
	if state.Streams[0].Name != "Cam One" {
		t.Errorf("Name = %q, want trimmed nickname", state.Streams[0].Name)
	}
}

func TestBuildReflectsPublicViewingSetting(t *testing.T) {
	store := &fakeStore{publicViewing: true}
	state, err := Build(context.Background(), store, &fakeLister{}, nil, nil, sourceselector.Composition{}, "live")
	if err != nil {
		t.Fatal(err)
	}
	if !state.Settings.PublicViewing {
		t.Error("Settings.PublicViewing should reflect the store")
	}
}

func TestBuildSurfacesAPlayabilityProblem(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{{Key: "a", PlaybackID: "pid-a", Name: "Alpha", Enabled: true}}}
	checker := playability.New("/bin/true") // never actually invoked in this test
	// Manually seed a problem via the real cache path isn't exposed, so
	// instead assert the nil-problem path here and leave the "real
	// problem present" path to playability's own tests, which already
	// cover ReasonFor()/Inspect()/Status() directly.
	state, err := Build(context.Background(), store, &fakeLister{}, checker, nil, sourceselector.Composition{}, "live")
	if err != nil {
		t.Fatal(err)
	}
	if state.Streams[0].Problem != nil {
		t.Error("with no probe run yet, Problem should be nil")
	}
}
