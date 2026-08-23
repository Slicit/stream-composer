package sourceselector

import (
	"testing"

	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

type fakeStore struct {
	streams []streamstore.Stream
}

func (f *fakeStore) FindByPlaybackID(string) (*streamstore.Stream, bool)   { return nil, false }
func (f *fakeStore) FindByKey(string) (*streamstore.Stream, bool)          { return nil, false }
func (f *fakeStore) FindByID(string) (*streamstore.Stream, bool)           { return nil, false }
func (f *fakeStore) PublicViewingEnabled() bool                            { return false }
func (f *fakeStore) DefaultLayoutMode() string                             { return "fixed" }
func (f *fakeStore) Relays() []streamstore.Relay                           { return nil }
func (f *fakeStore) Streams() []streamstore.Stream                         { return f.streams }
func (f *fakeStore) FindChannelBySlug(string) (*streamstore.Channel, bool) { return nil, false }
func (f *fakeStore) Channels() []streamstore.Channel                       { return nil }
func (f *fakeStore) HomepageChannelSlug() string                           { return "" }

func TestSelectOrdersManualModeByOperatorOrderOnly(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{
		{Key: "a", Name: "Alpha", Enabled: true},
		{Key: "b", Name: "Beta", Enabled: true},
		{Key: "c", Name: "Gamma", Enabled: true},
	}}
	live := []mediamtx.IngestPath{{Key: "a", Ready: true}, {Key: "b", Ready: true}, {Key: "c", Ready: true}}
	comp := Composition{Include: "manual", Order: []string{"c", "a"}}

	got := Select(live, store, comp, "live")
	if len(got) != 2 || got[0].Key != "c" || got[1].Key != "a" {
		t.Fatalf("manual mode should follow Order exactly and drop anything not listed, got %+v", got)
	}
}

func TestSelectAutoModePutsOrderedFirstThenSortsTheRestNaturally(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{
		{Key: "s1", Name: "stream1", Enabled: true},
		{Key: "s2", Name: "stream2", Enabled: true},
		{Key: "s10", Name: "stream10", Enabled: true},
	}}
	live := []mediamtx.IngestPath{{Key: "s1", Ready: true}, {Key: "s2", Ready: true}, {Key: "s10", Ready: true}}
	comp := Composition{Include: "auto", Order: []string{"s10"}}

	got := Select(live, store, comp, "live")
	want := []string{"s10", "s1", "s2"} // s10 pinned first by Order, rest natural-sorted
	if len(got) != len(want) {
		t.Fatalf("got %+v, want keys %v", got, want)
	}
	for i, k := range want {
		if got[i].Key != k {
			t.Errorf("position %d: got %q, want %q (full: %+v)", i, got[i].Key, k, got)
		}
	}
}

func TestSelectDropsDisabledStreamsEvenWhenLive(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{
		{Key: "a", Name: "Alpha", Enabled: false},
		{Key: "b", Name: "Beta", Enabled: true},
	}}
	live := []mediamtx.IngestPath{{Key: "a", Ready: true}, {Key: "b", Ready: true}}
	comp := Composition{Include: "auto"}

	got := Select(live, store, comp, "live")
	if len(got) != 1 || got[0].Key != "b" {
		t.Fatalf("a disabled stream must never be selected, got %+v", got)
	}
}

func TestSelectDropsSourcesThatAreNotReady(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{{Key: "a", Name: "Alpha", Enabled: true}}}
	live := []mediamtx.IngestPath{{Key: "a", Ready: false}}
	comp := Composition{Include: "auto"}

	got := Select(live, store, comp, "live")
	if len(got) != 0 {
		t.Fatalf("a not-ready source must never be selected, got %+v", got)
	}
}

func TestSelectLabelPrefersNicknameOverName(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{
		{Key: "a", Name: "Alpha", Nickname: "  The A Stream  ", Enabled: true},
		{Key: "b", Name: "Beta", Enabled: true},
	}}
	live := []mediamtx.IngestPath{{Key: "a", Ready: true}, {Key: "b", Ready: true}}
	comp := Composition{Include: "auto"}

	got := Select(live, store, comp, "live")
	byKey := map[string]Source{}
	for _, s := range got {
		byKey[s.Key] = s
	}
	if byKey["a"].Label != "The A Stream" {
		t.Errorf("nickname should win, trimmed: got %q", byKey["a"].Label)
	}
	if byKey["b"].Label != "Beta" {
		t.Errorf("with no nickname, label should fall back to name: got %q", byKey["b"].Label)
	}
}

func TestSelectUnconfiguredLiveSourceFallsBackToKeyAsName(t *testing.T) {
	store := &fakeStore{}
	live := []mediamtx.IngestPath{{Key: "unlisted", Ready: true}}
	comp := Composition{Include: "auto"}

	got := Select(live, store, comp, "live")
	if len(got) != 1 || got[0].Name != "unlisted" || got[0].Label != "unlisted" {
		t.Fatalf("an unconfigured source should still be selected, using its key as name/label, got %+v", got)
	}
}

func TestSelectPathUsesIngestPrefix(t *testing.T) {
	store := &fakeStore{streams: []streamstore.Stream{{Key: "a", Name: "Alpha", Enabled: true}}}
	live := []mediamtx.IngestPath{{Key: "a", Ready: true}}
	got := Select(live, store, Composition{Include: "auto"}, "ingest")
	if len(got) != 1 || got[0].Path != "ingest/a" {
		t.Fatalf("Path should be <ingestPrefix>/<key>, got %+v", got)
	}
}

func TestPlanLayoutTruncatesToTheLayoutsCellCount(t *testing.T) {
	sources := []Source{{Key: "a"}, {Key: "b"}, {Key: "c"}}
	comp := Composition{Layout: "solo", Width: 1920, Height: 1080, GapPx: 4}

	p := PlanLayout(sources, comp)
	if len(p.Placed) != 1 {
		t.Fatalf("solo layout has one cell, so only one source should be placed, got %d", len(p.Placed))
	}
	if p.Placed[0].Key != "a" {
		t.Errorf("placed source should be the first one, got %q", p.Placed[0].Key)
	}
}

func TestPlanLayoutPlacesEverySourceWhenTheGridHasRoom(t *testing.T) {
	sources := []Source{{Key: "a"}, {Key: "b"}}
	comp := Composition{Layout: "auto", Width: 1920, Height: 1080, GapPx: 4}

	p := PlanLayout(sources, comp)
	if len(p.Placed) != 2 || len(p.Layout.Cells) != 2 {
		t.Fatalf("both sources should fit and be placed, got placed=%d cells=%d", len(p.Placed), len(p.Layout.Cells))
	}
}
