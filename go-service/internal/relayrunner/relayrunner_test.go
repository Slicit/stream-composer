package relayrunner

import (
	"log/slog"
	"os"
	"strings"
	"testing"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

func testRunner(cfg config.Config) *Runner {
	return New(streamstore.NewMemory(), nil, cfg, slog.New(slog.NewTextHandler(os.Stdout, nil)), nil)
}

func TestDestinationURL(t *testing.T) {
	cases := []struct {
		name, url, key, want string
	}{
		{"appends the key as the final path segment", "rtmp://live.twitch.tv/app", "my-key", "rtmp://live.twitch.tv/app/my-key"},
		{
			"keeps the query string after the key, not before it",
			"rtmp://b.rtmp.youtube.com/live2?backup=1", "my-key",
			"rtmp://b.rtmp.youtube.com/live2/my-key?backup=1",
		},
		{"returns the bare URL when there is no key", "rtmp://example.test/live/already-keyed", "", "rtmp://example.test/live/already-keyed"},
		{"trims a trailing slash before appending", "rtmp://example.test/live/", "k", "rtmp://example.test/live/k"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := destinationURL(c.url, c.key)
			if got != c.want {
				t.Errorf("destinationURL(%q, %q) = %q, want %q", c.url, c.key, got, c.want)
			}
		})
	}
}

func TestRTSPBase(t *testing.T) {
	r := testRunner(config.Config{MediaMTX: config.MediaMTX{RTSPHost: "mediamtx", RTSPPort: "8554", InternalUser: "composer", InternalPassword: "secret"}})
	got := r.rtspBase()
	want := "rtsp://composer:secret@mediamtx:8554"
	if got != want {
		t.Errorf("rtspBase() = %q, want %q", got, want)
	}
}

func TestRTSPBaseWithNoCredential(t *testing.T) {
	r := testRunner(config.Config{MediaMTX: config.MediaMTX{RTSPHost: "mediamtx", RTSPPort: "8554"}})
	got := r.rtspBase()
	if got != "rtsp://mediamtx:8554" {
		t.Errorf("rtspBase() = %q, want no credential prefix", got)
	}
}

func TestBuildArgsVideoAlwaysCopiedAudioModeSwitches(t *testing.T) {
	r := testRunner(config.Config{MediaMTX: config.MediaMTX{RTSPHost: "mediamtx", RTSPPort: "8554"}})

	copyRelay := streamstore.Relay{URL: "rtmp://example.test/live", Key: "k", Audio: "copy"}
	args := r.buildArgs(copyRelay, "live/source-key")
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-c:v copy") {
		t.Error("video must always be -c:v copy")
	}
	if !strings.Contains(joined, "-c:a copy") {
		t.Errorf("audio should be copied when relay.Audio is 'copy', got: %s", joined)
	}
	if !strings.Contains(joined, "rtsp://mediamtx:8554/live/source-key") {
		t.Errorf("input should be the RTSP source path, got: %s", joined)
	}
	if !strings.HasSuffix(joined, "rtmp://example.test/live/k") {
		t.Errorf("destination URL should be the last argument, got: %s", joined)
	}

	aacRelay := streamstore.Relay{URL: "rtmp://example.test/live", Key: "k", Audio: "aac"}
	args = r.buildArgs(aacRelay, "live/source-key")
	joined = strings.Join(args, " ")
	if !strings.Contains(joined, "-c:a aac") {
		t.Errorf("audio should be transcoded to aac when relay.Audio is 'aac', got: %s", joined)
	}
}

func TestPreviewCommandRedactsTheKey(t *testing.T) {
	r := testRunner(config.Config{MediaMTX: config.MediaMTX{RTSPHost: "mediamtx", RTSPPort: "8554"}})
	relay := streamstore.Relay{URL: "rtmp://example.test/live", Key: "super-secret-key", Audio: "copy"}
	cmd := r.PreviewCommand(relay, "live/source-key")
	if strings.Contains(cmd, "super-secret-key") {
		t.Errorf("PreviewCommand must never contain the real key: %s", cmd)
	}
	if !strings.Contains(cmd, "STREAM-KEY") {
		t.Errorf("PreviewCommand should show a redaction placeholder: %s", cmd)
	}
}
