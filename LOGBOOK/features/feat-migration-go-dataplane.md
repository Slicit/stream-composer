---
status: active
branch: migration/go-rails-react
---

# Migration phase 1: Go data plane

## Intent

Full "almost ISO" rewrite of the validated vanilla-JS/Express/JSON-file
product onto React + Rails + Postgres, split into a control plane (Rails:
admin/CRUD, auth, users) and a data plane (Go: media proxy, ffmpeg/MediaMTX
supervision, restream, monitoring) rather than one monolith, because the
data plane is where bandwidth/CPU cost actually lives and the control plane
is not — Rails' ergonomics cost nothing there, and Go's performance
matters everywhere the media actually flows. MediaMTX stays exactly as it
is; only what talks to it changes.

Agreed plan (verbatim from the user): work on a dedicated migration branch;
build and validate one service at a time with its own tests, only wiring
services together once each is independently green; a simple one-shot data
migration script moves the old `config.json` into Postgres, no fuzz
required; order is Go first, then Rails (API-first), then React, with
MediaMTX still calling an internal API exactly as it calls the Node
backend's hook today.

Development happens on the Debian box already used for `siberian-next`
(`ssh siberian`) rather than the Windows laptop, which has no Go toolchain
— author locally, sync/test remotely, same loop as that project. Everything
here is prefixed `scmig-`/`sc-migration` on its own `scmig-net` network and
non-conflicting ports (18080, 11935, 19997), so it can run alongside both
`siberian-next`'s stack and any future real deployment of stream-composer
itself on the same host with zero collisions.

## Plan

1. ~~Go data plane, slice 1: the MediaMTX auth hook
   (`server/src/routes/hooks.js`) and the WHEP/HLS media proxy
   (`server/src/proxy.js`), ported field-for-field so the two implementations
   stay diffable. Both depend only on a `streamstore.Store` interface, not on
   how stream data actually arrives — satisfied for now by a JSON-file bridge
   (`internal/streamstore.JSONBridge`) that reads the same `config.json` the
   Node backend writes, so this service is genuinely runnable end-to-end
   before Rails exists.~~
2. ~~Unit tests for every ported piece (`access`, `authhook`, `mediaproxy`,
   the JSON bridge) — 30 tests, table-driven where the Node suite already
   was, SECURITY-labeled where the Node tests were.~~
3. ~~End-to-end smoke test against a real MediaMTX instance in the dev
   stack: an unknown stream key denied with the exact reason surfaced back
   to the RTMP client, then a real H.264 RTMP publish accepted once the key
   exists in the bridged config. Both the deny and allow paths confirmed via
   MediaMTX's own logs and the Go service's logs, not just curl against the
   Go service directly.~~
4. ~~Restream relay runner (`internal/relayrunner`): one supervised ffmpeg
   process per enabled destination, a straight RTSP-in/FLV-out remux ported
   field-for-field from `server/src/relays.js` (buildArgs, backoff,
   reconciliation via Tick()). `streamstore.Store` extended to carry relay
   data and a stream ID lookup; a new `internal/mediamtx` client lists live
   ingest paths so Tick() can tell a genuinely offline source from a failed
   destination and skip backoff for the former. Unit-tested via a narrowed
   `IngestLister` interface and a fake-ffmpeg shell script standing in for
   the real binary (start/stop/backoff-growth/source-gone paths), then
   verified for real: a synthetic RTMP source published into the dev
   MediaMTX, the runner's own ffmpeg picked it up and forwarded it live to
   an independent, unauthenticated MediaMTX instance standing in for a
   restream platform — confirmed both from the Go service's own logs and
   the receiving instance's logs. Dockerfile's runtime stage switched from
   distroless (no shell, no ffmpeg) to `debian:12-slim` with ffmpeg
   installed.~~
5. ~~Audio-monitor relay (`internal/audiomonitor`): one supervised ffmpeg
   Opus transcode per live source that has an audio track, ported
   field-for-field from `server/src/audioRelay.js`. Unlike the restream
   relay runner, this has no streamstore-side configuration at all — it
   reacts purely to what `mediamtx.ListIngest()` reports is currently
   live, keyed on the source's ingest key rather than a relay id.
   `internal/mediamtx.IngestPath` extended with a `HasAudio` field (ported
   from `mediamtx.js`'s `trackSummary()` regex) so `Tick()` can tell a
   video-only source from one worth transcoding. Same test shape as the
   relay runner (fake `IngestLister`, fake-ffmpeg shell script for
   start/stop/backoff), then verified live: the audio track of a synthetic
   RTMP source was picked up and republished to MediaMTX under
   `audio/<key>` as genuine Opus — confirmed via MediaMTX's own path list
   showing an `Opus` track, not just a process running.~~
6. ~~Browser composition (descoped from a full server-side ffmpeg
   compositor — decision below): `internal/layout` ports layout.js's
   grid/spotlight/row/column/fixed-NxN cell math field-for-field, verified
   cell-for-cell against the real Node implementation across 17 cases
   (golden JSONL fixture generated via node on the dev box). `internal/
   encoder` ports encoder.js's capability probing/resolve/outputArgs, kept
   for completeness though nothing calls it yet with server-side encoding
   out of scope; verified both against Node's outputArgs() output and via
   a real Probe() run against the box's own ffmpeg. `internal/playability`
   ports playability.js's ffprobe-based B-frames-over-WebRTC check
   unchanged, since it applies to browser composition too. `internal/
   sourceselector` is the new, browser-only replacement for compositor.js's
   selection/ordering logic (selectSources/planLayout) — no ffmpeg process
   at all, since the browser assembles the grid itself from individual WHEP
   sessions. streamstore.Stream gained Name/Nickname, Store gained a
   Streams() accessor, and Internal::StreamsController now returns both
   fields — verified live via curl against the real running Rails
   container.~~
7. ~~Bandwidth history (`internal/bandwidthhistory`, item 4/8): ported
   field-for-field from bandwidthHistory.js — samples every 15 minutes,
   keeps 7 days, tracks inbound (ingest-prefixed paths only) vs. outbound
   (every read, any path) bytes from MediaMTX's own counters, resets to
   zero rather than reporting a negative/nonsense rate when a counter goes
   backwards (a republish or a MediaMTX restart). `mediamtx.Client` gained
   `ListPaths()` (the unfiltered path list, byte counters included) since
   `ListIngest()` alone isn't enough here. Exposed at
   `GET /internal/<token>/bandwidth-history`, same shared-secret-in-the-
   URL shape as the auth hook. Verified live: rebuilt and restarted the
   dataplane container in the dev stack, confirmed the endpoint returns
   real JSON (a first sample reporting zero, as expected with no prior
   baseline).~~
8. ~~Viewer-state endpoint (`internal/viewerstate`, item 5/8): the Go,
   browser-composition-only equivalent of routes/api.js's GET /api/state.
   Wires together sourceselector (on-air sources + grid layout),
   audiomonitor's live status (a source only reports hasAudio once its
   Opus republish is actually live, not merely requested — avoids a
   viewer opening a WHEP audio session against a path that isn't
   publishing yet), and playability (per-source B-frames-over-WebRTC
   check). mediamtx.IngestPath gained ReadyTime so a republish re-probes
   playability instead of reusing a stale verdict, matching
   playability.js's own cache-keyed-by-session behavior. Exposed at
   GET /api/state, unauthenticated for now — the same open access-control
   question already flagged for the WHEP/HLS handlers. Composition
   defaults (layout/width/height/gap) are env-configurable on the Go side
   only for now; not yet a Rails-side setting (see the LOGBOOK note on
   config.go).

   Verified live end to end on the dev stack: with nothing publishing,
   /api/state correctly reported program.ready=false and an empty grid;
   after publishing a real synthetic RTMP+audio source, it correctly
   flipped to ready=true, a one-cell "auto" layout, the source appearing
   in both onAir and streams with live=true, and hasAudio=true only once
   the audio monitor's own Opus transcode came up — not the instant the
   source itself went live.~~

This closes every item of the original 8-item gap-fill plan except
production build/deploy (never scoped here) and the React viewer/admin
screens that consume these new endpoints — those remain open work outside
this Go data-plane phase.

9. ~~Session auth wired into the Go data plane (item 1 of the follow-on
   "what's still missing" plan): the WHEP/HLS mounts and GET /api/state
   were correct but always anonymous (`UserFromContext` returning nil for
   every caller), since nothing resolved the sc_session cookie into an
   identity. Rails gained `GET /internal/<token>/sessions/<digest>`
   (`Internal::SessionsController`, a new `Session.authenticate_by_digest`
   alongside the existing `authenticate`) — the Go side sends only the
   cookie's SHA-256 digest, never the raw token, so a leaked request or
   log line here is useless to replay. The shared `verify_token!`
   before_action (previously only on `Internal::StreamsController`) was
   extracted into an `InternalTokenAuthenticatable` concern both
   controllers now include. New Go package `internal/sessionauth`:
   `Resolver.Resolve()` calls that endpoint, and `Guard()` is HTTP
   middleware reading the `sc_session` cookie and attaching the result via
   `mediaproxy.WithUser` — degrading to anonymous (not failing the
   request) whenever there's no cookie or Rails is unreachable. Wired into
   `cmd/dataplane/main.go` only when `RAILS_INTERNAL_API_URL` is set
   (nothing to ask otherwise); `access.CanAccess`, already wired into
   `mediaproxy.ResolvePlayback` since Go phase 1, is what turns "no user"
   or "wrong user" into an actual denial — the guard's only job is making
   sure a real identity reaches it.

   Verified live end to end on the dev stack, not just via RSpec/Go unit
   tests: logged in for a real admin sc_session cookie, published a real
   RTMP source under a stream marked `visibility: private`, then compared
   a WHEP request with no cookie (denied — 404 "Unknown stream.", the same
   opaque denial an unknown playback id gets) against the identical
   request with the admin's cookie (granted — the request reached
   MediaMTX itself, which only complained about the deliberately
   malformed test SDP body, not access).

10. ~~Channel viewing (item 4/5 of the follow-on plan): `GET /api/
    channels/{slug}/state`, the channel-scoped equivalent of `GET /api/
    state`. Rails' internal API gained `channels` (configuration only —
    name/slug/membership/access; viewing a channel's live state is
    entirely a data-plane concern per `Channel`'s own doc comment) and
    `settings.homepageChannelSlug`. `streamstore` gained a `Channel` type
    threaded through `Memory`/`JSONBridge`/`RailsBridge` identically to
    streams/relays. `access.CanAccessChannel` is `CanAccess`'s identical
    twin for a channel (both now share one internal `canAccess()` rule).
    Two independent checks: the channel gate (404 for the whole thing if
    denied, same opaque posture as an unknown stream) and, per member,
    whether *that* viewer can see *that* stream — an inaccessible member
    is marked `restricted` with no path/audioPath at all, but still
    occupies its grid cell live (a restricted tile is a client-side
    placeholder, not a server-side absence, matching compositor.js's
    original web-mode design). `viewerstate.State`/`StreamEntry` gained
    the fields both endpoints share (`Restricted`, an optional `Channel`
    block, `Settings.HomepageChannelSlug`) rather than a parallel type.

    React: new `/c/:slug` route (`ChannelViewerPage`), a `useChannelState`
    hook, and a shared `ComposedGrid` component (extracted from
    `ViewerPage`) with a third tile kind — a "This stream is private"
    placeholder — alongside the existing live-tile and playability-problem
    cases. `"/"` now redirects to the configured homepage channel, reusing
    `GET /api/state`'s own `homepageChannelSlug` rather than a second
    request — resolves the frontend phase's own "how does the homepage
    channel work" open question.

    Building this surfaced a real routing bug: `vite.config.ts` only
    special-cased the literal `/api/state` path to the data plane, so
    `/api/channels/:slug/state` fell through to the general `/api/*` rule
    (Rails, which has no such route) — a 404 from the wrong service
    entirely, not from `channelstate.Build`'s own access gate. Fixed with
    a regex proxy key scoped to that one path shape.

    Verified live end to end in a real browser, not just unit tests: made
    a channel public with one still-private member stream and a real
    published source — anonymous viewing showed the member on-air but
    restricted (no video, the placeholder), while the owner's real session
    saw it live and actually playing (640x480, decoded frames) with
    working audio. Confirmed `/` actually redirects to `/c/:slug` once a
    homepage channel is configured.~~

5. ~~Rails control plane (API-first), the Postgres data model, the
   `config.json` -> Postgres migration script — see
   [[feat-migration-rails-control-plane]] for that phase's own detail.~~
6. Not started: React frontend.
7. ~~Wiring the Go data plane's `streamstore.Store` to a real Rails
   internal API client (`internal/streamstore.RailsBridge`), replacing the
   JSON-file bridge as the dev stack's default — "connect the services and
   validate the integration" (the user's phrase). Verified as a live
   integration, not just two independently-green test suites: a stream
   created through Rails became publishable over real RTMP within one Go
   poll cycle, and deleting it made the same key get refused directly by
   the Go hook. Full detail (including the host-authorization bug this
   surfaced) is in [[feat-migration-rails-control-plane]]'s Decisions,
   since fixing it touched Rails' config, not this file's own code.~~

## Decisions

### 2026-08-22

- **Decision:** split into a Go data plane and a Rails control plane, not
  one backend rewritten in a single language.
- **Why:** the user's own framing — bandwidth is uncontrollable (unicast),
  so the lever is backend efficiency, and that efficiency only matters on
  the path media actually flows through. The admin/CRUD surface has none of
  that pressure, so it can optimize for developer ergonomics instead.
- **Impact:** the two services have no shared runtime — only a contract
  (the internal auth-hook API today, a broader internal API once Rails
  exists) — so each can be rewritten, redeployed, or even replaced
  independently.

- **Decision:** the data plane depends on a `streamstore.Store` interface,
  never directly on a JSON file or a Postgres/Rails client.
- **Why:** the plan explicitly calls for validating each service with tests
  *before* wiring integrations — an interface with an in-memory fake lets
  `authhook`/`mediaproxy` be fully tested with no Rails, no Postgres, no
  MediaMTX at all. The JSON-file bridge is a second, real implementation of
  the same interface, added only so the service is honestly runnable end to
  end during this window, not a shortcut baked into the core logic.
- **Impact:** swapping the bridge for a Rails HTTP client later touches
  `cmd/dataplane/main.go` and adds one new `streamstore` implementation;
  `authhook` and `mediaproxy` do not change.

- **Decision:** every port (`access.CanAccess`, `authhook.Decide`,
  `mediaproxy.ResolvePlayback`/`ParseRequest`/`RewriteLocation`) is a
  field-for-field translation of the existing, already-shipped, already
  security-reviewed Node logic — not a redesign.
- **Why:** this code is exactly what `docs/ARCHITECTURE.md`'s "Security
  model" section describes as the one place access is decided, and its four
  numbered rules exist because each naive version was previously
  exploitable. A rewrite-from-scratch would have to rediscover those same
  lessons; porting keeps them.
- **Impact:** test cases were written to mirror the Node suite's own
  SECURITY-labeled cases (traversal, percent-encoding, WHIP never routed,
  private-stream denial, the internal-credential requirement for reads)
  rather than being invented independently, so a divergence is easy to spot.

### 2026-08-22 (relay runner)

- **Decision:** the relay runner treats "source not publishing" and "ffmpeg
  failed" as different outcomes with different consequences — the former
  stops the process (if any) and reports "waiting" with no backoff; only
  the latter schedules an exponentially growing retry.
- **Why:** OBS reconnecting after a network blip is normal and frequent;
  treating it as a failure would mean a real disconnect gets the same
  multi-second backoff as a rejected/typo'd stream key, delaying recovery
  for the common case to protect against the rare one. `relays.js` already
  drew this distinction; the port preserves it rather than collapsing both
  into one "not running" state.
- **Impact:** `Tick()` checks the live-ingest key set before deciding
  whether a stopped/never-started relay is "waiting" (reset backoff) or
  still inside a scheduled retry window (leave it alone).

- **Decision:** `internal/mediamtx.Client` is narrowed to an
  `IngestLister` interface at the `relayrunner.Runner` boundary rather
  than the runner depending on `*mediamtx.Client` directly.
- **Why:** `Tick()`'s reconciliation logic (stop what's unwanted, start
  what's live and enabled, back off what's failing) is the part worth unit
  testing in isolation, and that requires controlling exactly which keys
  are "live" without a real MediaMTX instance.
- **Impact:** `tick_test.go` fakes both dependencies — a fake
  `IngestLister` for live/offline key sets, and a real `exec.Command`
  pointed at a small on-the-fly shell script standing in for ffmpeg — to
  exercise start/stop/backoff-growth/source-gone entirely offline, in well
  under a second per test.

### 2026-08-22 (browser composition, not server-side ffmpeg composition)

- **Decision:** the Go migration does not port compositor.js's ffmpeg
  encoder process supervision (start/apply/tick building and running a
  real filtergraph encode). Only the parts that decide *what* goes on
  screen — layout math and source selection/ordering — are ported, as a
  new `internal/sourceselector` with no ffmpeg process at all.
- **Why:** explicit user direction mid-session — server-side composition
  was flagged as the single biggest remaining port, and the user chose to
  put it aside and scope this phase to browser composition (the existing
  `comp.mode === 'web'` path, where the browser assembles the grid from
  individual WHEP sessions) plus the audio monitor's Opus transcode
  (already done, see item 5 above).
- **Impact:** `internal/layout` and `internal/playability` are fully
  needed either way and are done. `internal/encoder` was already built and
  verified (both against Node's own outputArgs() output and a real Probe()
  against the box's ffmpeg) before this direction landed; it is kept since
  it is correct and complete, but nothing calls it yet — server-side
  encoding stays out of scope until/unless that changes. If it's revisited
  later, `compositor.js`'s `start()`/`apply()`/`tick()` process-supervision
  logic (killCurrent, scheduleRestart, the signature-based debounce/
  stabilize window) is what's still unported.

## Links

- Branch: `migration/go-rails-react`
- Related features: none yet (first phase of a new multi-phase migration)
- Related docs: `docs/ARCHITECTURE.md` ("Security model", "Restreaming")
  describes the Node behavior this ports
- External: dev/test environment on the `siberian-next` Debian box
  (`ssh siberian`, `~/stream-composer`)
