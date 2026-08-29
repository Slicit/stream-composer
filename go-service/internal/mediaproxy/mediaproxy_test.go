package mediaproxy

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Slicit/stream-composer/go-service/internal/compositionscheduler"
	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

func testResolver(publicViewing bool) (Resolver, *streamstore.Memory) {
	store := streamstore.NewMemory()
	store.Replace([]streamstore.Stream{
		{ID: "1", Key: "pub-key", PlaybackID: "aaaaaaaaaaaaaaaa", Enabled: true, Visibility: "public"},
		{ID: "2", Key: "priv-key", PlaybackID: "bbbbbbbbbbbbbbbb", Enabled: true, Visibility: "private", SharedWith: []string{"granted-1"}},
		{ID: "3", Key: "off-key", PlaybackID: "cccccccccccccccc", Enabled: false, Visibility: "public"},
	}, nil, nil, nil, publicViewing, "", "")
	cfg := config.Config{IngestPrefix: "live", ProgramPath: "program", AudioPrefix: "audio"}
	return Resolver{Store: store, Config: cfg}, store
}

func TestResolvePlaybackProgram(t *testing.T) {
	r, _ := testResolver(false)
	if _, ok := r.ResolvePlayback(PublicProgram, nil); ok {
		t.Error("anonymous should be refused the programme when public viewing is off")
	}
	if _, ok := r.ResolvePlayback(PublicProgram, &streamstore.User{ID: "x", Role: "viewer"}); !ok {
		t.Error("a signed-in viewer should reach the programme regardless of public viewing")
	}

	rOpen, _ := testResolver(true)
	if _, ok := rOpen.ResolvePlayback(PublicProgram, nil); !ok {
		t.Error("anonymous should reach the programme once public viewing is on")
	}
}

func TestResolvePlaybackStream(t *testing.T) {
	r, _ := testResolver(false)

	if path, ok := r.ResolvePlayback("s/aaaaaaaaaaaaaaaa", nil); !ok || path != "live/pub-key" {
		t.Errorf("public stream for anonymous: got (%q, %v)", path, ok)
	}
	if _, ok := r.ResolvePlayback("s/bbbbbbbbbbbbbbbb", nil); ok {
		t.Error("SECURITY: a private stream must not resolve for anonymous")
	}
	if _, ok := r.ResolvePlayback("s/bbbbbbbbbbbbbbbb", &streamstore.User{ID: "stranger", Role: "viewer"}); ok {
		t.Error("SECURITY: a private stream must not resolve for a stranger")
	}
	if path, ok := r.ResolvePlayback("s/bbbbbbbbbbbbbbbb", &streamstore.User{ID: "granted-1", Role: "viewer"}); !ok || path != "live/priv-key" {
		t.Errorf("a granted user should resolve the private stream: got (%q, %v)", path, ok)
	}
	if _, ok := r.ResolvePlayback("s/cccccccccccccccc", &streamstore.User{ID: "admin", Role: "admin"}); ok {
		t.Error("a disabled stream must never resolve, even for an admin")
	}
	if _, ok := r.ResolvePlayback("s/unknown0000000", nil); ok {
		t.Error("an unknown playback id must not resolve")
	}
}

func TestResolvePlaybackAudio(t *testing.T) {
	r, _ := testResolver(false)
	if path, ok := r.ResolvePlayback("s/aaaaaaaaaaaaaaaa/audio", nil); !ok || path != "audio/pub-key" {
		t.Errorf("public stream audio monitor: got (%q, %v)", path, ok)
	}
	if _, ok := r.ResolvePlayback("s/bbbbbbbbbbbbbbbb/audio", nil); ok {
		t.Error("SECURITY: the audio-monitor form must be gated the same way as video")
	}
}

func TestParseRequestRejectsTraversalAndEncoding(t *testing.T) {
	r, _ := testResolver(false)
	user := &streamstore.User{ID: "granted-1", Role: "viewer"}

	cases := []string{
		"/s/bbbbbbbbbbbbbbbb/whep/../../etc/passwd",
		"/s/%62bbbbbbbbbbbbb/whep", // percent-encoding rejected wholesale
		"/s/bbbbbbbbbbbbbbbb\\whep",
	}
	for _, raw := range cases {
		if _, ok := r.ParseRequest(raw, "webrtc", user); ok {
			t.Errorf("SECURITY: ParseRequest(%q) should be rejected", raw)
		}
	}
}

func TestParseRequestWebRTC(t *testing.T) {
	r, _ := testResolver(false)
	user := &streamstore.User{ID: "granted-1", Role: "viewer"}

	p, ok := r.ParseRequest("/s/bbbbbbbbbbbbbbbb/whep", "webrtc", user)
	if !ok {
		t.Fatal("expected a valid WHEP request to parse")
	}
	if p.UpstreamPath != "/live/priv-key/whep" {
		t.Errorf("UpstreamPath = %q", p.UpstreamPath)
	}

	p, ok = r.ParseRequest("/s/bbbbbbbbbbbbbbbb/whep/sess-123", "webrtc", user)
	if !ok || p.UpstreamPath != "/live/priv-key/whep/sess-123" {
		t.Errorf("session-id form: got %+v, ok=%v", p, ok)
	}

	// WHIP (publish) must never be routed — parseRequest only ever builds a
	// /whep upstream path, never /whip, regardless of what the client asks for.
	if _, ok := r.ParseRequest("/s/bbbbbbbbbbbbbbbb/whip", "webrtc", user); ok {
		t.Error("SECURITY: a WHIP path must not parse as a playback request")
	}
}

func TestParseRequestHLS(t *testing.T) {
	r, _ := testResolver(false)
	user := &streamstore.User{ID: "granted-1", Role: "viewer"}

	p, ok := r.ParseRequest("/s/bbbbbbbbbbbbbbbb/index.m3u8", "hls", user)
	if !ok || p.UpstreamPath != "/live/priv-key/index.m3u8" {
		t.Errorf("got %+v, ok=%v", p, ok)
	}

	if _, ok := r.ParseRequest("/s/bbbbbbbbbbbbbbbb/not-a-playlist.txt", "hls", user); ok {
		t.Error("an arbitrary file extension must not parse")
	}
}

func testComposedPreviewResolver() Resolver {
	store := streamstore.NewMemory()
	store.Replace(nil, nil, nil, []streamstore.ChannelComposition{
		{ID: "cc1", ChannelID: "chan-1", Orientation: "horizontal", Enabled: true, PreviewToken: "the-real-token"},
		{ID: "cc2", ChannelID: "chan-1", Orientation: "vertical", Enabled: false, PreviewToken: "vertical-token"},
	}, false, "", "")
	return Resolver{Store: store, Config: config.Config{ComposedPrefix: "composed"}, Generations: compositionscheduler.NewGenerations()}
}

func TestParseRequestComposedPreview(t *testing.T) {
	r := testComposedPreviewResolver()

	// No session is ever passed here — the whole point is that this path
	// authorizes VLC, which has no sc_session cookie to send. No
	// generation has ever gone live in this test's registry, so this
	// falls back to the base (non-generation) path.
	p, ok := r.ParseRequest("/c/chan-1/horizontal/index.m3u8?token=the-real-token", "hls", nil)
	if !ok || p.UpstreamPath != "/composed/chan-1/horizontal/index.m3u8" {
		t.Errorf("got %+v, ok=%v", p, ok)
	}
	if p.RedirectPublicPath != "c/chan-1/horizontal" {
		t.Errorf("RedirectPublicPath = %q, want the bare public path (no generation to embed yet)", p.RedirectPublicPath)
	}
}

// Once a generation has actually gone live, a fresh (no-generation) request
// resolves to it, and RewriteLocation would embed it into the redirect a
// real player follows — see TestRewriteLocationEmbedsTheCurrentGeneration.
func TestParseRequestComposedPreviewResolvesToTheCurrentGeneration(t *testing.T) {
	r := testComposedPreviewResolver()
	r.Generations.Set("chan-1", "horizontal", "composed/chan-1/horizontal/g3", "3")

	p, ok := r.ParseRequest("/c/chan-1/horizontal/index.m3u8?token=the-real-token", "hls", nil)
	if !ok || p.UpstreamPath != "/composed/chan-1/horizontal/g3/index.m3u8" {
		t.Errorf("got %+v, ok=%v", p, ok)
	}
	if p.RedirectPublicPath != "c/chan-1/horizontal/g3" {
		t.Errorf("RedirectPublicPath = %q, want the generation embedded", p.RedirectPublicPath)
	}
}

// The whole point of a generation-qualified URL: it resolves to that exact
// generation regardless of what's current, so an in-flight viewer session
// against a generation that's draining (been handed off away from, but not
// yet stopped) keeps working rather than 404ing the instant a newer
// generation goes live.
func TestParseRequestComposedPreviewWithAGenerationIgnoresWhatsCurrent(t *testing.T) {
	r := testComposedPreviewResolver()
	r.Generations.Set("chan-1", "horizontal", "composed/chan-1/horizontal/g5", "5") // g5 is current...

	// ...but this request is for the older g3, an in-flight session that
	// predates the handoff to g5.
	p, ok := r.ParseRequest("/c/chan-1/horizontal/g3/video1_stream.m3u8?session=abc&token=the-real-token", "hls", nil)
	if !ok || p.UpstreamPath != "/composed/chan-1/horizontal/g3/video1_stream.m3u8" {
		t.Errorf("got %+v, ok=%v", p, ok)
	}
}

func TestParseRequestComposedPreviewRejectsAnUnknownGenerationFormat(t *testing.T) {
	r := testComposedPreviewResolver()
	if _, ok := r.ParseRequest("/c/chan-1/horizontal/gnot-a-number/index.m3u8?token=the-real-token", "hls", nil); ok {
		t.Error("a malformed generation segment must not parse as one")
	}
}

func TestParseRequestComposedPreviewRejectsAWrongToken(t *testing.T) {
	r := testComposedPreviewResolver()
	if _, ok := r.ParseRequest("/c/chan-1/horizontal/index.m3u8?token=guessed", "hls", nil); ok {
		t.Error("SECURITY: a wrong token must not resolve")
	}
}

func TestParseRequestComposedPreviewRejectsAMissingToken(t *testing.T) {
	r := testComposedPreviewResolver()
	if _, ok := r.ParseRequest("/c/chan-1/horizontal/index.m3u8", "hls", nil); ok {
		t.Error("SECURITY: no token at all must not resolve")
	}
}

func TestParseRequestComposedPreviewRejectsADisabledComposition(t *testing.T) {
	r := testComposedPreviewResolver()
	if _, ok := r.ParseRequest("/c/chan-1/vertical/index.m3u8?token=vertical-token", "hls", nil); ok {
		t.Error("a disabled composition must not resolve, even with its real token")
	}
}

func TestParseRequestComposedPreviewRejectsAnUnknownComposition(t *testing.T) {
	r := testComposedPreviewResolver()
	if _, ok := r.ParseRequest("/c/no-such-channel/horizontal/index.m3u8?token=the-real-token", "hls", nil); ok {
		t.Error("an unknown (channel, orientation) pair must not resolve")
	}
}

// The WebRTC/WHEP mount deliberately does not get this treatment — HLS is
// all VLC needs, and keeping WHEP session-only avoids growing this token's
// scope any further than it has to be.
func TestParseRequestComposedPreviewDoesNotApplyToWebRTC(t *testing.T) {
	r := testComposedPreviewResolver()
	if _, ok := r.ParseRequest("/c/chan-1/horizontal/whep?token=the-real-token", "webrtc", nil); ok {
		t.Error("the composed-preview token must not authorize the WebRTC mount")
	}
}

// The redirect a real player follows (MediaMTX's own cookieCheck bounce)
// must embed the resolved generation, not the bare public path — that's
// what makes every later relative fetch for this player's session (the
// sub-playlist reference right there in the master playlist body, then its
// own init segment and media segments) keep hitting the same generation,
// see Parsed.RedirectPublicPath's own doc comment.
func TestRewriteLocationEmbedsTheCurrentGeneration(t *testing.T) {
	parsed := &Parsed{PublicPath: "c/chan-1/horizontal", MediaPath: "composed/chan-1/horizontal/g3", RedirectPublicPath: "c/chan-1/horizontal/g3"}

	got := RewriteLocation("/composed/chan-1/horizontal/g3/index.m3u8?cookieCheck=1", HLSMount, parsed)
	want := HLSMount + "/c/chan-1/horizontal/g3/index.m3u8?cookieCheck=1"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestRewriteLocation(t *testing.T) {
	parsed := &Parsed{PublicPath: "s/bbbbbbbbbbbbbbbb", MediaPath: "live/priv-key"}

	got := RewriteLocation("/live/priv-key/whep/abc?x=1", HLSMount, parsed)
	want := HLSMount + "/s/bbbbbbbbbbbbbbbb/whep/abc?x=1"
	if got != want {
		t.Errorf("relative location: got %q, want %q", got, want)
	}

	got = RewriteLocation("http://mediamtx:8888/live/priv-key/index.m3u8", HLSMount, parsed)
	want = HLSMount + "/s/bbbbbbbbbbbbbbbb/index.m3u8"
	if got != want {
		t.Errorf("absolute location: got %q, want %q", got, want)
	}

	// An upstream location outside the resolved media path must never leak
	// through — the ingest key lives in that path.
	got = RewriteLocation("/live/someone-elses-key/whep", HLSMount, parsed)
	want = HLSMount + "/s/bbbbbbbbbbbbbbbb"
	if got != want {
		t.Errorf("SECURITY: unexpected location: got %q, want %q", got, want)
	}
}

func TestForwardStripsAuthAndAddsInternalCredential(t *testing.T) {
	var gotAuth, gotCookie string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		gotAuth = req.Header.Get("Authorization")
		gotCookie = req.Header.Get("Cookie")
		w.Header().Set("Set-Cookie", "sc_session=leaked; Path=/")
		w.Header().Add("Set-Cookie", "cookieCheck=1; Path=/")
		w.WriteHeader(200)
		_, _ = w.Write([]byte("ok"))
	}))
	defer upstream.Close()

	store := streamstore.NewMemory()
	store.Replace([]streamstore.Stream{{Key: "pub-key", PlaybackID: "aaaaaaaaaaaaaaaa", Enabled: true, Visibility: "public"}}, nil, nil, nil, false, "", "")
	cfg := config.Config{
		IngestPrefix: "live", ProgramPath: "program", AudioPrefix: "audio",
		MediaMTX: config.MediaMTX{InternalUser: "composer", InternalPassword: "internal-secret"},
	}
	h := New(store, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), compositionscheduler.NewGenerations())

	req := httptest.NewRequest(http.MethodPost, WebRTCMount+"/s/aaaaaaaaaaaaaaaa/whep", nil)
	req.Header.Set("Authorization", "Bearer client-supplied-should-be-stripped")
	req.Header.Set("Cookie", "sc_session=abc; other=1")
	rec := httptest.NewRecorder()

	h.ServeWebRTC(rec, req, upstream.URL)

	if gotAuth == "" || gotAuth == "Bearer client-supplied-should-be-stripped" {
		t.Errorf("SECURITY: the client's Authorization header must be replaced, got %q", gotAuth)
	}
	if gotCookie != "" {
		t.Errorf("SECURITY: the client's cookie must never reach upstream, got %q", gotCookie)
	}
	if rec.Code != 200 {
		t.Errorf("status = %d", rec.Code)
	}
	setCookies := rec.Header().Values("Set-Cookie")
	for _, c := range setCookies {
		if len(c) >= len("sc_session=") && c[:len("sc_session=")] == "sc_session=" {
			t.Errorf("SECURITY: upstream must never be able to set our session cookie, got %q", c)
		}
	}
	found := false
	for _, c := range setCookies {
		if c == "cookieCheck=1; Path=/" {
			found = true
		}
	}
	if !found {
		t.Error("a harmless upstream cookie should still pass through")
	}
}

func TestServeWebRTCRejectsGET(t *testing.T) {
	store := streamstore.NewMemory()
	cfg := config.Config{IngestPrefix: "live", ProgramPath: "program", AudioPrefix: "audio"}
	h := New(store, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), compositionscheduler.NewGenerations())

	req := httptest.NewRequest(http.MethodGet, WebRTCMount+"/program/whep", nil)
	rec := httptest.NewRecorder()
	h.ServeWebRTC(rec, req, "http://unused")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("SECURITY: GET must never reach the WebRTC mount (that is MediaMTX's own publish page), got %d", rec.Code)
	}
}

func TestServeHLSRejectsPost(t *testing.T) {
	store := streamstore.NewMemory()
	cfg := config.Config{IngestPrefix: "live", ProgramPath: "program", AudioPrefix: "audio"}
	h := New(store, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), compositionscheduler.NewGenerations())

	req := httptest.NewRequest(http.MethodPost, HLSMount+"/program/index.m3u8", nil)
	rec := httptest.NewRecorder()
	h.ServeHLS(rec, req, "http://unused")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("got %d", rec.Code)
	}
}
