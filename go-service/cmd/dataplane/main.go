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
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/audiomonitor"
	"github.com/Slicit/stream-composer/go-service/internal/authhook"
	"github.com/Slicit/stream-composer/go-service/internal/bandwidthhistory"
	"github.com/Slicit/stream-composer/go-service/internal/channelstate"
	"github.com/Slicit/stream-composer/go-service/internal/compositionscheduler"
	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/hoststats"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/mediaproxy"
	"github.com/Slicit/stream-composer/go-service/internal/playability"
	"github.com/Slicit/stream-composer/go-service/internal/relayrunner"
	"github.com/Slicit/stream-composer/go-service/internal/sessionauth"
	"github.com/Slicit/stream-composer/go-service/internal/sourceselector"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
	"github.com/Slicit/stream-composer/go-service/internal/viewerstate"
)

// The admin Server/Stats page's GET /internal/{token}/status shape —
// defined here rather than in a package of their own since they exist
// purely to bundle main()'s own locals (relayrunner.Summary,
// audiomonitor.Summary, hoststats.Snapshot) into one response.
type mediaMTXStatus struct {
	Reachable bool   `json:"reachable"`
	LastError string `json:"lastError,omitempty"`
}

type dataplaneStatus struct {
	UptimeSec int64 `json:"uptimeSec"`
}

type statusResponse struct {
	Host      hoststats.Snapshot   `json:"host"`
	MediaMTX  mediaMTXStatus       `json:"mediamtx"`
	Relays    relayrunner.Summary  `json:"relays"`
	Audio     audiomonitor.Summary `json:"audio"`
	Dataplane dataplaneStatus      `json:"dataplane"`
}

// rtspBase mirrors relayrunner's own rtspBase() — duplicated rather than
// exported from that package, since it is a two-line detail of MediaMTX's
// own RTSP credential shape, not shared behavior.
func rtspBase(cfg config.Config) string {
	host, port := cfg.MediaMTX.RTSPHost, cfg.MediaMTX.RTSPPort
	user, pass := cfg.MediaMTX.InternalUser, cfg.MediaMTX.InternalPassword
	creds := ""
	if pass != "" {
		creds = fmt.Sprintf("%s:%s@", url.QueryEscape(user), url.QueryEscape(pass))
	}
	return fmt.Sprintf("rtsp://%s%s:%s", creds, host, port)
}

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	cfg := config.Load()
	startedAt := time.Now()

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

	// Shared, in-process, between the compositor scheduler (which writes
	// it, as part of a warm handoff between ffmpeg processes) and the
	// media proxy + relay runner (which read it) — see
	// compositionscheduler.Generations' own doc comment.
	generations := compositionscheduler.NewGenerations()

	hook := authhook.New(store, cfg, log)
	proxy := mediaproxy.New(store, cfg, log, generations)

	mtxClient := &mediamtx.Client{BaseURL: cfg.MediaMTX.API, IngestPrefix: cfg.IngestPrefix}
	relays := relayrunner.New(store, mtxClient, cfg, log, generations)
	relayStop := make(chan struct{})
	defer close(relayStop)
	go relays.Start(context.Background(), time.Duration(cfg.PollIntervalMs)*time.Millisecond, relayStop)
	defer relays.StopAll()

	audio := audiomonitor.New(mtxClient, cfg, log)
	audioStop := make(chan struct{})
	defer close(audioStop)
	go audio.Start(context.Background(), time.Duration(cfg.PollIntervalMs)*time.Millisecond, audioStop)
	defer audio.StopAll()

	compositions := compositionscheduler.New(store, mtxClient, cfg, log, generations)
	compositionStop := make(chan struct{})
	defer close(compositionStop)
	go compositions.Start(context.Background(), time.Duration(cfg.PollIntervalMs)*time.Millisecond, compositionStop)

	bandwidth := bandwidthhistory.New(mtxClient, cfg.IngestPrefix, filepath.Join(cfg.DataDir, "bandwidth-history.json"), log)
	bandwidthStop := make(chan struct{})
	defer close(bandwidthStop)
	go bandwidth.Start(context.Background(), bandwidthStop)

	hostReader := hoststats.New()

	checker := playability.New(cfg.FFprobePath)
	composition := sourceselector.Composition{
		Include: "auto",
		Layout:  cfg.CompositionLayout,
		Width:   cfg.CompositionWidth,
		Height:  cfg.CompositionHeight,
		GapPx:   cfg.CompositionGapPx,
	}

	// Only set up when Rails is actually the source of truth (see the
	// streamstore bridge selection above) — without it there is nothing
	// to ask who a caller is, and every request stays anonymous exactly
	// as it always has.
	var sessionResolver *sessionauth.Resolver
	if railsURL := os.Getenv("RAILS_INTERNAL_API_URL"); railsURL != "" {
		sessionResolver = &sessionauth.Resolver{BaseURL: railsURL, Token: os.Getenv("RAILS_INTERNAL_API_TOKEN")}
	}
	// guard wraps a handler with session resolution when Rails is
	// available, or passes it through unchanged (anonymous, as before)
	// when it isn't.
	guard := func(h http.HandlerFunc) http.Handler {
		if sessionResolver == nil {
			return h
		}
		return sessionauth.Guard(sessionResolver, log, h)
	}

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

	// Same shared-secret shape — the admin Server/Stats page's one status
	// call, aggregating everything that page needs so it isn't five
	// separate internal round trips from Rails.
	mux.HandleFunc("GET /internal/{token}/status", func(w http.ResponseWriter, r *http.Request) {
		if !hook.VerifyToken(r.PathValue("token")) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		mtxStatus := mediaMTXStatus{Reachable: true}
		if _, err := mtxClient.ListPaths(r.Context()); err != nil {
			mtxStatus.Reachable = false
			mtxStatus.LastError = err.Error()
		}
		resp := statusResponse{
			Host:     hostReader.Snapshot(),
			MediaMTX: mtxStatus,
			Relays:   relays.Summary(),
			Audio:    audio.Summary(),
			Dataplane: dataplaneStatus{
				UptimeSec: int64(time.Since(startedAt).Seconds()),
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})

	// Session-guarded: ResolvePlayback is what actually turns "no user" or
	// "wrong user" into a denial for anything that isn't public — the
	// guard's only job is making sure a real caller identity reaches it,
	// via mediaproxy.UserFromContext, instead of always being nil.
	mux.Handle(mediaproxy.WebRTCMount+"/", guard(func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeWebRTC(w, r, cfg.MediaMTX.WebRTC)
	}))
	mux.Handle(mediaproxy.HLSMount+"/", guard(func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHLS(w, r, cfg.MediaMTX.HLS)
	}))

	// The browser-composition equivalent of server/src/routes/api.js's
	// GET /api/state.
	mux.Handle("GET /api/state", guard(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		live, err := mtxClient.ListIngest(ctx)
		if err == nil {
			for _, l := range live {
				if l.Ready {
					checker.Inspect(l.Key, fmt.Sprintf("%s/%s/%s", rtspBase(cfg), cfg.IngestPrefix, l.Key), l.ReadyTime)
				}
			}
		}

		state, err := viewerstate.Build(ctx, store, mtxClient, checker, audio, composition, cfg.IngestPrefix)
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "could not reach mediamtx"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(state)
	}))

	// The channel-scoped equivalent of GET /api/state — same session
	// guard, since a channel's own visibility/sharedWith is what gates it
	// (see channelstate.Build), and a member stream's own access gates
	// each entry's restricted flag independently of the channel's own.
	mux.Handle("GET /api/channels/{slug}/state", guard(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		live, err := mtxClient.ListIngest(ctx)
		if err == nil {
			for _, l := range live {
				if l.Ready {
					checker.Inspect(l.Key, fmt.Sprintf("%s/%s/%s", rtspBase(cfg), cfg.IngestPrefix, l.Key), l.ReadyTime)
				}
			}
		}

		state, found, err := channelstate.Build(ctx, store, mtxClient, checker, audio, composition, cfg.IngestPrefix, r.PathValue("slug"), mediaproxy.UserFromContext(ctx))
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "could not reach mediamtx"})
			return
		}
		if !found {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(state)
	}))

	// The left nav's bulk "which channels are live" check — one request
	// covering every channel the caller can see, instead of polling each
	// channel's own /state individually just to color a dot.
	mux.Handle("GET /api/channels/live", guard(func(w http.ResponseWriter, r *http.Request) {
		liveMap, err := channelstate.BuildLiveMap(r.Context(), store, mtxClient, mediaproxy.UserFromContext(r.Context()))
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "could not reach mediamtx"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(liveMap)
	}))

	addr := ":" + strings.TrimPrefix(cfg.Port, ":")
	log.Info("data plane listening", "addr", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Error("server stopped", "error", err.Error())
		os.Exit(1)
	}
}
