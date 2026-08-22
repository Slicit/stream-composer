package audiomonitor

import (
	"log/slog"
	"os"
	"strings"
	"testing"

	"github.com/Slicit/stream-composer/go-service/internal/config"
)

func testMonitor(cfg config.Config) *Monitor {
	return New(nil, cfg, slog.New(slog.NewTextHandler(os.Stdout, nil)))
}

func TestRTSPBase(t *testing.T) {
	m := testMonitor(config.Config{MediaMTX: config.MediaMTX{RTSPHost: "mediamtx", RTSPPort: "8554", InternalUser: "composer", InternalPassword: "secret"}})
	got := m.rtspBase()
	want := "rtsp://composer:secret@mediamtx:8554"
	if got != want {
		t.Errorf("rtspBase() = %q, want %q", got, want)
	}
}

func TestBuildArgsTranscodesAudioOnlyToOpus(t *testing.T) {
	m := testMonitor(config.Config{
		MediaMTX:     config.MediaMTX{RTSPHost: "mediamtx", RTSPPort: "8554"},
		IngestPrefix: "live",
		AudioPrefix:  "audio",
	})
	args := m.buildArgs("some-key")
	joined := strings.Join(args, " ")

	if !strings.Contains(joined, "-i rtsp://mediamtx:8554/live/some-key") {
		t.Errorf("input should be the RTSP ingest path, got: %s", joined)
	}
	if !strings.Contains(joined, "-vn") {
		t.Error("audio transcode must drop video (-vn)")
	}
	if !strings.Contains(joined, "-c:a libopus") {
		t.Errorf("audio must be transcoded to Opus, got: %s", joined)
	}
	if !strings.HasSuffix(joined, "rtsp://mediamtx:8554/audio/some-key") {
		t.Errorf("output should republish under the audio prefix, got: %s", joined)
	}
}
