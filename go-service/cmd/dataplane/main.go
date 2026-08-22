// Command dataplane is the Go data-plane service: the MediaMTX auth hook and
// the WHEP/HLS media proxy, split out of the Node backend during the
// Rails/Postgres/React migration (see LOGBOOK/features for the plan).
//
// Stream configuration comes from one of two sources, chosen at boot by
// which environment variables are set: RailsBridge (RAILS_INTERNAL_API_URL
// + RAILS_INTERNAL_API_TOKEN) polls the Rails control plane's internal
// API — the real integration, once Rails owns the data. JSONBridge
// (STREAM_CONFIG_PATH) reads the same JSON file the legacy Node backend
// still writes — kept only for standalone testing without Rails running.
// Nothing in the auth hook or the media proxy changes for either choice;
// both depend only on the streamstore.Store interface.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/audiomonitor"
	"github.com/Slicit/stream-composer/go-service/internal/authhook"
	"github.com/Slicit/stream-composer/go-service/internal/bandwidthhistory"
	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/mediaproxy"
	"github.com/Slicit/stream-composer/go-service/internal/relayrunner"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	cfg := config.Load()

	store := streamstore.NewMemory()

	switch {
	case os.Getenv("RAILS_INTERNAL_API_URL") != "":
		bridge := &streamstore.RailsBridge{
			BaseURL: os.Getenv("RAILS_INTERNAL_API_URL"),
			Token:   os.Getenv("RAILS_INTERNAL_API_TOKEN"),
			Store:   store,
			Log:     log,
		}
		if err := bridge.Load(); err != nil {
			log.Error("initial stream config load from Rails failed", "error", err.Error())
			os.Exit(1)
		}
		stop := make(chan struct{})
		defer close(stop)
		go bridge.Poll(2*time.Second, stop)
		log.Info("streaming stream config from Rails", "url", bridge.BaseURL)
	case os.Getenv("STREAM_CONFIG_PATH") != "":
		bridge := &streamstore.JSONBridge{Path: os.Getenv("STREAM_CONFIG_PATH"), Store: store, Log: log}
		if err := bridge.Load(); err != nil {
			log.Error("initial stream config load failed", "error", err.Error())
			os.Exit(1)
		}
		stop := make(chan struct{})
		defer close(stop)
		go bridge.Poll(2*time.Second, stop)
		log.Info("streaming stream config from the legacy JSON file", "path", os.Getenv("STREAM_CONFIG_PATH"))
	default:
		log.Warn("neither RAILS_INTERNAL_API_URL nor STREAM_CONFIG_PATH is set — running with an empty stream set")
	}

	hook := authhook.New(store, cfg, log)
	proxy := mediaproxy.New(store, cfg, log)

	mtxClient := &mediamtx.Client{BaseURL: cfg.MediaMTX.API, IngestPrefix: cfg.IngestPrefix}
	relays := relayrunner.New(store, mtxClient, cfg, log)
	relayStop := make(chan struct{})
	defer close(relayStop)
	go relays.Start(context.Background(), time.Duration(cfg.PollIntervalMs)*time.Millisecond, relayStop)
	defer relays.StopAll()

	audio := audiomonitor.New(mtxClient, cfg, log)
	audioStop := make(chan struct{})
	defer close(audioStop)
	go audio.Start(context.Background(), time.Duration(cfg.PollIntervalMs)*time.Millisecond, audioStop)
	defer audio.StopAll()

	bandwidth := bandwidthhistory.New(mtxClient, cfg.IngestPrefix, filepath.Join(cfg.DataDir, "bandwidth-history.json"), log)
	bandwidthStop := make(chan struct{})
	defer close(bandwidthStop)
	go bandwidth.Start(context.Background(), bandwidthStop)

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

	// Same shared-secret-in-the-URL shape as the auth hook above — the
	// admin console (via Rails) is the only intended caller, not a
	// browser, so there is no session guard to check here either.
	mux.HandleFunc("GET /internal/{token}/bandwidth-history", func(w http.ResponseWriter, r *http.Request) {
		if !hook.VerifyToken(r.PathValue("token")) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(bandwidth.Get())
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
