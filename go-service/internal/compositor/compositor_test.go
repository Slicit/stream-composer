package compositor

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/config"
	"github.com/Slicit/stream-composer/go-service/internal/encoder"
)

func testConfig() config.Config {
	return config.Config{
		MediaMTX:          config.MediaMTX{RTSPHost: "mediamtx", RTSPPort: "8554"},
		RestartDelayMs:    50,
		MaxRestartDelayMs: 200,
	}
}

func silentLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError + 1}))
}

func TestBuildArgsReadsEachSourceOverRTSPAndPublishesTheComposedOutput(t *testing.T) {
	sources := []Source{{Path: "live/cam-1"}, {Path: "live/cam-2"}}
	opts := Options{Width: 1920, Height: 1080, FPS: 30, BitrateKbps: 4500, OutputPath: "composed/chan-1/horizontal"}
	args, result := BuildArgs(sources, opts, testConfig(), encoder.Caps{Encoders: map[string]bool{"libx264": true}})
	joined := strings.Join(args, " ")

	if !strings.Contains(joined, "rtsp://mediamtx:8554/live/cam-1") {
		t.Errorf("expected first source read over RTSP, got: %s", joined)
	}
	if !strings.Contains(joined, "rtsp://mediamtx:8554/live/cam-2") {
		t.Errorf("expected second source read over RTSP, got: %s", joined)
	}
	if !strings.HasSuffix(joined, "rtsp://mediamtx:8554/composed/chan-1/horizontal") {
		t.Errorf("expected the composed output published as its own RTSP path, got: %s", joined)
	}
	if !strings.Contains(joined, "-map [outv] -an") {
		t.Errorf("output must be video-only (no audio track), got: %s", joined)
	}
	if len(result.Cells) != 2 {
		t.Errorf("expected 2 cells for 2 sources, got %d", len(result.Cells))
	}
}

func TestBuildArgsUsesTheCanvasAwareGridForAVerticalComposition(t *testing.T) {
	sources := []Source{{Path: "live/cam-1"}, {Path: "live/cam-2"}}
	opts := Options{Width: 700, Height: 1400, OutputPath: "composed/chan-1/vertical", Orientation: "vertical"}
	_, result := BuildArgs(sources, opts, testConfig(), encoder.Caps{Encoders: map[string]bool{"libx264": true}})

	if len(result.Cells) != 2 {
		t.Fatalf("expected 2 cells, got %d", len(result.Cells))
	}
	// A narrow, tall canvas should stack rather than go 2-across — see
	// internal/layout.ComputeForCanvas's own tests for the general case;
	// this just confirms BuildArgs actually routes there for "vertical".
	if result.Cells[0].X != result.Cells[1].X || !(result.Cells[0].Y < result.Cells[1].Y) {
		t.Errorf("expected a vertical composition's 2 sources stacked, got: %+v", result.Cells)
	}
}

func TestBuildArgsUsesTheFixedGridWhenOrientationIsNotVertical(t *testing.T) {
	sources := []Source{{Path: "live/cam-1"}, {Path: "live/cam-2"}}
	// Same narrow/tall canvas as the vertical case above, but Orientation
	// unset — Compute's landscape-only "auto" guess should still apply
	// (side by side, not stacked), confirming the branch actually depends
	// on Orientation and not just canvas shape.
	opts := Options{Width: 700, Height: 1400, OutputPath: "composed/chan-1/horizontal"}
	_, result := BuildArgs(sources, opts, testConfig(), encoder.Caps{Encoders: map[string]bool{"libx264": true}})

	if len(result.Cells) != 2 {
		t.Fatalf("expected 2 cells, got %d", len(result.Cells))
	}
	if result.Cells[0].Y != result.Cells[1].Y {
		t.Errorf("expected Compute's own side-by-side auto layout, got: %+v", result.Cells)
	}
}

func TestBuildArgsOmitsCaptionsWhenLabelsAreOff(t *testing.T) {
	sources := []Source{{Path: "live/cam-1", Label: "Front Row"}}
	opts := Options{Width: 1920, Height: 1080, OutputPath: "composed/c/horizontal", Labels: false}
	args, _ := BuildArgs(sources, opts, testConfig(), encoder.Caps{Encoders: map[string]bool{"libx264": true}, Drawtext: true})
	if strings.Contains(strings.Join(args, " "), "drawtext") {
		t.Error("drawtext should not appear when Labels is false")
	}
}

func TestBuildArgsIncludesCaptionsWhenLabelsAreOnAndDrawtextIsAvailable(t *testing.T) {
	sources := []Source{{Path: "live/cam-1", Label: "Front Row"}}
	opts := Options{Width: 1920, Height: 1080, OutputPath: "composed/c/horizontal", Labels: true, LabelSize: 22}
	args, _ := BuildArgs(sources, opts, testConfig(), encoder.Caps{Encoders: map[string]bool{"libx264": true}, Drawtext: true})
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "drawtext") || !strings.Contains(joined, "Front Row") {
		t.Errorf("expected a drawtext caption for the source's label, got: %s", joined)
	}
}

func TestBuildArgsOmitsCaptionsWhenDrawtextIsUnavailableEvenIfLabelsAreOn(t *testing.T) {
	sources := []Source{{Path: "live/cam-1", Label: "Front Row"}}
	opts := Options{Width: 1920, Height: 1080, OutputPath: "composed/c/horizontal", Labels: true}
	args, _ := BuildArgs(sources, opts, testConfig(), encoder.Caps{Encoders: map[string]bool{"libx264": true}, Drawtext: false})
	if strings.Contains(strings.Join(args, " "), "drawtext") {
		t.Error("drawtext should not appear when the ffmpeg build lacks the filter, regardless of Labels")
	}
}

func TestBuildArgsUsesTheGivenBackgroundColor(t *testing.T) {
	sources := []Source{{Path: "live/cam-1"}}
	opts := Options{Width: 1920, Height: 1080, OutputPath: "composed/c/horizontal", Background: "#112233"}
	args, _ := BuildArgs(sources, opts, testConfig(), encoder.Caps{Encoders: map[string]bool{"libx264": true}})
	if !strings.Contains(strings.Join(args, " "), "color=c=0x112233") {
		t.Errorf("expected the given hex background translated for ffmpeg's color filter, got: %s", strings.Join(args, " "))
	}
}

func TestBuildArgsFallsBackToDefaultBackgroundForAnInvalidColor(t *testing.T) {
	sources := []Source{{Path: "live/cam-1"}}
	opts := Options{Width: 1920, Height: 1080, OutputPath: "composed/c/horizontal", Background: "not-a-color"}
	args, _ := BuildArgs(sources, opts, testConfig(), encoder.Caps{Encoders: map[string]bool{"libx264": true}})
	if !strings.Contains(strings.Join(args, " "), "color=c=0x0b1220") {
		t.Errorf("expected the default background for an invalid value, got: %s", strings.Join(args, " "))
	}
}

func TestBuildArgsPutsVAAPIDeviceBeforeInputsOnlyWhenVAAPIResolves(t *testing.T) {
	sources := []Source{{Path: "live/cam-1"}}
	opts := Options{Width: 1920, Height: 1080, OutputPath: "composed/c/horizontal", Encoder: "vaapi"}
	caps := encoder.Caps{
		Encoders:    map[string]bool{"h264_vaapi": true},
		VAAPIDevice: true,
		Functional:  map[string]encoder.FunctionalResult{"vaapi": {OK: true}},
	}
	cfg := testConfig()
	cfg.VAAPIDevice = "/dev/dri/renderD128"
	args, _ := BuildArgs(sources, opts, cfg, caps)
	if args[4] != "-vaapi_device" || args[5] != "/dev/dri/renderD128" {
		t.Errorf("expected -vaapi_device right after the global flags, got: %v", args[:6])
	}
}

// fakeFFmpeg writes an executable shell script that ignores every argument
// BuildArgs would give it (all ffmpeg-specific flags a shell would reject)
// and runs `body` instead, so process-lifecycle behavior (start, stop,
// crash, backoff) can be exercised without a real ffmpeg binary or real
// media — same technique as internal/relayrunner's tick_test.go.
func fakeFFmpeg(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-ffmpeg.sh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body+"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func waitFor(t *testing.T, timeout time.Duration, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition never became true")
}

func TestRunnerStartJobThenStopJob(t *testing.T) {
	cfg := testConfig()
	cfg.FFmpegPath = fakeFFmpeg(t, "trap '' TERM; sleep 5")
	r := New(cfg, encoder.Caps{Encoders: map[string]bool{"libx264": true}}, silentLog())

	r.StartJob("chan-1/horizontal", []Source{{Path: "live/cam-1"}}, Options{Width: 1920, Height: 1080, OutputPath: "composed/chan-1/horizontal"})
	waitFor(t, time.Second, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		_, running := r.running["chan-1/horizontal"]
		return running
	})

	r.StopJob("chan-1/horizontal")
	waitFor(t, time.Second, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		_, running := r.running["chan-1/horizontal"]
		return !running
	})
	if got := r.StatusOf("chan-1/horizontal").State; got != "off" {
		t.Errorf("expected off after StopJob, got %q", got)
	}
}

func TestRunnerRetriesWithBackoffWhenFfmpegExitsUnexpectedly(t *testing.T) {
	cfg := testConfig()
	cfg.FFmpegPath = fakeFFmpeg(t, "exit 1")
	r := New(cfg, encoder.Caps{Encoders: map[string]bool{"libx264": true}}, silentLog())

	r.StartJob("chan-1/horizontal", []Source{{Path: "live/cam-1"}}, Options{Width: 1920, Height: 1080, OutputPath: "composed/chan-1/horizontal"})

	waitFor(t, time.Second, func() bool {
		return r.StatusOf("chan-1/horizontal").State == "retrying"
	})
	if restarts := r.StatusOf("chan-1/horizontal").Restarts; restarts < 1 {
		t.Errorf("expected at least one restart recorded, got %d", restarts)
	}
}

func TestRunnerStartJobRestartsAnAlreadyRunningJob(t *testing.T) {
	cfg := testConfig()
	cfg.FFmpegPath = fakeFFmpeg(t, "trap '' TERM; sleep 5")
	r := New(cfg, encoder.Caps{Encoders: map[string]bool{"libx264": true}}, silentLog())

	r.StartJob("chan-1/horizontal", []Source{{Path: "live/cam-1"}}, Options{Width: 1920, Height: 1080, OutputPath: "composed/chan-1/horizontal"})
	waitFor(t, time.Second, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		_, running := r.running["chan-1/horizontal"]
		return running
	})
	first := r.running["chan-1/horizontal"].cmd

	r.StartJob("chan-1/horizontal", []Source{{Path: "live/cam-1"}, {Path: "live/cam-2"}}, Options{Width: 1920, Height: 1080, OutputPath: "composed/chan-1/horizontal"})
	waitFor(t, time.Second, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		current, running := r.running["chan-1/horizontal"]
		return running && current.cmd != first
	})

	r.StopAll()
}
