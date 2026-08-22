// Package authhook is MediaMTX's external authentication callback — a direct
// port of server/src/routes/hooks.js. MediaMTX is configured with
// authMethod: http pointing here, so every publish/read decision is made
// against the live stream set with no media-server restart required.
//
// Contract: 200 = allow, 401 = deny.
package authhook

import (
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

// Body is the JSON MediaMTX posts to the auth hook.
type Body struct {
	Action   string `json:"action"`
	Path     string `json:"path"`
	Protocol string `json:"protocol"`
	IP       string `json:"ip"`
	User     string `json:"user"`
	Password string `json:"password"`
}

type Verdict struct {
	Allow  bool
	Reason string
}

// private10, private172, private192 are the RFC 1918 ranges recognized as
// "inside the stack" — the same set server/src/routes/hooks.js checks.
var (
	private10  = mustParseCIDR("10.0.0.0/8")
	private172 = mustParseCIDR("172.16.0.0/12")
	private192 = mustParseCIDR("192.168.0.0/16")
)

func mustParseCIDR(s string) *net.IPNet {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		panic(err)
	}
	return n
}

func isLocalAddress(raw string) bool {
	a := strings.TrimPrefix(raw, "::ffff:")
	if a == "127.0.0.1" || a == "::1" {
		return true
	}
	ip := net.ParseIP(a)
	if ip == nil {
		return false
	}
	return private10.Contains(ip) || private172.Contains(ip) || private192.Contains(ip)
}

// isAuthChallenge recognizes RTSP's normal "ask once with no credentials,
// get 401, ask again with them" first leg from a caller inside the stack
// (the compositor reading its own sources, several times a minute) so it can
// be logged quietly instead of as a warning.
func isAuthChallenge(b Body) bool {
	return strings.EqualFold(b.Protocol, "rtsp") && b.User == "" && b.Password == "" && isLocalAddress(b.IP)
}

func safeEqual(a, b string) bool {
	if len(a) == 0 || len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// Hook decides publish/read authorization against a live Store.
type Hook struct {
	Store  streamstore.Store
	Config config.Config
	Log    *slog.Logger

	denyMu   sync.Mutex
	deniedAt map[string]time.Time
}

func New(store streamstore.Store, cfg config.Config, log *slog.Logger) *Hook {
	return &Hook{Store: store, Config: cfg, Log: log, deniedAt: make(map[string]time.Time)}
}

func (h *Hook) isInternal(b Body) bool {
	if h.Config.MediaMTX.InternalPassword == "" {
		return false
	}
	return safeEqual(b.User, h.Config.MediaMTX.InternalUser) && safeEqual(b.Password, h.Config.MediaMTX.InternalPassword)
}

// Decide is the pure decision function — server/src/routes/hooks.js's
// decide(), ported field-for-field so behavior can be diffed against it.
func (h *Hook) Decide(b Body) Verdict {
	path := strings.TrimLeft(b.Path, "/")
	prefix := h.Config.IngestPrefix + "/"
	internal := h.isInternal(b)

	switch b.Action {
	case "publish":
		if path == h.Config.ProgramPath {
			if internal {
				return Verdict{true, "compositor"}
			}
			return Verdict{false, "the program path is written by the compositor only"}
		}
		if strings.HasPrefix(path, h.Config.AudioPrefix+"/") {
			if internal {
				return Verdict{true, "audio relay"}
			}
			return Verdict{false, "the audio path is written by the audio relay only"}
		}
		if !strings.HasPrefix(path, prefix) {
			return Verdict{false, `publish to "` + h.Config.IngestPrefix + `/<stream key>"`}
		}
		key := strings.TrimPrefix(path, prefix)
		if strings.Contains(key, "/") {
			return Verdict{false, "nested paths are not allowed"}
		}
		stream, ok := h.Store.FindByKey(key)
		if !ok {
			return Verdict{false, "unknown stream key"}
		}
		if !stream.Enabled {
			return Verdict{false, "stream is disabled"}
		}
		return Verdict{true, "valid stream key"}

	case "read":
		if !internal {
			return Verdict{false, "reads require the internal credential"}
		}
		if path == h.Config.ProgramPath {
			return Verdict{true, "programme"}
		}
		if strings.HasPrefix(path, prefix) {
			key := firstSegment(strings.TrimPrefix(path, prefix))
			if stream, ok := h.Store.FindByKey(key); ok && stream.Enabled {
				return Verdict{true, "ingest preview"}
			}
			return Verdict{false, "unknown or disabled stream key"}
		}
		if strings.HasPrefix(path, h.Config.AudioPrefix+"/") {
			key := firstSegment(strings.TrimPrefix(path, h.Config.AudioPrefix+"/"))
			if stream, ok := h.Store.FindByKey(key); ok && stream.Enabled {
				return Verdict{true, "audio monitor"}
			}
			return Verdict{false, "unknown or disabled stream key"}
		}
		return Verdict{false, "unknown path"}
	}

	if internal {
		return Verdict{true, "internal"}
	}
	return Verdict{false, `action "` + b.Action + `" is not permitted`}
}

func firstSegment(s string) string {
	if i := strings.IndexByte(s, '/'); i >= 0 {
		return s[:i]
	}
	return s
}

// logDenial rate-limits repeated denials of the same shape so a scanner
// cannot fill the log with lines, mirroring hooks.js's denyLog Map.
func (h *Hook) logDenial(v Verdict, b Body) {
	if isAuthChallenge(b) {
		h.Log.Debug("denied, awaiting credentials", "reason", v.Reason, "action", b.Action, "path", b.Path)
		return
	}
	key := b.Action + ":" + b.Path + ":" + v.Reason
	now := time.Now()

	h.denyMu.Lock()
	last, seen := h.deniedAt[key]
	if seen && now.Sub(last) < 10*time.Second {
		h.denyMu.Unlock()
		return
	}
	h.deniedAt[key] = now
	if len(h.deniedAt) > 500 {
		h.deniedAt = make(map[string]time.Time)
	}
	h.denyMu.Unlock()

	h.Log.Warn("denied", "reason", v.Reason, "action", b.Action, "path", b.Path, "ip", b.IP, "protocol", b.Protocol)
}

// VerifyToken checks the shared secret carried in the hook URL itself — the
// only channel available, since MediaMTX cannot send custom headers to its
// auth backend. A source-address check alone would not be enough behind a
// reverse proxy, where every request arrives from the same container-network
// address regardless of who sent it originally.
func (h *Hook) VerifyToken(token string) bool {
	expected := h.Config.MediaMTX.InternalPassword
	if expected == "" {
		h.Log.Error("MEDIAMTX_INTERNAL_PASSWORD is not set, refusing every authentication request")
		return false
	}
	return safeEqual(token, expected)
}

// ServeHTTP handles one MediaMTX auth callback. The caller is expected to
// have already verified the token (see VerifyToken) as part of routing.
func (h *Hook) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var b Body
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&b); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "internal error"})
		return
	}

	v := h.Decide(b)
	if v.Allow {
		if b.Action == "publish" && v.Reason != "compositor" {
			h.Log.Info("publisher accepted", "path", b.Path, "ip", b.IP, "protocol", b.Protocol)
		} else {
			h.Log.Debug("allowed", "action", b.Action, "path", b.Path)
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	h.logDenial(v, b)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": v.Reason})
}
