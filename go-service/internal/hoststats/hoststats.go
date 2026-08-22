// Package hoststats reads host CPU/memory straight from /proc, the same
// way server/src/stats.js did — no external library, since this only ever
// needs to answer "what is the encoder/dataplane costing on this box" for
// the admin console, not a general-purpose metrics agent. Linux-only by
// design (every deployment target is a Linux container); a read that
// fails just leaves that field zero rather than erroring the whole
// snapshot.
package hoststats

import (
	"bufio"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

type CPUInfo struct {
	Cores    int       `json:"cores"`
	Model    string    `json:"model"`
	SpeedMhz int       `json:"speedMhz"`
	Load     []float64 `json:"load"`
}

type Memory struct {
	TotalMb int     `json:"totalMb"`
	UsedMb  int     `json:"usedMb"`
	Percent float64 `json:"percent"`
}

type Snapshot struct {
	// nil until a second reading establishes a delta — mirrors the old
	// app's own "null on the very first call" behavior rather than
	// reporting a misleading 0%.
	CPUPercent *float64 `json:"cpuPercent"`
	CPU        CPUInfo  `json:"cpu"`
	Memory     Memory   `json:"memory"`
	UptimeSec  int64    `json:"uptimeSec"`
	Platform   string   `json:"platform"`
	Hostname   string   `json:"hostname"`
}

// Reader holds the one bit of state cpuPercent needs across calls: the
// previous /proc/stat sample, to turn a cumulative counter into a rate.
type Reader struct {
	mu                  sync.Mutex
	hasLast             bool
	lastIdle, lastTotal uint64
}

func New() *Reader {
	return &Reader{}
}

func (r *Reader) Snapshot() Snapshot {
	return Snapshot{
		CPUPercent: r.cpuPercent(),
		CPU:        cpuInfo(),
		Memory:     memory(),
		UptimeSec:  uptimeSec(),
		Platform:   runtime.GOOS + " " + runtime.GOARCH,
		Hostname:   hostname(),
	}
}

func (r *Reader) cpuPercent() *float64 {
	idle, total, ok := readTotalCPU()
	if !ok {
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.hasLast {
		r.lastIdle, r.lastTotal = idle, total
		r.hasLast = true
		return nil
	}
	idleDelta := float64(idle - r.lastIdle)
	totalDelta := float64(total - r.lastTotal)
	r.lastIdle, r.lastTotal = idle, total
	if totalDelta <= 0 {
		return nil
	}
	pct := round1(clamp(0, 100, (1-idleDelta/totalDelta)*100))
	return &pct
}

// readTotalCPU parses /proc/stat's first "cpu " line: user nice system
// idle iowait irq softirq steal guest guest_nice. idle = idle + iowait,
// total = sum of every field — same split the old app used.
func readTotalCPU() (idle, total uint64, ok bool) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0, false
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	if !scanner.Scan() {
		return 0, 0, false
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0, false
	}
	var vals []uint64
	for _, f := range fields[1:] {
		v, err := strconv.ParseUint(f, 10, 64)
		if err != nil {
			return 0, 0, false
		}
		vals = append(vals, v)
		total += v
	}
	idle = vals[3]
	if len(vals) > 4 {
		idle += vals[4]
	}
	return idle, total, true
}

var memInfoLine = regexp.MustCompile(`^(\w+):\s+(\d+) kB`)

func memory() Memory {
	totalKb, availKb, ok := readMemInfo()
	if !ok || totalKb == 0 {
		return Memory{}
	}
	usedKb := totalKb - availKb
	return Memory{
		TotalMb: int(totalKb / 1024),
		UsedMb:  int(usedKb / 1024),
		Percent: round1(float64(usedKb) / float64(totalKb) * 100),
	}
}

func readMemInfo() (totalKb, availKb uint64, ok bool) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, false
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		m := memInfoLine.FindStringSubmatch(scanner.Text())
		if m == nil {
			continue
		}
		v, err := strconv.ParseUint(m[2], 10, 64)
		if err != nil {
			continue
		}
		switch m[1] {
		case "MemTotal":
			totalKb = v
		case "MemAvailable":
			availKb = v
		}
	}
	return totalKb, availKb, totalKb > 0
}

var (
	modelNameRe = regexp.MustCompile(`(?m)^model name\s*:\s*(.+)$`)
	cpuMhzRe    = regexp.MustCompile(`(?m)^cpu MHz\s*:\s*([\d.]+)$`)
)

func cpuInfo() CPUInfo {
	info := CPUInfo{Cores: runtime.NumCPU(), Model: "unknown", Load: readLoadAvg()}
	raw, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return info
	}
	if m := modelNameRe.FindSubmatch(raw); m != nil {
		info.Model = strings.TrimSpace(string(m[1]))
	}
	if m := cpuMhzRe.FindSubmatch(raw); m != nil {
		if mhz, err := strconv.ParseFloat(string(m[1]), 64); err == nil {
			info.SpeedMhz = int(mhz)
		}
	}
	return info
}

func readLoadAvg() []float64 {
	raw, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return []float64{0, 0, 0}
	}
	fields := strings.Fields(string(raw))
	load := make([]float64, 0, 3)
	for i := 0; i < 3 && i < len(fields); i++ {
		v, err := strconv.ParseFloat(fields[i], 64)
		if err != nil {
			v = 0
		}
		load = append(load, round1(v*100)/100)
	}
	return load
}

func uptimeSec() int64 {
	raw, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(raw))
	if len(fields) == 0 {
		return 0
	}
	v, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}
	return int64(v)
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

func clamp(min, max, v float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
