package sessionauth

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Slicit/stream-composer/go-service/internal/mediaproxy"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

func silentLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestGuardAttachesTheResolvedUserToTheContext(t *testing.T) {
	rails := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sessionResponse{ID: "user-1", Role: "streamer"})
	}))
	defer rails.Close()
	resolver := &Resolver{BaseURL: rails.URL, Token: "secret"}

	var seenUser *streamstore.User
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenUser = mediaproxy.UserFromContext(r.Context())
	})
	guarded := Guard(resolver, silentLog(), inner)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: CookieName, Value: "raw-token"})
	guarded.ServeHTTP(httptest.NewRecorder(), req)

	if seenUser == nil || seenUser.ID != "user-1" || seenUser.Role != "streamer" {
		t.Fatalf("got %+v, want id=user-1 role=streamer", seenUser)
	}
}

func TestGuardLeavesTheCallerAnonymousWithNoCookie(t *testing.T) {
	resolver := &Resolver{BaseURL: "http://unreachable.invalid", Token: "secret"}

	var sawUser bool
	var sawNilUser bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := mediaproxy.UserFromContext(r.Context())
		sawUser = true
		sawNilUser = u == nil
	})
	guarded := Guard(resolver, silentLog(), inner)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	guarded.ServeHTTP(httptest.NewRecorder(), req)

	if !sawUser {
		t.Fatal("the inner handler should still run for an anonymous caller")
	}
	if !sawNilUser {
		t.Error("with no session cookie, the context user must be nil")
	}
}

func TestGuardDegradesToAnonymousWhenRailsIsUnreachable(t *testing.T) {
	resolver := &Resolver{BaseURL: "http://unreachable.invalid:1", Token: "secret"}

	var sawNilUser bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawNilUser = mediaproxy.UserFromContext(r.Context()) == nil
	})
	guarded := Guard(resolver, silentLog(), inner)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: CookieName, Value: "raw-token"})
	guarded.ServeHTTP(httptest.NewRecorder(), req)

	if !sawNilUser {
		t.Error("an unreachable Rails must degrade to anonymous, not crash or hang the request")
	}
}
