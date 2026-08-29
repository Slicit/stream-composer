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
`users.compositor_quota` — how many compositions this account may have
enabled at once, default 0, same shape as the existing `stream_quota`),
per channel, for streamers who want to simulcast their composed channel
outward. Supports both horizontal and vertical (portrait) orientations,
independently, at once if wanted.

## Decisions

- **A quota (`compositor_quota`), not a boolean.** Shipped first as
  `can_use_compositor` (a plain on/off), then changed to a numeric quota —
  same shape as `stream_quota` — mirroring the existing self-service
  precedent exactly: `Api::ChannelCompositionsController#update` refuses
  to newly *enable* a composition once the caller already has
  `compositor_quota` compositions enabled across all their channels
  (re-saving or disabling one already enabled never counts against it),
  admin bypassing the check entirely — the identical rule
  `Api::StreamsController#create` already applies to `stream_quota`. Lets
  an admin grant "up to N at once" rather than only all-or-nothing.
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
  config + MediaMTX live status and turns "enabled + a live member" into
  `POST`/`DELETE` calls against the compositor's job API, idempotently (a
  signature check skips re-POSTing an unchanged job every tick).
  `internal/authhook` authorizes a `composed/<channelId>/<orientation>`
  publish/read only when Rails actually has that composition enabled. A
  relay destination was a precondition too, at first — removed once it
  became clear the composed output is worth having, previewable, the
  moment it's live, before anyone has wired up a real destination (see
  the preview-URL decision below).
- **A source joining/leaving is a warm handoff, never an in-place
  restart.** ffmpeg cannot add or remove a filtergraph input from a
  running process, so any config change means killing one process and
  starting another — and doing that under one fixed output path is worse
  for an already-connected viewer than the outage itself suggests:
  MediaMTX's LL-HLS reader sessions are scoped to a specific publisher
  instance, so an already-open session doesn't stall when the publisher
  changes, it dies outright and stays dead (confirmed live, first: the
  exact same session URL that returned 200 before a restart returned 401
  afterward, forever, on every subsequent poll). `compositionscheduler`
  now debounces a signature change (mirrors `compositor.js`'s own
  `stabilizeMs`, ported here as `COMPOSITION_STABILIZE_MS`/
  `COMPOSITION_MAX_STABILIZE_MS` — a source flapping in and out
  shouldn't thrash the encoder) and then starts the new configuration
  under its own generation-scoped path
  (`composed/<channelId>/<orientation>/g<N>`, tracked by the new
  `Generations` registry, shared in-process with `mediaproxy` and
  `relayrunner`) *before* touching the old one. Only once the new
  generation is confirmed live does `Generations` flip to it, and only
  after `COMPOSITION_DRAIN_MS` (default 5s — was 20s at first; see the
  correction below) does the old generation actually stop. `mediaproxy`
  embeds the resolved generation into the
  redirect a real player follows (`RewriteLocation`/
  `Parsed.RedirectPublicPath`), so every later relative fetch for that
  player's session — sub-playlist, init segment, media segments, all
  resolved by the player itself, no rewriting needed beyond that one
  redirect — keeps hitting the *same* generation for as long as it's
  alive, regardless of what's since become current. `relayrunner` reads
  the same registry rather than the bare path, since the compositor
  never actually publishes to that bare path anymore. `authhook` needed
  a matching fix, caught live (not in a unit test): its own
  `splitComposedPath` rejected the new three-segment publish path
  outright ("malformed composed path"), which would have silently kept
  every composition permanently on generation 1 forever in production.
  Verified live end to end: a real second source joining a running
  composition, with a real HLS session polled continuously throughout —
  200 for the ~50s the old generation was draining, uninterrupted
  through the handoff to the new one, 401 only once the drain window
  actually elapsed; a fresh top-level fetch during that window already
  resolved to the new generation.
- **`COMPOSITION_DRAIN_MS` shipped at 20s, then got corrected to 5s** —
  reported live, immediately: a channel with 3 vertical members had its
  center one stopped, and the composed picture looked permanently
  gapped, then never seemed to restore even once that member came back.
  Reproduced with real ffmpeg publishers end to end: the scheduler
  itself was never the problem — 2-source and then 3-source-again
  generations both started, went live, and re-stacked *correctly*
  (confirmed visually, a real frame grabbed off each), right on the
  schedule the logs said they would. The 20s default was the actual
  bug: it optimized for "give a real browser player time to notice and
  re-poll its manifest," which most players — VLC very much included —
  don't reliably do on their own. The practical effect for anyone
  watching one continuous session (exactly how this feature is used) is
  a long stretch of visibly stale, gapped video with no signal that
  anything is happening, easily mistaken for "this doesn't work at
  all." The drain's actual job — avoid an abrupt cut for whoever is
  mid-request right when a handoff completes — needs a few seconds, not
  twenty. Rather than trying to jam a hard fix in place of already-shipped
  and verified behavior, this is a tuning correction on top of it: the
  handoff/generation mechanism is unchanged, only the default a viewer
  actually experiences.
- **A composed-preview HLS URL, pasteable straight into VLC.** Every
  `ChannelComposition` gets a `preview_token` (Rails, `SecureRandom.hex`,
  generated once, never rotated) the moment it's created, exposed as
  `previewToken` in `as_public_json` and, over the internal bridge, to
  `streamstore.ChannelComposition.PreviewToken`. `internal/mediaproxy`
  (already the reverse proxy fronting MediaMTX for viewers) resolves
  `GET /mtx/hls/c/<channelId>/<orientation>/*?token=...` the same way it
  resolves `s/<playbackId>/...`, except authorized by that token
  (constant-time compared) instead of the viewer session — deliberately:
  VLC carries no `sc_session` cookie to send. The token is unrelated to
  and no more privileged than MediaMTX's own internal credential, which
  never leaves the container network either way — it only ever grants
  this one already-composed output, never a raw source, and only once the
  composition is `enabled`. Confirmed live (see Verification) with a real
  ffmpeg publisher and zero relay destinations configured: the job
  started, MediaMTX reported the composed path ready, and the resulting
  URL resolved to genuine playable HLS (fMP4 init + parts) through the
  proxy's normal redirect-rewriting — a wrong or missing token 404s.
- **Relaying a composed output reuses `internal/relayrunner`'s process
  supervision unchanged.** `streamstore.Relay` gained
  `ChannelCompositionID` alongside `StreamID` — two Rails tables
  (`RelayDestination`, `ChannelRelayDestination`, kept separate per their
  own models' comments) feed one shape `relayrunner` iterates. `Tick`
  branches on which is set to resolve the source path and its liveness;
  `buildArgs`/`PreviewCommand` needed zero changes, already
  source-agnostic — only *resolving* that path changed, once generations
  existed to resolve (see the warm-handoff decision above): it now reads
  `Generations.Current` instead of building the bare path itself, and
  treats "no generation live yet" as the same kind of `waiting` state a
  channel with no live member already was.
- **`MAX_COMPOSITOR_JOBS` caps concurrency** (default 4) — the safety
  valve against a box being asked to composite more than it realistically
  can. Reconfiguring an already-running job never counts against the cap,
  only genuinely new ones do.
- **Name captions match the browser's, not `compositor.js`'s.** `Labels`/
  `LabelSize` were threaded end-to-end from day one but drew the
  pre-migration original's own choice — white text, black outline
  (`internal/compositor/compositor.go`'s `BuildArgs`, `drawtext=...
  fontcolor=white:...borderw=...bordercolor=black`). Changed to match
  `ViewerTile.tsx`'s actual on-air caption exactly instead: the same
  canonical green (`#1a8900`) on the same near-opaque black
  (`rgba(0,0,0,0.9)`), via `drawtext`'s `box=1:boxcolor=black@0.9`. Two
  things the browser's CSS can do that this can't, confirmed against the
  real ffmpeg (5.1) this image ships rather than assumed from newer docs:
  a border-radius (no rounded-box primitive in `drawtext` at all) and
  asymmetric padding (`boxborderw` takes one `<int>` here — the
  pipe-separated per-axis form is a newer ffmpeg release only, and
  errored a live job out with `Invalid chars '|11'` the first time this
  shipped, caught before commit by grabbing an actual frame off the
  running composed RTSP output and looking at it, not just reading the
  built ffmpeg command string). Both left as square corners and uniform
  padding. The on/off toggle itself needed no new plumbing — `labels` was
  already a real column on each independent per-orientation row — only a
  `Switch` added to `ChannelCompositionSection.tsx`'s `OrientationCard`,
  wired through the same `onUpdate` patch pattern as everything else on
  the card.

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

The preview-URL addition got the same treatment: a real ffmpeg publisher
pushed a live source, a composition was enabled through the admin API
with `destinations: []`, and the compositor job started anyway (the
scheduler change) — `docker compose logs dataplane` showed the job
request, MediaMTX's path list showed `composed/<channelId>/horizontal`
ready, and `curl`ing the resulting `/mtx/hls/c/...?token=...` URL
followed MediaMTX's own cookie-check redirect straight through to a real,
live low-latency HLS playlist. A wrong token and no token each 404'd on
the same URL. Clean teardown confirmed afterward (job stopped once
disabled).

The warm-handoff work got the most thorough live pass of any phase here,
specifically because the bug it fixes only shows up under a real,
sustained connection — a unit test can prove the state machine is
internally consistent, but not that MediaMTX actually behaves the way the
design assumes. Real ffmpeg publishers for two sources, a composition
enabled with just the first (generation 1 → abandoned and superseded by
generation 2 mid-warm-up by an unrelated disable/enable toggle, itself a
live confirmation the abandon path works), a real HLS session fetched and
then polled once a second continuously, the second source brought live
mid-poll. The session kept returning 200 for the entire ~50s the old
generation (2) spent draining after generation 3 went live with both
sources — no interruption at all from the viewer's side — then 401 once
the drain window actually elapsed and it stopped, matching
`COMPOSITION_DRAIN_MS`'s default almost exactly. A fresh top-level fetch
partway through that window already resolved to generation 3. Caught one
real bug this way that no unit test would have: `authhook`'s
`splitComposedPath` rejected the new three-segment publish path outright,
which would have kept every composition stuck on generation 1 in
production — the compositor jobs API accepted the start request, but
MediaMTX itself refused the publish (`malformed composed path`), a
failure mode invisible from `compositionscheduler`'s own success-shaped
unit tests.

The `COMPOSITION_DRAIN_MS` correction got the same real-usage scrutiny
that found it needed correcting in the first place: 3 real ffmpeg
sources composited vertically, the center one stopped and, later,
brought back — each transition confirmed three ways, not just one: the
dataplane's own logs (generation N starting → live, in each direction,
right on the debounce/startup schedule), the compositor's `/jobs`
status for every generation involved, and an actual frame grabbed off
the live RTSP output at each stage. Both re-stacks were pixel-correct
(2-across when the count dropped to 2, back to the original 2-up/
1-centered arrangement once it returned to 3) — proving the layout math
was never the bug. The only thing that changed here is the default a
viewer sits with while that correct new generation is already live and
waiting.

## Links

- Branch: `migration/go-rails-react`
- Related features: [[feat-migration-go-dataplane]] (the browser-composition
  architecture this deliberately does not change),
  [[feat-migration-production-deploy]] (the compose/install-script
  conventions this follows for `COMPOSITOR_IMAGE`/`COMPOSITOR_TAG`)
- External: none
