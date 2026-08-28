package encoder

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveAutoPrefersHardwareThenFallsBackToSoftware(t *testing.T) {
	caps := Caps{
		Encoders:    map[string]bool{"libx264": true, "h264_vaapi": true},
		VAAPIDevice: true,
		Functional:  map[string]FunctionalResult{"vaapi": {OK: true}},
	}
	if got := Resolve("auto", caps); got != "vaapi" {
		t.Errorf("Resolve(auto) = %q, want vaapi when it's usable", got)
	}

	swOnly := Caps{Encoders: map[string]bool{"libx264": true}}
	if got := Resolve("auto", swOnly); got != "software" {
		t.Errorf("Resolve(auto) = %q, want software with no hardware present", got)
	}
}

func TestResolveExplicitRequestFallsBackWhenUnusable(t *testing.T) {
	caps := Caps{Encoders: map[string]bool{"libx264": true}} // no vaapi
	if got := Resolve("vaapi", caps); got != "software" {
		t.Errorf("Resolve(vaapi) = %q, want software fallback when vaapi is unusable", got)
	}
}

func TestResolveExplicitRequestHonoredWhenUsable(t *testing.T) {
	caps := Caps{
		Encoders:    map[string]bool{"libx264": true, "h264_qsv": true},
		VAAPIDevice: true,
		Functional:  map[string]FunctionalResult{"qsv": {OK: true}},
	}
	if got := Resolve("qsv", caps); got != "qsv" {
		t.Errorf("Resolve(qsv) = %q, want qsv honored", got)
	}
}

func TestUsableRequiresAFunctionalTestNotJustPresence(t *testing.T) {
	// The encoder is built into ffmpeg and the device file exists, but the
	// functional test either never ran or failed — this is exactly the
	// "listed but broken" case the package comment describes.
	caps := Caps{
		Encoders:    map[string]bool{"h264_vaapi": true},
		VAAPIDevice: true,
		Functional:  map[string]FunctionalResult{"vaapi": {OK: false, Error: "driver mismatch"}},
	}
	if caps.Usable("vaapi") {
		t.Error("vaapi should not be usable when its functional test failed")
	}

	untested := Caps{Encoders: map[string]bool{"h264_vaapi": true}, VAAPIDevice: true}
	if untested.Usable("vaapi") {
		t.Error("vaapi should not be usable when it was never functionally tested")
	}
}

func TestOutputArgsSoftwareUsesLibx264WithTheGivenPreset(t *testing.T) {
	args := OutputArgs("software", EncodeOptions{FPS: 30, BitrateKbps: 4500, Preset: "veryfast"})
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-c:v libx264") {
		t.Errorf("expected libx264, got: %s", joined)
	}
	if !strings.Contains(joined, "-preset veryfast") {
		t.Errorf("expected the given preset, got: %s", joined)
	}
	if !strings.Contains(joined, "-b:v 4500k") {
		t.Errorf("expected the given bitrate, got: %s", joined)
	}
}

func TestOutputArgsVAAPIUsesCBRRateControl(t *testing.T) {
	args := OutputArgs("vaapi", EncodeOptions{FPS: 30, BitrateKbps: 4500})
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-c:v h264_vaapi") || !strings.Contains(joined, "-rc_mode CBR") {
		t.Errorf("expected h264_vaapi with CBR rate control, got: %s", joined)
	}
}

func TestOutputArgsQSVNeverUploadsToAVAAPIFramesContext(t *testing.T) {
	// h264_qsv takes software NV12 directly; a -vaapi_device-derived
	// frames context is the wrong kind of frame for it and fails to
	// configure the graph — see the package's own comment on this.
	args := OutputArgs("qsv", EncodeOptions{FPS: 30, BitrateKbps: 4500})
	joined := strings.Join(args, " ")
	if strings.Contains(joined, "hwupload") {
		t.Errorf("qsv output args must never mention hwupload, got: %s", joined)
	}
	if !strings.Contains(joined, "-c:v h264_qsv") {
		t.Errorf("expected h264_qsv, got: %s", joined)
	}
}

// fakeFFmpeg writes an executable shell script standing in for ffmpeg, so
// Probe's regex-based parsing of -version/-encoders/-filters output can be
// exercised without a real ffmpeg binary.
func fakeFFmpeg(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-ffmpeg.sh")
	script := `#!/bin/sh
case "$*" in
  *-version*) echo "ffmpeg version 6.0 fake-build" ;;
  *-encoders*) printf ' V..... libx264              libx264\n V..... h264_vaapi           H.264 (VAAPI)\n' ;;
  *-filters*) printf ' ... drawtext         V->V       Draw text\n' ;;
  *) exit 0 ;;
esac
`
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestProbeParsesEncodersAndFilters(t *testing.T) {
	caps := Probe(context.Background(), fakeFFmpeg(t), "/no/such/device")
	if !caps.Probed {
		t.Fatal("expected Probed to be true")
	}
	if !caps.Encoders["libx264"] || !caps.Encoders["h264_vaapi"] {
		t.Errorf("expected both encoders parsed, got: %+v", caps.Encoders)
	}
	if !caps.Drawtext {
		t.Error("expected drawtext filter detected")
	}
	if caps.VAAPIDevice {
		t.Error("a nonexistent device path should not be reported as present")
	}
	// vaapi is listed as an encoder, but the device doesn't exist, so no
	// functional test should have run for it at all.
	if _, tested := caps.Functional["vaapi"]; tested {
		t.Error("should not attempt a functional test with no device present")
	}
}
