package authhook

import (
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

func testHook() (*Hook, *streamstore.Memory) {
	store := streamstore.NewMemory()
	store.Replace([]streamstore.Stream{
		{Key: "good-key", Enabled: true},
		{Key: "disabled-key", Enabled: false},
	}, nil, nil, false, "", "")

	cfg := config.Config{
		MediaMTX: config.MediaMTX{
			InternalUser:     "composer",
			InternalPassword: "internal-secret",
		},
		IngestPrefix: "live",
		ProgramPath:  "program",
		AudioPrefix:  "audio",
	}
	log := slog.New(slog.NewTextHandler(nopWriter{}, nil))
	return New(store, cfg, log), store
}

type nopWriter struct{}

func (nopWriter) Write(p []byte) (int, error) { return len(p), nil }

func internalBody(b Body) Body {
	b.User = "composer"
	b.Password = "internal-secret"
	return b
}

func TestDecidePublish(t *testing.T) {
	h, _ := testHook()

	cases := []struct {
		name  string
		body  Body
		allow bool
	}{
		{"the compositor may publish the programme", internalBody(Body{Action: "publish", Path: "program"}), true},
		{"nobody else may publish the programme", Body{Action: "publish", Path: "program"}, false},
		{"the audio relay may publish an audio path", internalBody(Body{Action: "publish", Path: "audio/good-key"}), true},
		{"nobody else may publish an audio path", Body{Action: "publish", Path: "audio/good-key"}, false},
		{"a valid stream key may publish", Body{Action: "publish", Path: "live/good-key"}, true},
		{"a disabled stream key may not publish", Body{Action: "publish", Path: "live/disabled-key"}, false},
		{"an unknown stream key may not publish", Body{Action: "publish", Path: "live/no-such-key"}, false},
		{"a nested publish path is refused", Body{Action: "publish", Path: "live/good-key/extra"}, false},
		{"publish outside the ingest prefix is refused", Body{Action: "publish", Path: "elsewhere/good-key"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v := h.Decide(c.body)
			if v.Allow != c.allow {
				t.Errorf("Decide(%+v) = %+v, want allow=%v", c.body, v, c.allow)
			}
		})
	}
}

func TestDecideRead(t *testing.T) {
	h, _ := testHook()

	cases := []struct {
		name  string
		body  Body
		allow bool
	}{
		{"a read without the internal credential is refused, even for a valid path", Body{Action: "read", Path: "live/good-key"}, false},
		{"the internal caller may read the programme", internalBody(Body{Action: "read", Path: "program"}), true},
		{"the internal caller may read a valid stream key", internalBody(Body{Action: "read", Path: "live/good-key"}), true},
		{"the internal caller may not read a disabled stream key", internalBody(Body{Action: "read", Path: "live/disabled-key"}), false},
		{"the internal caller may read an audio path for a valid key", internalBody(Body{Action: "read", Path: "audio/good-key"}), true},
		{"an unknown path is refused even internally", internalBody(Body{Action: "read", Path: "nonsense/path"}), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v := h.Decide(c.body)
			if v.Allow != c.allow {
				t.Errorf("Decide(%+v) = %+v, want allow=%v", c.body, v, c.allow)
			}
		})
	}
}

func TestDecideUnknownAction(t *testing.T) {
	h, _ := testHook()
	if v := h.Decide(Body{Action: "delete", Path: "live/good-key"}); v.Allow {
		t.Errorf("an unrecognized action must never be allowed for a non-internal caller, got %+v", v)
	}
	if v := h.Decide(internalBody(Body{Action: "delete", Path: "live/good-key"})); !v.Allow {
		t.Errorf("the internal caller is allowed through as a catch-all, got %+v", v)
	}
}

func TestVerifyToken(t *testing.T) {
	h, _ := testHook()
	if !h.VerifyToken("internal-secret") {
		t.Error("the correct token must verify")
	}
	if h.VerifyToken("wrong") {
		t.Error("an incorrect token must not verify")
	}
	if h.VerifyToken("") {
		t.Error("an empty token must not verify")
	}
}

func TestVerifyTokenWithNoConfiguredSecret(t *testing.T) {
	store := streamstore.NewMemory()
	cfg := config.Config{IngestPrefix: "live", ProgramPath: "program", AudioPrefix: "audio"}
	h := New(store, cfg, slog.New(slog.NewTextHandler(nopWriter{}, nil)))
	if h.VerifyToken("anything") {
		t.Error("with no configured secret, every request must be refused")
	}
}

func TestServeHTTP(t *testing.T) {
	h, _ := testHook()

	body, _ := json.Marshal(internalBody(Body{Action: "publish", Path: "program"}))
	req := httptest.NewRequest("POST", "/hook", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Errorf("allowed request: got status %d, want 200", rec.Code)
	}

	body, _ = json.Marshal(Body{Action: "publish", Path: "program"})
	req = httptest.NewRequest("POST", "/hook", strings.NewReader(string(body)))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Errorf("denied request: got status %d, want 401", rec.Code)
	}
}
