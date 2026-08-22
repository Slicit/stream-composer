// Command dataplane is the Go data-plane service: the MediaMTX auth hook and
// the WHEP/HLS media proxy, split out of the Node backend during the
// Rails/Postgres/React migration (see LOGBOOK/features for the plan).
//
// It reads stream configuration from the same JSON file the Node backend
// still writes (see internal/streamstore.JSONBridge) — an interim bridge for
// this migration window, replaced by an internal API client once the Rails
// control plane exists. Nothing in the auth hook or the media proxy needs to
// change either time; both depend only on the streamstore.Store interface.
package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/authhook"
	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/mediaproxy"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	cfg := config.Load()

	store := streamstore.NewMemory()

	if configPath := os.Getenv("STREAM_CONFIG_PATH"); configPath != "" {
		bridge := &streamstore.JSONBridge{Path: configPath, Store: store, Log: log}
		if err := bridge.Load(); err != nil {
			log.Error("initial stream config load failed", "error", err.Error())
			os.Exit(1)
		}
		stop := make(chan struct{})
		defer close(stop)
		go bridge.Poll(2*time.Second, stop)
		log.Info("streaming stream config from the legacy JSON file", "path", configPath)
	} else {
		log.Warn("STREAM_CONFIG_PATH is not set — running with an empty stream set")
	}

	hook := authhook.New(store, cfg, log)
	proxy := mediaproxy.New(store, cfg, log)

	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	})

	// Path shape matches server/src/routes/hooks.js exactly: the shared
	// secret travels in the URL, since MediaMTX cannot send custom headers
	// to its auth backend.
	mux.HandleFunc("POST /internal/{token}/mediamtx/auth", func(w http.ResponseWriter, r *http.Request) {
		if !hook.VerifyToken(r.PathValue("token")) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		hook.ServeHTTP(w, r)
	})

	// No session/guard middleware is wired in yet — every caller is
	// anonymous (mediaproxy.UserFromContext returns nil), which is correct
	// today: there is no control plane to ask who is signed in. Public
	// streams and, when publicViewing is on, the programme already work
	// end-to-end; private-stream access resumes once the Rails session
	// lookup is wired in as guard middleware here.
	mux.HandleFunc(mediaproxy.WebRTCMount+"/", func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeWebRTC(w, r, cfg.MediaMTX.WebRTC)
	})
	mux.HandleFunc(mediaproxy.HLSMount+"/", func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHLS(w, r, cfg.MediaMTX.HLS)
	})

	addr := ":" + strings.TrimPrefix(cfg.Port, ":")
	log.Info("data plane listening", "addr", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Error("server stopped", "error", err.Error())
		os.Exit(1)
	}
}
