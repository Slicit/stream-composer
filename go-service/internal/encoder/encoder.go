// Package encoder detects which video encoders are actually usable on this
// machine and builds the ffmpeg output-stage arguments for whichever one
// gets picked. Ported from server/src/encoder.js — same detection strategy
// (ffmpeg's own -encoders list, a device file check, then a real two-frame
// test encode, since "ffmpeg lists the encoder and /dev/dri exists" is not
// the same as "this actually works": the VA-API driver is a separate
// package from ffmpeg, and older Intel GPUs need the legacy i965 driver
// rather than the modern iHD one). NVENC is deliberately not ported: the
// Rails-side ChannelComposition#ENCODERS list only offers
// auto/software/vaapi/qsv, so there is nothing that would ever request it.
package encoder

import (
	"context"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Caps is what this machine can actually do, established once at startup
// by Probe.
type Caps struct {
	Probed        bool
	FFmpegVersion string
	Encoders      map[string]bool // ffmpeg -encoders' own ids, e.g. "libx264", "h264_vaapi"
	Drawtext      bool
	FontFile      string                      // "" if none of the usual container font paths exist
	VAAPIDevice   bool                        // whether the configured device file exists
	Functional    map[string]FunctionalResult // "vaapi" | "qsv" -> did a real test encode work
}

// fontCandidates are the usual places a caption font sits in a minimal
// container image lacking fontconfig — drawtext needs an explicit font
// file without it. Same list as encoder.js's.
var fontCandidates = []string{
	"/usr/share/fonts/dejavu/DejaVuSans.ttf",
	"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
	"/usr/share/fonts/TTF/DejaVuSans.ttf",
	"/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
	"/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
	"/usr/share/fonts/noto/NotoSans-Regular.ttf",
}

type FunctionalResult struct {
	OK    bool
	Error string
}

var encoderLine = regexp.MustCompile(`^\s*[A-Z.]{6}\s+(\S+)`)
var filterLine = regexp.MustCompile(`^\s*[TSC.]{3}\s+(\S+)`)

func run(ctx context.Context, bin string, args []string, timeout time.Duration) (stdout, stderr string, err error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	var outBuf, errBuf strings.Builder
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	err = cmd.Run()
	return outBuf.String(), errBuf.String(), err
}

// Probe runs ffmpeg's own -encoders/-filters listings, checks for the VAAPI
// device file, and — only for an encoder that's both built in and has its
// device present — actually tries a two-frame encode, since a listed
// encoder is not always a working one.
func Probe(ctx context.Context, ffmpegPath, vaapiDevicePath string) Caps {
	caps := Caps{Encoders: map[string]bool{}, Functional: map[string]FunctionalResult{}}

	version, _, err := run(ctx, ffmpegPath, []string{"-hide_banner", "-version"}, 10*time.Second)
	if err != nil {
		caps.Probed = true
		return caps
	}
	if lines := strings.SplitN(version, "\n", 2); len(lines) > 0 {
		caps.FFmpegVersion = strings.TrimSpace(lines[0])
	}

	enc, _, _ := run(ctx, ffmpegPath, []string{"-hide_banner", "-encoders"}, 10*time.Second)
	for _, line := range strings.Split(enc, "\n") {
		if m := encoderLine.FindStringSubmatch(line); m != nil {
			caps.Encoders[m[1]] = true
		}
	}

	filt, _, _ := run(ctx, ffmpegPath, []string{"-hide_banner", "-filters"}, 10*time.Second)
	for _, line := range strings.Split(filt, "\n") {
		if m := filterLine.FindStringSubmatch(line); m != nil && m[1] == "drawtext" {
			caps.Drawtext = true
		}
	}

	candidates := fontCandidates
	if override := os.Getenv("LABEL_FONT_FILE"); override != "" {
		candidates = append([]string{override}, candidates...)
	}
	for _, path := range candidates {
		if _, statErr := os.Stat(path); statErr == nil {
			caps.FontFile = path
			break
		}
	}

	if vaapiDevicePath != "" {
		if _, statErr := os.Stat(vaapiDevicePath); statErr == nil {
			caps.VAAPIDevice = true
		}
	}

	for _, kind := range []string{"vaapi", "qsv"} {
		present := caps.encoderID(kind) != "" && caps.Encoders[caps.encoderID(kind)] && caps.VAAPIDevice
		if !present {
			continue
		}
		caps.Functional[kind] = testEncoder(ctx, ffmpegPath, vaapiDevicePath, kind)
	}

	caps.Probed = true
	return caps
}

func (c Caps) encoderID(kind string) string {
	switch kind {
	case "vaapi":
		return "h264_vaapi"
	case "qsv":
		return "h264_qsv"
	case "software":
		return "libx264"
	default:
		return ""
	}
}

// testEncoder actually encodes two frames — see the package comment for
// why a listed encoder isn't necessarily a working one.
func testEncoder(ctx context.Context, ffmpegPath, vaapiDevicePath, kind string) FunctionalResult {
	source := []string{"-f", "lavfi", "-i", "testsrc2=size=320x240:rate=5", "-frames:v", "2"}
	var args []string
	switch kind {
	case "vaapi":
		args = append([]string{"-hide_banner", "-loglevel", "error", "-vaapi_device", vaapiDevicePath}, source...)
		args = append(args, "-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-f", "null", "-")
	case "qsv":
		args = append([]string{"-hide_banner", "-loglevel", "error"}, source...)
		args = append(args, "-vf", "format=nv12", "-c:v", "h264_qsv", "-f", "null", "-")
	default:
		return FunctionalResult{OK: true}
	}
	_, stderr, err := run(ctx, ffmpegPath, args, 20*time.Second)
	if err == nil {
		return FunctionalResult{OK: true}
	}
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	last := ""
	if len(lines) > 0 {
		last = lines[len(lines)-1]
	}
	if len(last) > 160 {
		last = last[:160]
	}
	return FunctionalResult{OK: false, Error: last}
}

// Usable reports whether the given encoder id (software|vaapi|qsv) can
// actually be used right now.
func (c Caps) Usable(id string) bool {
	if id == "software" {
		return c.Encoders["libx264"]
	}
	if !c.Encoders[c.encoderID(id)] || !c.VAAPIDevice {
		return false
	}
	r, tested := c.Functional[id]
	return tested && r.OK
}

// Resolve turns a requested encoder ("auto"|"software"|"vaapi"|"qsv" — see
// ChannelComposition::ENCODERS) into the one that will actually be used,
// software as the floor. "auto" prefers hardware, since that's what frees
// the CPU for scaling multiple sources at once.
func Resolve(requested string, caps Caps) string {
	want := strings.ToLower(strings.TrimSpace(requested))
	if want == "" {
		want = "auto"
	}
	if want != "auto" {
		if caps.Usable(want) {
			return want
		}
		return "software"
	}
	for _, candidate := range []string{"vaapi", "qsv"} {
		if caps.Usable(candidate) {
			return candidate
		}
	}
	return "software"
}

// EncodeOptions is the subset of a ChannelComposition the output stage
// needs — fps/bitrate/preset, not source/layout/caption details.
type EncodeOptions struct {
	FPS         int
	BitrateKbps int
	MaxrateKbps int // 0 -> defaults to BitrateKbps
	BufsizeKbps int // 0 -> defaults to BitrateKbps * 2
	Preset      string
	GOPSeconds  float64 // 0 -> defaults to 2
}

// OutputArgs is the encoder-specific tail of the ffmpeg command: rate
// control, GOP, and the codec itself. Ported from encoder.js's
// outputArgs().
func OutputArgs(kind string, o EncodeOptions) []string {
	fps := o.FPS
	if fps <= 0 {
		fps = 30
	}
	gopSeconds := o.GOPSeconds
	if gopSeconds <= 0 {
		gopSeconds = 2
	}
	gop := int(gopSeconds*float64(fps) + 0.5)
	if gop < 1 {
		gop = 1
	}
	maxrate := o.MaxrateKbps
	if maxrate <= 0 {
		maxrate = o.BitrateKbps
	}
	bufsize := o.BufsizeKbps
	if bufsize <= 0 {
		bufsize = o.BitrateKbps * 2
	}
	common := []string{
		"-r", strconv.Itoa(fps),
		"-g", strconv.Itoa(gop),
		"-keyint_min", strconv.Itoa(gop),
		"-sc_threshold", "0",
		"-b:v", strconv.Itoa(o.BitrateKbps) + "k",
		"-maxrate", strconv.Itoa(maxrate) + "k",
		"-bufsize", strconv.Itoa(bufsize) + "k",
	}

	switch kind {
	case "vaapi":
		return append([]string{"-c:v", "h264_vaapi", "-rc_mode", "CBR", "-compression_level", "1"}, common...)
	case "qsv":
		// No hwupload here: the filtergraph ends in software NV12 and
		// h264_qsv takes it directly. Uploading to a VAAPI frames context
		// (what -vaapi_device would give it) produces frames this encoder
		// cannot accept, and the graph fails to configure.
		return append([]string{"-c:v", "h264_qsv", "-preset", "veryfast", "-low_power", "1"}, common...)
	default: // software
		preset := o.Preset
		if preset == "" {
			preset = "veryfast"
		}
		args := []string{"-c:v", "libx264", "-preset", preset, "-tune", "zerolatency", "-profile:v", "high", "-pix_fmt", "yuv420p"}
		args = append(args, common...)
		args = append(args, "-x264-params", "nal-hrd=cbr:keyint="+strconv.Itoa(gop)+":min-keyint="+strconv.Itoa(gop)+":scenecut=0")
		return args
	}
}
