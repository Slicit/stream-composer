// Package config loads the data plane's settings from the environment. Field
// names and defaults mirror server/src/config.js where the same setting
// exists on both sides, so the two services stay easy to compare during the
// migration; only the fields this service actually uses are ported.
package config

import "os"

type MediaMTX struct {
	API              string // control API, e.g. http://mediamtx:9997
	WebRTC           string // WHEP base, e.g. http://mediamtx:8889
	HLS              string // HLS base, e.g. http://mediamtx:8888
	RTSPHost         string // e.g. "mediamtx", the host ffmpeg reads/writes RTSP against
	RTSPPort         string // e.g. "8554"
	InternalUser     string
	InternalPassword string // shared secret for both the auth hook path and internal reads
}

type Config struct {
	Port     string
	MediaMTX MediaMTX

	IngestPrefix   string // e.g. "live" -> live/<key>
	ProgramPath    string // e.g. "program"
	AudioPrefix    string // e.g. "audio" -> audio/<key>
	ComposedPrefix string // e.g. "composed" -> composed/<channelId>/<orientation>, see internal/compositionscheduler

	// CompositorAPI is the compositor service's base URL, e.g.
	// http://compositor:8080 — internal/compositionscheduler's only way of
	// telling it to start/stop a job (see internal/compositor's package
	// comment on why that's a separate service, not a Go import).
	CompositorAPI string

	// MaxCompositorJobs caps how many composition jobs the compositor
	// service will run at once — the safety valve against a single box
	// being asked to composite more than it realistically can (each job is
	// real, ongoing CPU cost, unlike browser composition). 0 means no cap;
	// read only by the compositor service itself (internal/compositor),
	// but part of the shared Config since every service loads the same env.
	MaxCompositorJobs int

	// Warm-handoff timing (internal/compositionscheduler) — a source
	// joining/leaving always means restarting ffmpeg (it cannot add or
	// remove a filtergraph input live), so a composition's config changes
	// are debounced before acting on them at all, then applied via a new
	// generation started *before* the old one stops, so an already-
	// connected viewer keeps watching the old generation, uninterrupted,
	// until it's drained. See that package's own doc comment for why.
	//
	// CompositionDrainMs defaults short (5s), not long: its only job is to
	// avoid an abrupt cut for whoever is mid-request right when the swap
	// happens, not to give a viewer's player a long window to notice and
	// reconnect on its own — confirmed live that most players (VLC
	// included) never do that on their own, so a long drain just means a
	// long-lived viewer stares at an increasingly stale (and, for a
	// membership change specifically, visibly gapped) picture with no
	// indication anything is wrong, mistaking "still draining" for
	// "broken" — see feat-compositor.md.
	CompositionStabilizeMs    int // wait this long after the last change before starting a new generation
	CompositionMaxStabilizeMs int // ...but never more than this from the first change in a burst
	CompositionDrainMs        int // how long an old generation keeps running after the new one goes live

	FFmpegPath  string // "ffmpeg" unless overridden
	FFprobePath string // "ffprobe" unless overridden
	VAAPIDevice string // the render node a vaapi/qsv encode uploads into, e.g. /dev/dri/renderD128

	// Restream backoff. Not yet a Rails-side setting (see AppSetting's own
	// comment on staying deliberately small) — these are the same numeric
	// defaults server/src/relays.js falls back to when settings.
	// restartDelayMs/maxRestartDelayMs are unset.
	RestartDelayMs    int
	MaxRestartDelayMs int
	PollIntervalMs    int

	DataDir string // where persistent state (e.g. bandwidth history) is written

	// Browser composition defaults (server/src/store.js's DEFAULT_COMPOSITION,
	// the subset sourceselector needs). Not yet a Rails-side setting — see
	// the LOGBOOK's open-questions note on where per-operator layout
	// settings should eventually live.
	CompositionLayout string
	CompositionWidth  int
	CompositionHeight int
	CompositionGapPx  int
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n := 0
	for _, c := range v {
		if c < '0' || c > '9' {
			return def
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// Load reads Config from the environment, applying the same defaults as
// server/src/config.js.
func Load() Config {
	return Config{
		Port: env("PORT", "8080"),
		MediaMTX: MediaMTX{
			API:              env("MEDIAMTX_API", "http://mediamtx:9997"),
			WebRTC:           env("MEDIAMTX_WEBRTC", "http://mediamtx:8889"),
			HLS:              env("MEDIAMTX_HLS", "http://mediamtx:8888"),
			RTSPHost:         env("MEDIAMTX_RTSP_HOST", "mediamtx"),
			RTSPPort:         env("MEDIAMTX_RTSP_PORT", "8554"),
			InternalUser:     env("MEDIAMTX_INTERNAL_USER", "composer"),
			InternalPassword: env("MEDIAMTX_INTERNAL_PASSWORD", ""),
		},
		IngestPrefix:              env("INGEST_PREFIX", "live"),
		ProgramPath:               env("PROGRAM_PATH", "program"),
		AudioPrefix:               env("AUDIO_PREFIX", "audio"),
		ComposedPrefix:            env("COMPOSED_PREFIX", "composed"),
		CompositorAPI:             env("COMPOSITOR_API", "http://compositor:8080"),
		MaxCompositorJobs:         envInt("MAX_COMPOSITOR_JOBS", 4),
		CompositionStabilizeMs:    envInt("COMPOSITION_STABILIZE_MS", 5000),
		CompositionMaxStabilizeMs: envInt("COMPOSITION_MAX_STABILIZE_MS", 20000),
		CompositionDrainMs:        envInt("COMPOSITION_DRAIN_MS", 5000),
		FFmpegPath:                env("FFMPEG_PATH", "ffmpeg"),
		FFprobePath:               env("FFPROBE_PATH", "ffprobe"),
		VAAPIDevice:               env("VAAPI_DEVICE", "/dev/dri/renderD128"),
		RestartDelayMs:            envInt("RESTART_DELAY_MS", 2000),
		MaxRestartDelayMs:         envInt("MAX_RESTART_DELAY_MS", 15000),
		PollIntervalMs:            envInt("POLL_INTERVAL_MS", 2000),
		DataDir:                   env("DATA_DIR", "/data"),
		CompositionLayout:         env("COMPOSITION_LAYOUT", "auto"),
		CompositionWidth:          envInt("COMPOSITION_WIDTH", 1920),
		CompositionHeight:         envInt("COMPOSITION_HEIGHT", 1080),
		CompositionGapPx:          envInt("COMPOSITION_GAP_PX", 4),
	}
}
