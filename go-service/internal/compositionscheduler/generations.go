package compositionscheduler

import (
	"sync"

	"github.com/Slicit/stream-composer/go-service/internal/config"
)

// Generations tracks, per (channelID, orientation), which output path (and
// generation number) is currently the live one — shared, in-process,
// between Scheduler (which writes it, as part of a warm handoff between
// ffmpeg processes) and internal/mediaproxy + internal/relayrunner (which
// read it to resolve a composed path that outlives any single ffmpeg
// process restart, rather than assuming the base, non-generation path is
// always current).
//
// Why this exists at all: ffmpeg has no way to add or remove an input from
// a running filtergraph, so compositing a different set of sources always
// means killing one process and starting another. A straight restart under
// one fixed output path means a moment with no publisher at all (MediaMTX
// serves nothing) followed by a moment with a *different* publisher
// instance — and MediaMTX's LL-HLS reader sessions are scoped to a
// specific publisher instance, so an already-connected viewer's session
// dies outright rather than just stalling (confirmed live: the exact same
// session URL that returned 200 before a restart returns 401 afterward,
// indefinitely — see feat-compositor.md). Instead, each new configuration
// gets its own generation-scoped output path (composed/<channelId>/
// <orientation>/g<N>), started *before* the old one stops, so the old
// generation keeps serving its already-connected viewers uninterrupted
// while the new one warms up — only once the new one is confirmed live
// does this registry flip to it (Scheduler.checkWarmupReady), and only
// after a grace period does the old generation's process actually get
// torn down (Scheduler.processDraining).
//
// The generation number, not just the path, is exposed here because
// internal/mediaproxy needs it too: a viewer's *existing* HLS session
// (already bound to a specific generation by an earlier redirect — see
// that package's Parsed.RedirectPublicPath) must keep resolving to that
// exact generation for as long as it's still draining, not whatever
// generation happens to be current by the time each follow-up
// sub-playlist/segment request arrives.
type Generations struct {
	mu      sync.RWMutex
	current map[string]generationEntry
}

type generationEntry struct {
	path string
	gen  string
}

// NewGenerations returns an empty registry — call once in main() and share
// the same pointer across Scheduler, the mediaproxy Resolver, and the
// relayrunner Runner.
func NewGenerations() *Generations {
	return &Generations{current: make(map[string]generationEntry)}
}

func (g *Generations) key(channelID, orientation string) string {
	return channelID + "/" + orientation
}

func (g *Generations) Set(channelID, orientation, path, gen string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.current[g.key(channelID, orientation)] = generationEntry{path: path, gen: gen}
}

func (g *Generations) Clear(channelID, orientation string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.current, g.key(channelID, orientation))
}

// Current returns the live output path and its generation number (as a
// string, ready to embed in a URL) for this composition, or ok=false if
// nothing has ever gone live for it yet.
func (g *Generations) Current(channelID, orientation string) (path, gen string, ok bool) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	e, found := g.current[g.key(channelID, orientation)]
	if !found {
		return "", "", false
	}
	return e.path, e.gen, true
}

// CurrentPath returns the MediaMTX path a fresh reader (one with no
// existing session yet — a top-level playlist fetch) should use right now
// for this composition. Falls back to the base, non-generation path when
// nothing has ever gone live for it yet — mainly so a caller from before
// Scheduler.Tick has run even once (or a test that never touches this
// registry at all) still gets a sane, deterministic answer rather than an
// empty string.
func (g *Generations) CurrentPath(cfg config.Config, channelID, orientation string) string {
	if path, _, ok := g.Current(channelID, orientation); ok {
		return path
	}
	return OutputPath(cfg, channelID, orientation)
}

// GenerationOutputPath is the MediaMTX path one specific generation of a
// composition publishes to — exported so internal/mediaproxy can resolve a
// generation-qualified composed-preview URL (an in-flight viewer session's
// follow-up request) back to the exact same shape Scheduler used when it
// started that generation, without the two ever risking disagreeing on it.
func GenerationOutputPath(cfg config.Config, channelID, orientation, gen string) string {
	return OutputPath(cfg, channelID, orientation) + "/g" + gen
}
