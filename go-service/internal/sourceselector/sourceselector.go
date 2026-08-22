// Package sourceselector decides which live sources are "on air" and where
// they go on the browser-composed grid. It is the browser-composition-only
// slice of server/src/compositor.js — the parts that pick and arrange
// sources (selectSources, planLayout) — with none of the ffmpeg encoder
// process supervision, because this deployment never runs a server-side
// composed encode: the browser assembles the grid itself from individual
// WHEP sessions, exactly like compositor.js's own comp.mode === 'web'
// branch already did.
package sourceselector

import (
	"sort"
	"strings"

	"github.com/Slicit/stream-composer/go-service/internal/layout"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

// Composition is the subset of composition settings that affect selection
// and layout — everything selectSources()/planLayout() in compositor.js
// read from store.get().composition.
type Composition struct {
	Include string   // "auto" or "manual"
	Order   []string // operator-chosen stream keys, in order
	Layout  string   // "auto", "solo", "row", "column", "spotlight", or "NxM"
	Width   int
	Height  int
	GapPx   int
}

// Source is one on-air stream, everything the browser needs to open a WHEP
// session and caption the tile.
type Source struct {
	Key      string
	Name     string
	Label    string // caption to burn/overlay; nickname wins over name
	Path     string // ingest path, e.g. "live/<key>"
	HasAudio bool
}

// Select works out which streams should be on air, in the operator's
// chosen order. Ported field-for-field from compositor.js's
// selectSources().
func Select(live []mediamtx.IngestPath, store streamstore.Store, comp Composition, ingestPrefix string) []Source {
	configured := make(map[string]streamstore.Stream, len(store.Streams()))
	for _, s := range store.Streams() {
		configured[s.Key] = s
	}
	readyKeys := make(map[string]bool)
	liveByKey := make(map[string]mediamtx.IngestPath, len(live))
	for _, l := range live {
		liveByKey[l.Key] = l
		if l.Ready {
			readyKeys[l.Key] = true
		}
	}

	var keys []string
	if comp.Include == "manual" {
		for _, k := range comp.Order {
			if readyKeys[k] {
				keys = append(keys, k)
			}
		}
	} else {
		ordered := make([]string, 0, len(comp.Order))
		orderedSet := make(map[string]bool)
		for _, k := range comp.Order {
			if readyKeys[k] {
				ordered = append(ordered, k)
				orderedSet[k] = true
			}
		}
		var rest []string
		for k := range readyKeys {
			if !orderedSet[k] {
				rest = append(rest, k)
			}
		}
		sort.Slice(rest, func(i, j int) bool {
			ni := displayName(configured, rest[i])
			nj := displayName(configured, rest[j])
			return naturalLess(ni, nj)
		})
		keys = append(ordered, rest...)
	}

	// Streams that were explicitly disabled never make it on air.
	filtered := keys[:0:0]
	for _, k := range keys {
		if s, ok := configured[k]; ok && !s.Enabled {
			continue
		}
		filtered = append(filtered, k)
	}

	sources := make([]Source, 0, len(filtered))
	for _, key := range filtered {
		meta, hasMeta := configured[key]
		name := key
		if hasMeta && meta.Name != "" {
			name = meta.Name
		}
		label := name
		if hasMeta && strings.TrimSpace(meta.Nickname) != "" {
			label = strings.TrimSpace(meta.Nickname)
		}
		sources = append(sources, Source{
			Key:      key,
			Name:     name,
			Label:    label,
			Path:     ingestPrefix + "/" + key,
			HasAudio: liveByKey[key].HasAudio,
		})
	}
	return sources
}

// displayName is what the sort in Select() compares by — the same
// meta.name-or-key fallback the ordering used in compositor.js.
func displayName(configured map[string]streamstore.Stream, key string) string {
	if s, ok := configured[key]; ok && s.Name != "" {
		return s.Name
	}
	return key
}

// naturalLess is a locale-insensitive, numeric-aware string comparison —
// the same effect as JS's localeCompare(..., { numeric: true, sensitivity:
// 'base' }), so "stream2" sorts before "stream10".
func naturalLess(a, b string) bool {
	ai, bi := 0, 0
	al, bl := strings.ToLower(a), strings.ToLower(b)
	for ai < len(al) && bi < len(bl) {
		ac, bc := al[ai], bl[bi]
		if isDigit(ac) && isDigit(bc) {
			as, ae := ai, ai
			for ae < len(al) && isDigit(al[ae]) {
				ae++
			}
			bs, be := bi, bi
			for be < len(bl) && isDigit(bl[be]) {
				be++
			}
			an := strings.TrimLeft(al[as:ae], "0")
			bn := strings.TrimLeft(bl[bs:be], "0")
			if len(an) != len(bn) {
				return len(an) < len(bn)
			}
			if an != bn {
				return an < bn
			}
			ai, bi = ae, be
			continue
		}
		if ac != bc {
			return ac < bc
		}
		ai++
		bi++
	}
	return len(al)-ai < len(bl)-bi
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// Placement is the result of arranging a set of on-air sources into cells —
// exactly what planLayout() in compositor.js returns, so a browser-composed
// grid matches a would-be server-encoded one cell for cell.
type Placement struct {
	Layout layout.Result
	Placed []Source
}

// PlanLayout works out the grid and which sources make it into it. Ported
// field-for-field from compositor.js's planLayout().
func PlanLayout(sources []Source, comp Composition) Placement {
	l := layout.Compute(len(sources), layout.Options{
		Width: comp.Width, Height: comp.Height, Gap: comp.GapPx, Layout: comp.Layout,
	})
	placed := sources
	if len(placed) > len(l.Cells) {
		placed = placed[:len(l.Cells)]
	}
	return Placement{Layout: l, Placed: placed}
}
