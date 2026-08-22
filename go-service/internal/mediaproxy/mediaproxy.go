// Package mediaproxy is the reverse proxy for MediaMTX's playback endpoints —
// a direct port of server/src/proxy.js, kept behaviorally identical
// (including its doc comment's four security rules) so the two can be
// diffed against each other during the migration:
//
//  1. Viewers address streams by an opaque playback id, never the ingest key.
//  2. The forwarded URL is rebuilt from validated components; nothing from
//     the client's raw path is passed upstream.
//  3. Only playback verbs are routed. WHIP (publish) is never routed here.
//  4. The client's Authorization header is stripped and replaced with the
//     stack-internal credential.
package mediaproxy

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/Slicit/stream-composer/go-service/internal/access"
	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

const (
	WebRTCMount = "/mtx/webrtc"
	HLSMount    = "/mtx/hls"

	// PublicProgram is the public alias for the composed programme,
	// independent of its internal MediaMTX path.
	PublicProgram = "program"

	protectedCookie = "sc_session"
)

var (
	playbackIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)
	sessionIDRe  = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,128}$`)
	hlsFileRe    = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,128}\.(m3u8|mp4|m4s|ts|mps)$`)
	safeQueryRe  = regexp.MustCompile(`^[A-Za-z0-9_.\-=&%~+/]*$`)
)

// stripRequest headers are never relayed upstream. authorization and cookie
// are ours to control, not the client's.
var stripRequest = map[string]bool{
	"connection": true, "keep-alive": true, "proxy-authenticate": true, "proxy-authorization": true,
	"te": true, "trailer": true, "transfer-encoding": true, "upgrade": true, "host": true, "cookie": true,
	"authorization": true, "x-forwarded-for": true, "x-forwarded-host": true, "x-forwarded-proto": true,
	"forwarded": true,
}

var stripResponse = map[string]bool{
	"connection": true, "keep-alive": true, "proxy-authenticate": true, "transfer-encoding": true,
	"upgrade": true, "www-authenticate": true,
}

// Parsed is a proxied request reduced to validated components. There is no
// lenient path: anything unexpected in the client's URL fails to parse at
// all, rather than being sanitized and forwarded anyway.
type Parsed struct {
	PublicPath   string
	MediaPath    string
	UpstreamPath string
	Query        string
	SessionID    string // WebRTC only
}

// Resolver ties a Store to the access rules and path conventions that decide
// what a playback id is allowed to resolve to.
type Resolver struct {
	Store  streamstore.Store
	Config config.Config
}

// resolveStream finds the stream a playback id refers to, or nil when it is
// unknown, disabled, or not allowed for user. Shared by the video and the
// audio-monitor forms of ResolvePlayback. "user" is nil for an anonymous
// caller.
func (r Resolver) resolveStream(playbackID string, user *streamstore.User) *streamstore.Stream {
	stream, ok := r.Store.FindByPlaybackID(playbackID)
	if !ok || !stream.Enabled {
		return nil
	}
	if !access.CanAccess(stream, user) {
		return nil
	}
	return stream
}

// ResolvePlayback maps a public playback reference onto the real MediaMTX
// path, or reports false when the reference is unknown, disabled, or not
// allowed for user.
func (r Resolver) ResolvePlayback(publicPath string, user *streamstore.User) (string, bool) {
	if publicPath == PublicProgram {
		// The composed programme has no visibility of its own — it keeps the
		// rule it always had: the site-wide "public viewing" setting, or
		// being signed in at all.
		if !r.Store.PublicViewingEnabled() && user == nil {
			return "", false
		}
		return r.Config.ProgramPath, true
	}

	parts := strings.Split(publicPath, "/")

	// The Opus audio monitor: s/<playbackId>/audio, distinct from the raw
	// (AAC) ingest path a browser cannot decode over WebRTC.
	if len(parts) == 3 && parts[0] == "s" && parts[2] == "audio" && playbackIDRe.MatchString(parts[1]) {
		stream := r.resolveStream(parts[1], user)
		if stream == nil {
			return "", false
		}
		return r.Config.AudioPrefix + "/" + stream.Key, true
	}

	if len(parts) != 2 || parts[0] != "s" || !playbackIDRe.MatchString(parts[1]) {
		return "", false
	}
	stream := r.resolveStream(parts[1], user)
	if stream == nil {
		return "", false
	}
	return r.Config.IngestPrefix + "/" + stream.Key, true
}

// ParseRequest strictly parses a proxied request's raw URL into validated
// components. kind is "webrtc" or "hls". Anything unexpected returns
// (nil, false) — there is no lenient path.
func (r Resolver) ParseRequest(rawURL, kind string, user *streamstore.User) (*Parsed, bool) {
	pathPart := rawURL
	query := ""
	if i := strings.IndexByte(rawURL, '?'); i >= 0 {
		pathPart, query = rawURL[:i], rawURL[i+1:]
	}

	// Percent-encoding is rejected wholesale. Every path this proxy serves is
	// built from an unreserved character set, so an encoded byte can only be
	// an attempt to smuggle a separator past validation.
	if strings.Contains(pathPart, "%") || strings.Contains(pathPart, "\\") {
		return nil, false
	}
	if !safeQueryRe.MatchString(query) {
		return nil, false
	}

	var segments []string
	for _, s := range strings.Split(pathPart, "/") {
		if s != "" {
			segments = append(segments, s)
		}
	}
	// Up to 5: s/<playbackId>/audio/whep/<sessionId> for the audio monitor.
	if len(segments) < 2 || len(segments) > 5 {
		return nil, false
	}
	for _, s := range segments {
		if s == "." || s == ".." {
			return nil, false
		}
	}

	if kind == "webrtc" {
		idx := -1
		for i, s := range segments {
			if s == "whep" {
				idx = i
				break
			}
		}
		// "whep" must be the last segment, or the one before a session id.
		if idx < 1 || idx < len(segments)-2 {
			return nil, false
		}
		sessionID := ""
		if idx+1 < len(segments) {
			sessionID = segments[idx+1]
			if !sessionIDRe.MatchString(sessionID) {
				return nil, false
			}
		}

		publicPath := strings.Join(segments[:idx], "/")
		mediaPath, ok := r.ResolvePlayback(publicPath, user)
		if !ok {
			return nil, false
		}

		upstream := "/" + mediaPath + "/whep"
		if sessionID != "" {
			upstream += "/" + sessionID
		}
		return &Parsed{PublicPath: publicPath, MediaPath: mediaPath, UpstreamPath: upstream, Query: query, SessionID: sessionID}, true
	}

	// HLS: the last segment is a playlist or a segment file.
	file := segments[len(segments)-1]
	if !hlsFileRe.MatchString(file) {
		return nil, false
	}
	publicPath := strings.Join(segments[:len(segments)-1], "/")
	mediaPath, ok := r.ResolvePlayback(publicPath, user)
	if !ok {
		return nil, false
	}
	return &Parsed{PublicPath: publicPath, MediaPath: mediaPath, UpstreamPath: "/" + mediaPath + "/" + file, Query: query}, true
}

// RewriteLocation maps an upstream redirect back into our address space:
// /live/<key>/index.m3u8?x=1 becomes /mtx/hls/s/<playbackId>/index.m3u8?x=1.
func RewriteLocation(location, mount string, parsed *Parsed) string {
	var pathname, search string
	if strings.HasPrefix(strings.ToLower(location), "http://") || strings.HasPrefix(strings.ToLower(location), "https://") {
		u, err := url.Parse(location)
		if err != nil {
			return mount + "/" + parsed.PublicPath
		}
		pathname, search = u.Path, u.RawQuery
		if search != "" {
			search = "?" + search
		}
	} else if q := strings.IndexByte(location, '?'); q >= 0 {
		pathname, search = location[:q], location[q:]
	} else {
		pathname = location
	}

	prefix := "/" + parsed.MediaPath
	if pathname == prefix || strings.HasPrefix(pathname, prefix+"/") {
		suffix := pathname[len(prefix):]
		return mount + "/" + parsed.PublicPath + suffix + search
	}
	// Anything unexpected goes back to the public entry point rather than
	// exposing wherever upstream was pointing.
	return mount + "/" + parsed.PublicPath + search
}

func internalAuthHeader(cfg config.Config) string {
	if cfg.MediaMTX.InternalPassword == "" {
		return ""
	}
	raw := cfg.MediaMTX.InternalUser + ":" + cfg.MediaMTX.InternalPassword
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(raw))
}

// Handler serves both the WebRTC/WHEP and HLS mounts. guard runs first and
// must attach the resolved user (nil for anonymous) via WithUser before
// calling next — see user.go.
type Handler struct {
	Resolver   Resolver
	HTTPClient *http.Client
	Log        *slog.Logger
}

func New(store streamstore.Store, cfg config.Config, log *slog.Logger) *Handler {
	return &Handler{
		Resolver: Resolver{Store: store, Config: cfg},
		HTTPClient: &http.Client{
			// Redirects are rewritten and handed back to the client, never
			// followed here — MediaMTX's cookieCheck bounce and the WHEP
			// session Location both depend on the browser seeing them.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		Log: log,
	}
}

// ServeWebRTC handles the WHEP mount. GET is deliberately absent: MediaMTX
// serves its built-in publish/read pages over GET, and WHIP (publishing) is
// never routed from here at all.
func (h *Handler) ServeWebRTC(w http.ResponseWriter, r *http.Request, base string) {
	switch r.Method {
	case http.MethodPost, http.MethodPatch, http.MethodDelete, http.MethodOptions:
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed.")
		return
	}
	parsed, ok := h.Resolver.ParseRequest(r.URL.RequestURI()[len(WebRTCMount):], "webrtc", UserFromContext(r.Context()))
	if !ok {
		writeJSONError(w, http.StatusNotFound, "Unknown stream.")
		return
	}
	h.forward(w, r, base, WebRTCMount, parsed)
}

// ServeHLS handles the HLS mount.
func (h *Handler) ServeHLS(w http.ResponseWriter, r *http.Request, base string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed.")
		return
	}
	parsed, ok := h.Resolver.ParseRequest(r.URL.RequestURI()[len(HLSMount):], "hls", UserFromContext(r.Context()))
	if !ok {
		writeJSONError(w, http.StatusNotFound, "Unknown stream.")
		return
	}
	h.forward(w, r, base, HLSMount, parsed)
}

func (h *Handler) forward(w http.ResponseWriter, r *http.Request, base, mount string, parsed *Parsed) {
	targetURL := base + parsed.UpstreamPath
	if parsed.Query != "" {
		targetURL += "?" + parsed.Query
	}
	target, err := url.Parse(targetURL)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "Bad media path.")
		return
	}

	upReq, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), r.Body)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "The media server is not responding.")
		return
	}
	for k, vs := range r.Header {
		if stripRequest[strings.ToLower(k)] {
			continue
		}
		for _, v := range vs {
			upReq.Header.Add(k, v)
		}
	}
	upReq.Host = target.Host
	if auth := internalAuthHeader(h.Resolver.Config); auth != "" {
		upReq.Header.Set("Authorization", auth)
	}

	upRes, err := h.HTTPClient.Do(upReq)
	if err != nil {
		h.Log.Warn("upstream media request failed", "path", parsed.UpstreamPath, "error", err.Error())
		writeJSONError(w, http.StatusBadGateway, "The media server is not responding.")
		return
	}
	defer upRes.Body.Close()

	for k, vs := range upRes.Header {
		lk := strings.ToLower(k)
		if stripResponse[lk] {
			continue
		}
		if lk == "location" && len(vs) > 0 {
			w.Header().Set("Location", RewriteLocation(vs[0], mount, parsed))
			continue
		}
		if lk == "set-cookie" {
			for _, c := range vs {
				if strings.HasPrefix(strings.ToLower(strings.TrimSpace(c)), protectedCookie+"=") {
					continue
				}
				w.Header().Add("Set-Cookie", c)
			}
			continue
		}
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}

	w.WriteHeader(upRes.StatusCode)
	_, _ = io.Copy(w, upRes.Body)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
