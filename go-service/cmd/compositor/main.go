// Command compositor is the dedicated ffmpeg-composition runner: given a
// job id and a list of on-air sources, it composites them into one encoded
// video and publishes the result back into MediaMTX as its own path,
// supervising the ffmpeg process (restart with backoff on a crash) until
// told to stop. It has no opinion on which channels should be compositing
// right now — that decision belongs to the Go data plane (cmd/dataplane),
// which polls Rails and calls this service's HTTP API accordingly. See
// internal/compositor's package comment for why this stays a separate,
// "dumb" service rather than living inside the data plane itself.
//
// This is phase 2 of the compositor plan: the service and its job API
// exist and are directly testable (see README), but nothing calls it yet
// — the data plane's orchestration is a later phase.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/compositor"
	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/encoder"
)

type sourceJSON struct {
	Path  string `json:"path"`
	Label string `json:"label"`
}

type optionsJSON struct {
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	FPS         int    `json:"fps"`
	BitrateKbps int    `json:"bitrateKbps"`
	Preset      string `json:"preset"`
	Encoder     string `json:"encoder"`
	Background  string `json:"background"`
	Labels      bool   `json:"labels"`
	LabelSize   int    `json:"labelSize"`
	OutputPath  string `json:"outputPath"`
}

type startJobRequest struct {
	ID      string       `json:"id"`
	Sources []sourceJSON `json:"sources"`
	Options optionsJSON  `json:"options"`
}

type statusResponse struct {
	State     string `json:"state"`
	Since     string `json:"since,omitempty"`
	Restarts  int    `json:"restarts"`
	LastError string `json:"lastError,omitempty"`
	RetryAt   string `json:"retryAt,omitempty"`
	Command   string `json:"command,omitempty"`
}

func toStatusResponse(s compositor.Status) statusResponse {
	out := statusResponse{State: s.State, Restarts: s.Restarts, LastError: s.LastErr, Command: s.Command}
	if !s.Since.IsZero() {
		out.Since = s.Since.UTC().Format(time.RFC3339)
	}
	if !s.RetryAt.IsZero() {
		out.RetryAt = s.RetryAt.UTC().Format(time.RFC3339)
	}
	return out
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	cfg := config.Load()

	log.Info("probing encoder capabilities")
	caps := encoder.Probe(context.Background(), cfg.FFmpegPath, cfg.VAAPIDevice)
	log.Info("encoder capabilities detected",
		"ffmpeg", caps.FFmpegVersion, "drawtext", caps.Drawtext,
		"software", caps.Usable("software"), "vaapi", caps.Usable("vaapi"), "qsv", caps.Usable("qsv"))

	runner := compositor.New(cfg, caps, log)

	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	mux.HandleFunc("GET /caps", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ffmpegVersion": caps.FFmpegVersion,
			"drawtext":      caps.Drawtext,
			"software":      caps.Usable("software"),
			"vaapi":         caps.Usable("vaapi"),
			"qsv":           caps.Usable("qsv"),
		})
	})

	mux.HandleFunc("GET /jobs", func(w http.ResponseWriter, r *http.Request) {
		out := map[string]statusResponse{}
		for id, s := range runner.List() {
			out[id] = toStatusResponse(s)
		}
		writeJSON(w, http.StatusOK, map[string]any{"jobs": out})
	})

	// {id...} (not {id}): job ids are "<channelId>/<orientation>", so the
	// id itself contains a slash — a plain {id} pattern only ever matches
	// one path segment.
	mux.HandleFunc("GET /jobs/{id...}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, toStatusResponse(runner.StatusOf(r.PathValue("id"))))
	})

	mux.HandleFunc("POST /jobs", func(w http.ResponseWriter, r *http.Request) {
		var req startJobRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.ID == "" {
			writeError(w, http.StatusBadRequest, "id is required")
			return
		}
		if req.Options.OutputPath == "" {
			writeError(w, http.StatusBadRequest, "options.outputPath is required")
			return
		}
		if len(req.Sources) == 0 {
			writeError(w, http.StatusBadRequest, "at least one source is required")
			return
		}

		sources := make([]compositor.Source, len(req.Sources))
		for i, s := range req.Sources {
			sources[i] = compositor.Source{Path: s.Path, Label: s.Label}
		}
		opts := compositor.Options{
			Width: req.Options.Width, Height: req.Options.Height, FPS: req.Options.FPS,
			BitrateKbps: req.Options.BitrateKbps, Preset: req.Options.Preset, Encoder: req.Options.Encoder,
			Background: req.Options.Background, Labels: req.Options.Labels, LabelSize: req.Options.LabelSize,
			OutputPath: req.Options.OutputPath,
		}

		log.Info("starting compositor job via API", "id", req.ID, "sources", len(sources))
		runner.StartJob(req.ID, sources, opts)
		writeJSON(w, http.StatusAccepted, toStatusResponse(runner.StatusOf(req.ID)))
	})

	mux.HandleFunc("DELETE /jobs/{id...}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		log.Info("stopping compositor job via API", "id", id)
		runner.StopJob(id)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	addr := ":" + cfg.Port
	log.Info("compositor service listening", "addr", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Error("server exited", "error", err.Error())
		os.Exit(1)
	}
}
