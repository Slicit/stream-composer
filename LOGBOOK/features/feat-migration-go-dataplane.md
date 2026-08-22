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
6. Not yet started: compositor/layout engine (flagged as the single
   biggest remaining port), bandwidth history, viewer-state endpoint —
   later slices of this same Go phase, each to land and be tested
   independently before the next.
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

## Links

- Branch: `migration/go-rails-react`
- Related features: none yet (first phase of a new multi-phase migration)
- Related docs: `docs/ARCHITECTURE.md` ("Security model", "Restreaming")
  describes the Node behavior this ports
- External: dev/test environment on the `siberian-next` Debian box
  (`ssh siberian`, `~/stream-composer`)
