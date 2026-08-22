// Package encoder detects which video encoders ffmpeg can actually use on
// this machine and builds the output-stage ffmpeg arguments for whichever
// one is resolved. Ported field-for-field from server/src/encoder.js.
//
// The product targets CPU-only boxes, so libx264 is the default and the
// reference for the sizing tables. Hardware encoders are used only when
// they are actually present *and* the operator asked for them (or asked
// for "auto", in which case hardware is preferred because it frees the CPU
// for scaling).
package encoder

import (
	"context"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

// Composition carries just the fields outputArgs and resolve need from the
// composition settings — the caller (internal/compositor, once it exists)
// owns the full settings shape.
type Composition struct {
	FPS         int
	GopSeconds  float64
	BitrateKbps int
	MaxrateKbps int
	BufsizeKbps int
	Preset      string
	Threads     int
}

type FunctionalResult struct {
	OK    bool
	Error string
}

// Caps is the detected/probed state of this machine's ffmpeg, mirroring
// the Node module's `caps` object.
type Caps struct {
	Probed        bool
	FFmpegVersion string
	Encoders      map[string]bool
	Filters       map[string]bool
	Drawtext      bool
	FontFile      string
	VAAPIDevice   bool
	Nvidia        bool
	Cores         int
	Functional    map[string]FunctionalResult // id -> result, filled by a real test encode

	// FFmpegPath and VAAPIDevicePath are configuration, not detected state,
	// but Probe needs them and every method below reads them from here so
	// Caps is self-contained once probed.
	FFmpegPath      string
	VAAPIDevicePath string
	EncoderOverride string
}

func New(ffmpegPath, vaapiDevicePath, encoderOverride string) *Caps {
	return &Caps{
		Encoders:        map[string]bool{},
		Filters:         map[string]bool{},
		Functional:      map[string]FunctionalResult{},
		Cores:           runtime.NumCPU(),
		FFmpegPath:      ffmpegPath,
		VAAPIDevicePath: vaapiDevicePath,
		EncoderOverride: encoderOverride,
	}
}

var encoderLine = regexp.MustCompile(`^\s*[A-Z.]{6}\s+(\S+)`)
var filterLine = regexp.MustCompile(`^\s*[TSC.]{3}\s+(\S+)`)

var fontCandidates = []string{
	os.Getenv("LABEL_FONT_FILE"),
	"/usr/share/fonts/dejavu/DejaVuSans.ttf",
	"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
	"/usr/share/fonts/TTF/DejaVuSans.ttf",
	"/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
	"/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
	"/usr/share/fonts/noto/NotoSans-Regular.ttf",
}

func run(ctx context.Context, bin string, args ...string) (stdout, stderr string, err error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	var out, errBuf strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	err = cmd.Run()
	return out.String(), errBuf.String(), err
}

// Probe detects ffmpeg's version, its built-in encoders/filters, whether a
// label font is available, whether VAAPI/NVIDIA devices are present, and
// then actually test-encodes on every hardware encoder that could
// plausibly work. Safe to call once at boot.
func (c *Caps) Probe(ctx context.Context) {
	stdout, _, err := run(ctx, c.FFmpegPath, "-hide_banner", "-version")
	if err != nil {
		c.Probed = true
		return
	}
	if lines := strings.SplitN(stdout, "\n", 2); len(lines) > 0 {
		c.FFmpegVersion = strings.TrimSpace(lines[0])
	}

	encOut, _, _ := run(ctx, c.FFmpegPath, "-hide_banner", "-encoders")
	for _, line := range strings.Split(encOut, "\n") {
		if m := encoderLine.FindStringSubmatch(line); m != nil {
			c.Encoders[m[1]] = true
		}
	}

	filtOut, _, _ := run(ctx, c.FFmpegPath, "-hide_banner", "-filters")
	for _, line := range strings.Split(filtOut, "\n") {
		if m := filterLine.FindStringSubmatch(line); m != nil {
			c.Filters[m[1]] = true
		}
	}
	c.Drawtext = c.Filters["drawtext"]

	for _, p := range fontCandidates {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			c.FontFile = p
			break
		}
	}

	if _, err := os.Stat(c.VAAPIDevicePath); err == nil {
		c.VAAPIDevice = true
	}
	if _, err := os.Stat("/dev/nvidia0"); err == nil {
		c.Nvidia = true
	} else if _, err := os.Stat("/dev/nvidiactl"); err == nil {
		c.Nvidia = true
	}

	tests := []struct {
		kind    string
		present bool
	}{
		{"vaapi", c.Encoders["h264_vaapi"] && c.VAAPIDevice},
		{"nvenc", c.Encoders["h264_nvenc"] && c.Nvidia},
		{"qsv", c.Encoders["h264_qsv"] && c.VAAPIDevice},
	}
	for _, tc := range tests {
		if !tc.present {
			continue
		}
		c.Functional[tc.kind] = c.testEncoder(ctx, tc.kind)
	}

	c.Probed = true
}

// testEncoder actually encodes two frames with a hardware encoder.
// "ffmpeg lists the encoder and the device node exists" is not the same as
// "this works" — the VA-API *driver* is a separate package from ffmpeg,
// and older Intel graphics need the legacy i965 driver rather than the
// modern iHD one. Without this, the admin console would offer hardware
// encoding that then fails to start on every attempt.
func (c *Caps) testEncoder(ctx context.Context, kind string) FunctionalResult {
	source := []string{"-f", "lavfi", "-i", "testsrc2=size=320x240:rate=5", "-frames:v", "2"}
	var args []string
	switch kind {
	case "vaapi":
		args = append([]string{"-hide_banner", "-loglevel", "error", "-vaapi_device", c.VAAPIDevicePath}, source...)
		args = append(args, "-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-f", "null", "-")
	case "qsv":
		args = append([]string{"-hide_banner", "-loglevel", "error"}, source...)
		args = append(args, "-vf", "format=nv12", "-c:v", "h264_qsv", "-f", "null", "-")
	case "nvenc":
		args = append([]string{"-hide_banner", "-loglevel", "error"}, source...)
		args = append(args, "-c:v", "h264_nvenc", "-f", "null", "-")
	default:
		return FunctionalResult{OK: true}
	}
	_, stderr, err := run(ctx, c.FFmpegPath, args...)
	lastLine := lastNonEmptyLine(stderr)
	if len(lastLine) > 160 {
		lastLine = lastLine[:160]
	}
	return FunctionalResult{OK: err == nil, Error: lastLine}
}

func lastNonEmptyLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.TrimSpace(lines[i]) != "" {
			return lines[i]
		}
	}
	return ""
}

// Available is which encoders can actually be used on this machine right
// now, e.g. for an admin capability listing.
type Available struct {
	ID     string
	Label  string
	Usable bool
	Reason string
}

func (c *Caps) Available() []Available {
	entry := func(id, label string, builtIn, deviceOK bool, deviceReason string) Available {
		if !builtIn {
			return Available{id, label, false, "not built into this ffmpeg"}
		}
		if !deviceOK {
			return Available{id, label, false, deviceReason}
		}
		probe, tested := c.Functional[id]
		if !tested {
			return Available{id, label, false, "not tested yet"}
		}
		if probe.OK {
			return Available{id, label, true, ""}
		}
		reason := probe.Error
		if reason == "" {
			reason = "no detail"
		}
		return Available{id, label, false, "the device is present but a test encode failed — " + reason}
	}

	x264Reason := ""
	if !c.Encoders["libx264"] {
		x264Reason = "not built into this ffmpeg"
	}
	return []Available{
		{"x264", "libx264 (CPU)", c.Encoders["libx264"], x264Reason},
		entry("vaapi", "VA-API (Intel/AMD GPU)", c.Encoders["h264_vaapi"], c.VAAPIDevice, c.VAAPIDevicePath+" is not present in the container"),
		entry("nvenc", "NVENC (NVIDIA GPU)", c.Encoders["h264_nvenc"], c.Nvidia, "no NVIDIA device in the container"),
		entry("qsv", "Quick Sync (Intel)", c.Encoders["h264_qsv"], c.VAAPIDevice, c.VAAPIDevicePath+" is not present in the container"),
	}
}

// Resolve picks a usable encoder for the configured preference, CPU as the
// floor.
func (c *Caps) Resolve(requested string) string {
	want := strings.ToLower(c.EncoderOverride)
	if want == "" {
		want = strings.ToLower(requested)
	}
	if want == "" {
		want = "auto"
	}

	usable := map[string]bool{}
	for _, e := range c.Available() {
		if e.Usable {
			usable[e.ID] = true
		}
	}

	if want != "auto" {
		if usable[want] {
			return want
		}
		return "x264"
	}
	for _, candidate := range []string{"nvenc", "vaapi", "qsv"} {
		if usable[candidate] {
			return candidate
		}
	}
	return "x264"
}

// OutputArgs is the output-stage ffmpeg arguments for the resolved
// encoder.
func OutputArgs(kind string, comp Composition) []string {
	fps := comp.FPS
	if fps == 0 {
		fps = 30
	}
	gopSeconds := comp.GopSeconds
	if gopSeconds == 0 {
		gopSeconds = 2
	}
	gop := int(gopSeconds*float64(fps) + 0.5)
	if gop < 1 {
		gop = 1
	}
	maxrate := comp.MaxrateKbps
	if maxrate == 0 {
		maxrate = comp.BitrateKbps
	}
	bufsize := comp.BufsizeKbps
	if bufsize == 0 {
		bufsize = comp.BitrateKbps * 2
	}
	common := []string{
		"-r", strconv.Itoa(fps),
		"-g", strconv.Itoa(gop),
		"-keyint_min", strconv.Itoa(gop),
		"-sc_threshold", "0",
		"-b:v", strconv.Itoa(comp.BitrateKbps) + "k",
		"-maxrate", strconv.Itoa(maxrate) + "k",
		"-bufsize", strconv.Itoa(bufsize) + "k",
	}

	switch kind {
	case "nvenc":
		return append([]string{
			"-c:v", "h264_nvenc",
			"-preset", "p1",
			"-tune", "ull",
			"-rc", "cbr",
			"-zerolatency", "1",
		}, common...)
	case "vaapi":
		return append([]string{
			"-c:v", "h264_vaapi",
			"-rc_mode", "CBR",
			"-compression_level", "1",
		}, common...)
	case "qsv":
		// No hwupload for this path: the filtergraph ends in software NV12
		// and h264_qsv takes it directly. Uploading to a VAAPI frames
		// context (which -vaapi_device would give us) produces frames this
		// encoder cannot accept, and the graph fails to configure.
		return append([]string{
			"-c:v", "h264_qsv",
			"-preset", "veryfast",
			"-low_power", "1",
		}, common...)
	default: // "x264"
		preset := comp.Preset
		if preset == "" {
			preset = "ultrafast"
		}
		args := []string{
			"-c:v", "libx264",
			"-preset", preset,
			"-tune", "zerolatency",
			"-profile:v", "high",
			"-pix_fmt", "yuv420p",
		}
		args = append(args, common...)
		args = append(args, "-x264-params", "nal-hrd=cbr:keyint="+strconv.Itoa(gop)+":min-keyint="+strconv.Itoa(gop)+":scenecut=0")
		if comp.Threads > 0 {
			args = append(args, "-threads", strconv.Itoa(comp.Threads))
		}
		return args
	}
}
