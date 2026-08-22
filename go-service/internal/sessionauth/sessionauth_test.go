package sessionauth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveSendsOnlyTheDigestNeverTheRawToken(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sessionResponse{ID: "user-1", Role: "admin"})
	}))
	defer server.Close()

	resolver := &Resolver{BaseURL: server.URL, Token: "internal-secret"}
	user, err := resolver.Resolve(context.Background(), "raw-cookie-token")
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if user == nil || user.ID != "user-1" || user.Role != "admin" {
		t.Fatalf("got %+v, want id=user-1 role=admin", user)
	}

	sum := sha256.Sum256([]byte("raw-cookie-token"))
	wantDigest := hex.EncodeToString(sum[:])
	wantPath := "/internal/internal-secret/sessions/" + wantDigest
	if gotPath != wantPath {
		t.Errorf("request path = %q, want %q (must carry the digest, never the raw token)", gotPath, wantPath)
	}
}

func TestResolveReturnsNoUserFor404WithoutError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	resolver := &Resolver{BaseURL: server.URL, Token: "internal-secret"}
	user, err := resolver.Resolve(context.Background(), "unknown-token")
	if err != nil {
		t.Fatalf("a 404 (no such session) must not be an error, got %v", err)
	}
	if user != nil {
		t.Errorf("expected no user for an unknown session, got %+v", user)
	}
}

func TestResolveReturnsNoUserForAnEmptyToken(t *testing.T) {
	resolver := &Resolver{BaseURL: "http://unreachable.invalid", Token: "internal-secret"}
	user, err := resolver.Resolve(context.Background(), "")
	if err != nil || user != nil {
		t.Errorf("an empty token should resolve to (nil, nil) without a network call, got (%+v, %v)", user, err)
	}
}

func TestResolveReturnsAnErrorForAServerFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	resolver := &Resolver{BaseURL: server.URL, Token: "internal-secret"}
	if _, err := resolver.Resolve(context.Background(), "some-token"); err == nil {
		t.Error("expected an error for a non-200/404 response")
	}
}
