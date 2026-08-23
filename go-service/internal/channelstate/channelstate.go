// Package channelstate builds the payload a channel's viewer needs — the
// same shape viewerstate produces for the global grid, scoped to one
// channel's curated, ordered member list, plus a restricted flag on any
// member the calling viewer cannot actually reach (a public channel may
// still curate a private stream). Viewing a channel is a data-plane
// concern by design — see streamstore.Channel's own doc comment — Rails
// owns only the channel's configuration (membership, access, background
// image).
package channelstate

import (
	"context"
	"strings"
	"time"

	"github.com/Slicit/stream-composer/go-service/internal/access"
	"github.com/Slicit/stream-composer/go-service/internal/audiomonitor"
	"github.com/Slicit/stream-composer/go-service/internal/mediamtx"
	"github.com/Slicit/stream-composer/go-service/internal/playability"
	"github.com/Slicit/stream-composer/go-service/internal/sourceselector"
	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
	"github.com/Slicit/stream-composer/go-service/internal/viewerstate"
)

type IngestLister interface {
	ListIngest(ctx context.Context) ([]mediamtx.IngestPath, error)
}

type AudioStatusOf interface {
	StatusOf(key string) audiomonitor.Status
}

// Build assembles one channel's state. found is false — with a zero State
// and nil error — when the slug is unknown or the caller may not see the
// channel at all; the caller should treat that identically to "not
// found," the same opaque-denial posture ResolvePlayback already uses for
// a stream.
func Build(ctx context.Context, store streamstore.Store, mtx IngestLister, checker *playability.Checker, audio AudioStatusOf, comp sourceselector.Composition, ingestPrefix, slug string, user *streamstore.User) (state viewerstate.State, found bool, err error) {
	channel, ok := store.FindChannelBySlug(slug)
	if !ok || !access.CanAccessChannel(channel, user) {
		return viewerstate.State{}, false, nil
	}

	live, err := mtx.ListIngest(ctx)
	if err != nil {
		return viewerstate.State{}, true, err
	}
	liveByKey := make(map[string]mediamtx.IngestPath, len(live))
	for _, l := range live {
		liveByKey[l.Key] = l
	}

	streamByID := make(map[string]streamstore.Stream)
	for _, s := range store.Streams() {
		streamByID[s.ID] = s
	}

	// Every member with a real backing stream, enabled, in the channel's
	// own curated order — this is both the "streams" roster and (filtered
	// to on-air) the layout's source order, exactly like the global
	// endpoint uses one selection for both.
	type member struct {
		stream     streamstore.Stream
		restricted bool
		liveInfo   mediamtx.IngestPath
		isLive     bool
	}
	members := make([]member, 0, len(channel.StreamIDs))
	for _, sid := range channel.StreamIDs {
		s, ok := streamByID[sid]
		if !ok || !s.Enabled || s.PlaybackID == "" {
			continue
		}
		l, live := liveByKey[s.Key]
		members = append(members, member{
			stream:     s,
			restricted: !access.CanAccess(&s, user),
			liveInfo:   l,
			isLive:     live && l.Ready,
		})
	}

	// The on-air/layout set: live members only, restricted ones included
	// (they still occupy a cell — the client renders a placeholder there,
	// never a live tile — matching every prior "don't distinguish an
	// access denial from unavailable" posture in this codebase).
	var onAirSources []sourceselector.Source
	var onAirMembers []member
	for _, m := range members {
		if !m.isLive {
			continue
		}
		name := m.stream.Name
		if strings.TrimSpace(m.stream.Nickname) != "" {
			name = strings.TrimSpace(m.stream.Nickname)
		}
		onAirSources = append(onAirSources, sourceselector.Source{
			Key: m.stream.Key, Name: name, Label: name,
			Path: ingestPrefix + "/" + m.stream.Key, HasAudio: m.liveInfo.HasAudio,
		})
		onAirMembers = append(onAirMembers, m)
	}

	placement := sourceselector.PlanLayout(onAirSources, comp)
	placedMembers := onAirMembers
	if len(placedMembers) > len(placement.Placed) {
		placedMembers = placedMembers[:len(placement.Placed)]
	}

	onAir := make([]viewerstate.OnAirEntry, 0, len(placement.Placed))
	for _, m := range placedMembers {
		caption := m.stream.Name
		if strings.TrimSpace(m.stream.Nickname) != "" {
			caption = strings.TrimSpace(m.stream.Nickname)
		}
		pid := m.stream.PlaybackID
		onAir = append(onAir, viewerstate.OnAirEntry{Key: &pid, Name: caption})
	}

	streamEntries := make([]viewerstate.StreamEntry, 0, len(members))
	for _, m := range members {
		name := m.stream.Name
		if strings.TrimSpace(m.stream.Nickname) != "" {
			name = strings.TrimSpace(m.stream.Nickname)
		}

		var problem *playability.Problem
		if !m.restricted && checker != nil {
			if st := checker.Status(m.stream.Key); st != nil {
				problem = st.Problem
			}
		}

		hasAudio := false
		if !m.restricted && audio != nil {
			hasAudio = m.liveInfo.HasAudio && audio.StatusOf(m.stream.Key).State == "live"
		}

		entry := viewerstate.StreamEntry{
			Key: m.stream.PlaybackID, Name: name, Live: m.isLive,
			HasAudio: hasAudio, Problem: problem, Restricted: m.restricted,
		}
		if !m.restricted {
			path := "s/" + m.stream.PlaybackID
			audioPath := "s/" + m.stream.PlaybackID + "/audio"
			entry.Path, entry.AudioPath = &path, &audioPath
		}
		streamEntries = append(streamEntries, entry)
	}

	var layout *viewerstate.Layout
	if placement.Layout.Layout != "" || len(placement.Layout.Cells) > 0 {
		cells := make([]viewerstate.Cell, len(placement.Layout.Cells))
		for i, c := range placement.Layout.Cells {
			cells[i] = viewerstate.Cell{X: c.X, Y: c.Y, W: c.W, H: c.H}
		}
		layout = &viewerstate.Layout{
			Name: placement.Layout.Layout, Cols: placement.Layout.Cols, Rows: placement.Layout.Rows,
			Cells: cells, Width: placement.Layout.Width, Height: placement.Layout.Height,
		}
	}

	return viewerstate.State{
		Settings: viewerstate.Settings{PublicViewing: store.PublicViewingEnabled()},
		Program: viewerstate.Program{
			Mode: "web", Ready: len(placement.Placed) > 0,
			Width: comp.Width, Height: comp.Height, GapPx: comp.GapPx,
		},
		Layout:     layout,
		OnAir:      onAir,
		Streams:    streamEntries,
		ServerTime: time.Now().UTC().Format(time.RFC3339),
		Channel: &viewerstate.ChannelInfo{
			Name: channel.Name, Slug: channel.Slug, BackgroundImage: channel.BackgroundImage,
			Description: channel.Description, CurrentTopic: channel.CurrentTopic, FeaturedGame: channel.FeaturedGame,
		},
	}, true, nil
}

// BuildLiveMap answers "is this channel live" for every channel the
// caller can see — the left nav's bulk status check. Deliberately not
// Build repeated per channel: no layout, no restricted-member filtering,
// no per-stream problem/audio lookups, just membership + MediaMTX ready
// state, the same rule Build's own on-air selection uses ("live" =
// enabled, has a playback id, and MediaMTX reports it ready) — including
// a member the caller cannot actually watch, matching every other place
// in this codebase where a restricted stream still counts as occupying a
// cell rather than being invisible.
func BuildLiveMap(ctx context.Context, store streamstore.Store, mtx IngestLister, user *streamstore.User) (map[string]bool, error) {
	live, err := mtx.ListIngest(ctx)
	if err != nil {
		return nil, err
	}
	liveByKey := make(map[string]mediamtx.IngestPath, len(live))
	for _, l := range live {
		liveByKey[l.Key] = l
	}

	streamByID := make(map[string]streamstore.Stream)
	for _, s := range store.Streams() {
		streamByID[s.ID] = s
	}

	result := make(map[string]bool)
	for _, channel := range store.Channels() {
		c := channel
		if !access.CanAccessChannel(&c, user) {
			continue
		}
		isLive := false
		for _, sid := range channel.StreamIDs {
			s, ok := streamByID[sid]
			if !ok || !s.Enabled || s.PlaybackID == "" {
				continue
			}
			if l, ok := liveByKey[s.Key]; ok && l.Ready {
				isLive = true
				break
			}
		}
		result[channel.Slug] = isLive
	}
	return result, nil
}
