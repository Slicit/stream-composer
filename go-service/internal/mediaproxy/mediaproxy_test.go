package mediaproxy

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

func testResolver(publicViewing bool) (Resolver, *streamstore.Memory) {
	store := streamstore.NewMemory()
	store.Replace([]streamstore.Stream{
		{ID: "1", Key: "pub-key", PlaybackID: "aaaaaaaaaaaaaaaa", Enabled: true, Visibility: "public"},
		{ID: "2", Key: "priv-key", PlaybackID: "bbbbbbbbbbbbbbbb", Enabled: true, Visibility: "private", SharedWith: []string{"granted-1"}},
		{ID: "3", Key: "off-key", PlaybackID: "cccccccccccccccc", Enabled: false, Visibility: "public"},
	}, nil, nil, publicViewing, "", "")
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
	store.Replace([]streamstore.Stream{{Key: "pub-key", PlaybackID: "aaaaaaaaaaaaaaaa", Enabled: true, Visibility: "public"}}, nil, nil, false, "", "")
	cfg := config.Config{
		IngestPrefix: "live", ProgramPath: "program", AudioPrefix: "audio",
		MediaMTX: config.MediaMTX{InternalUser: "composer", InternalPassword: "internal-secret"},
	}
	h := New(store, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))

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
	h := New(store, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))

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
	h := New(store, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))

	req := httptest.NewRequest(http.MethodPost, HLSMount+"/program/index.m3u8", nil)
	rec := httptest.NewRecorder()
	h.ServeHLS(rec, req, "http://unused")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("got %d", rec.Code)
	}
}
