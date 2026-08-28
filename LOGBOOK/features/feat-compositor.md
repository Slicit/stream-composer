---
status: shipped
branch: migration/go-rails-react
---

# Server-side compositor: restream a whole channel, composed

## Intent

Every viewer on this site is served by pure browser composition: each
source is an independent WHEP session, the browser lays the grid out and
decodes every tile itself, and the server never touches video. That's
deliberate ([[feat-migration-go-dataplane]]) and stays completely
unchanged by this feature — but it structurally cannot serve one specific
need: pushing a single flattened, composed picture of a channel out to a
third-party RTMP ingest (YouTube, TikTok, etc.), because those platforms
need one encoded feed, not N independent streams a browser could assemble.

This adds that capability back, scoped narrowly: opt-in (admin-granted,
`users.can_use_compositor`), per channel, for streamers who want to
simulcast their composed channel outward. Supports both horizontal and
vertical (portrait) orientations, independently, at once if wanted.

## Decisions

- **A separate service (`compositor`), not folded into `dataplane`.**
  `dataplane` is on the critical path for every viewer's WHEP proxying and
  the MediaMTX auth hook — low-latency, always-on, must stay lean. A
  composition job is real, ongoing CPU cost and occasionally misbehaving;
  isolating it means it can never affect ordinary viewers or other
  channels, and it gets its own `cpus`/`mem_limit` in
  `docker-compose.go-rails-react.yml`, independent of `dataplane`'s.
  `dataplane`'s `internal/compositionscheduler` is the only caller,
  reaching it over the internal network exactly like it reaches Rails —
  no public routes at all.
- **Ported from the pre-migration app's real compositor, not rebuilt.**
  `server/src/compositor.js` + `layout.js` + `encoder.js` already solved
  the hard parts (filtergraph construction, process supervision with
  backoff, hardware-encoder capability probing with a real test encode,
  since a listed encoder isn't necessarily a working one) — ported to
  `go-service/internal/{compositor,encoder}` rather than designed from
  scratch. `internal/layout.Compute` (horizontal, golden-master tested —
  see [[feat-migration-go-dataplane]]) stays untouched; vertical uses a
  new `ComputeForCanvas` in a separate file, ported from
  `react-app/src/lib/clientLayout.ts`'s portrait-aware `bestGrid`.
- **The compositor is "dumb" — it has no opinion on what should be
  running.** `internal/compositionscheduler` (in `dataplane`) polls Rails
  config + MediaMTX live status and turns "enabled + a live member + an
  enabled destination" into `POST`/`DELETE` calls against the compositor's
  job API, idempotently (a signature check skips re-POSTing an unchanged
  job every tick). `internal/authhook` authorizes a
  `composed/<channelId>/<orientation>` publish/read only when Rails
  actually has that composition enabled.
- **Relaying a composed output reuses `internal/relayrunner` unchanged.**
  `streamstore.Relay` gained `ChannelCompositionID` alongside `StreamID` —
  two Rails tables (`RelayDestination`, `ChannelRelayDestination`, kept
  separate per their own models' comments) feed one shape `relayrunner`
  iterates. `Tick` branches on which is set to resolve the source path and
  its liveness; `buildArgs`/`PreviewCommand` needed zero changes, already
  source-agnostic.
- **`MAX_COMPOSITOR_JOBS` caps concurrency** (default 4) — the safety
  valve against a box being asked to composite more than it realistically
  can. Reconfiguring an already-running job never counts against the cap,
  only genuinely new ones do.

## Verification

Real end-to-end runs on the dev box at every phase, not just unit tests —
enabling a composition purely through the Rails API and watching the
whole chain (scheduler → compositor → MediaMTX composed path →
relayrunner → an external destination) reconcile itself with zero manual
triggering, both orientations at once, and clean teardown in both
directions. See each phase's commit message
(`06d1a21`/`1fbfdee`/`1d48aba`/`4dcbb18`/`4651289` on
`migration/go-rails-react`) for the specifics. All `go-service` packages
and the Rails suite pass throughout.

## Links

- Branch: `migration/go-rails-react`
- Related features: [[feat-migration-go-dataplane]] (the browser-composition
  architecture this deliberately does not change),
  [[feat-migration-production-deploy]] (the compose/install-script
  conventions this follows for `COMPOSITOR_IMAGE`/`COMPOSITOR_TAG`)
- External: none
