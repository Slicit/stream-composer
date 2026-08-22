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
	InternalUser     string
	InternalPassword string // shared secret for both the auth hook path and internal reads
}

type Config struct {
	Port     string
	MediaMTX MediaMTX

	IngestPrefix string // e.g. "live" -> live/<key>
	ProgramPath  string // e.g. "program"
	AudioPrefix  string // e.g. "audio" -> audio/<key>
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
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
			InternalUser:     env("MEDIAMTX_INTERNAL_USER", "composer"),
			InternalPassword: env("MEDIAMTX_INTERNAL_PASSWORD", ""),
		},
		IngestPrefix: env("INGEST_PREFIX", "live"),
		ProgramPath:  env("PROGRAM_PATH", "program"),
		AudioPrefix:  env("AUDIO_PREFIX", "audio"),
	}
}
