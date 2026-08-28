# go-service — data plane

Phase 1 of the Rails/Postgres/React migration (see
`LOGBOOK/features/feat-migration-go-dataplane.md`). This is the
performance-critical half of the backend split: the MediaMTX auth hook and
the WHEP/HLS media proxy, ported from `server/src/routes/hooks.js` and
`server/src/proxy.js` to stay behaviorally identical and diffable against
the originals.

The control-plane half (admin/CRUD/auth/users) is not here — that is the
Rails service (`../rails-service`), and this is now genuinely wired to it:
`internal/streamstore.RailsBridge` polls `rails-service`'s
`Internal::StreamsController` every 2s and refreshes an in-memory `Store`.
`internal/streamstore.JSONBridge` (reading the same JSON file the Node
backend still writes) still exists for standalone testing without Rails
running, but is no longer what the dev stack uses by default. Neither
`internal/authhook` nor `internal/mediaproxy` needed to change for the
swap — both depend only on the `streamstore.Store` interface, never on
where the data actually comes from.

No Go toolchain is required locally — everything here runs through Docker.

## Test

```bash
docker run --rm -v $(pwd):/app -w /app golang:1.23 sh -c \
  'go build ./... && go vet ./... && go test ./...'
```

## Run (dev stack, MediaMTX included)

From the repo root:

```bash
docker compose -f docker-compose.migration.yml up -d --build
curl http://localhost:18080/healthz
```

By default this brings up `rails` and `postgres` too, and the data plane
reads live stream data from Rails (`RAILS_INTERNAL_API_URL`/
`RAILS_INTERNAL_API_TOKEN`, wired in the compose file). To fall back to the
legacy JSON-file bridge instead, set `STREAM_CONFIG_PATH` (and bind-mount it
under `./migration-data`) and unset the two `RAILS_INTERNAL_API_*` vars —
see the compose file's comments.

Startup order note: `depends_on` only waits for the `rails` container to
start, not for Puma to actually be ready — the data plane's first poll
often fails once or twice with "connection refused" before Rails finishes
booting. This is expected; the restart-until-it-connects behavior recovers
on its own within a few seconds. Worth a real healthcheck later.

## Layout

- `internal/streamstore` — the `Store` interface both other packages depend
  on, an in-memory `Memory` implementation, the interim JSON-file bridge,
  and `RailsBridge` (the real integration).
- `internal/access` — `CanAccess`, ported from `server/src/access.js`.
- `internal/authhook` — the MediaMTX auth callback, ported from
  `server/src/routes/hooks.js`.
- `internal/mediaproxy` — the WHEP/HLS reverse proxy, ported from
  `server/src/proxy.js`.
- `internal/relayrunner` — per-stream restream supervision, ported from
  `server/src/relays.js`.
- `internal/layout` — the grid-shape math. `Compute` (`layout.go`) is
  ported field-for-field from `server/src/layout.js` (golden-master
  tested against its exact output — see `layout_test.go` before touching
  it) and is what a horizontal composition uses. `ComputeForCanvas`
  (`layout_canvas.go`, no golden-master constraint) is a separate,
  portrait-aware best-fit search ported from
  `react-app/src/lib/clientLayout.ts`'s `bestGrid`, used for a vertical
  composition — `Compute`'s landscape-only `ceil(sqrt(count))` guess packs
  a tall canvas badly.
- `internal/encoder` — hardware/software encoder capability detection,
  ported from `server/src/encoder.js`.
- `internal/compositor` — the ffmpeg filtergraph builder and job
  supervisor a channel's composed restream runs on, ported from
  `server/src/compositor.js`. See "Compositor service" below.
- `internal/compositionscheduler` — polls `Store` + MediaMTX and decides
  which channel compositions should currently be running (enabled + a
  live member + an enabled destination), reconciling against the
  compositor service's job API.
- `cmd/dataplane` — wires everything above except `compositor` and
  `internal/compositor` into the main data-plane HTTP server.
- `cmd/compositor` — a separate binary/container wiring `internal/compositor`
  + `internal/encoder` into their own small HTTP server (`Dockerfile.compositor`).

## Compositor service

A channel's server-side compositor (composite N sources into one encoded
feed, publish it back into MediaMTX, relay it to YouTube/TikTok/etc.) runs
as its own container, deliberately separate from `dataplane`: a heavy or
misbehaving composition job must never affect ordinary viewers' WHEP
proxying or the MediaMTX auth hook's latency.

**This is fully automatic in normal operation** — nothing to run by hand.
`internal/compositionscheduler` (inside `dataplane`) polls Rails config and
MediaMTX live status, and for every `ChannelComposition` that's enabled,
has at least one live member, and has at least one enabled
`ChannelRelayDestination`, it starts a job on the compositor service;
everything else, it stops. `internal/authhook` only authorizes a
`composed/<channelId>/<orientation>` publish/read when Rails actually has
that composition enabled — the compositor service can't be told to publish
somewhere it isn't supposed to, even by whoever holds the internal
credential.

Turn it on by enabling a `ChannelComposition` and adding at least one
enabled `ChannelRelayDestination` to it (self-service:
`/api/channels/mine/:id/compositions`, admin:
`/api/admin/channels/:id/compositions` — see the React "Compositor &
restream" section on a channel's edit page) — within one poll cycle,
`composed/<channelId>/<orientation>` shows up ready in MediaMTX and the
relay starts forwarding it out.

For lower-level debugging, `cmd/compositor`'s job API is still directly
reachable — useful for checking a specific ffmpeg command or capability
probe without going through the full Rails/dataplane loop, but a
hand-crafted job's own publish only succeeds if `id`/`outputPath` matches
a composition Rails actually has enabled (see above):

```bash
curl http://localhost:18081/healthz
curl http://localhost:18081/caps   # what this machine can actually encode with
curl http://localhost:18081/jobs   # every job dataplane currently has running, and its state/restarts/exact command
```
