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
- `internal/layout` — the grid-shape math, ported field-for-field from
  `server/src/layout.js` (golden-master tested against its exact output —
  see `layout_test.go` before touching it).
- `internal/encoder` — hardware/software encoder capability detection,
  ported from `server/src/encoder.js`.
- `internal/compositor` — the ffmpeg filtergraph builder and job
  supervisor a channel's composed restream runs on, ported from
  `server/src/compositor.js`. See "Compositor service" below.
- `cmd/dataplane` — wires everything above except `compositor` into the
  main data-plane HTTP server.
- `cmd/compositor` — a separate binary/container wiring `internal/compositor`
  + `internal/encoder` into their own small HTTP server (`Dockerfile.compositor`).

## Compositor service

A channel's server-side compositor (composite N sources into one encoded
feed, publish it back into MediaMTX, relay it to YouTube/TikTok/etc. — see
the plan in `LOGBOOK` once it lands there) runs as its own container,
deliberately separate from `dataplane`: a heavy or misbehaving composition
job must never affect ordinary viewers' WHEP proxying or the MediaMTX auth
hook's latency. `cmd/compositor` exposes a small job API; nothing calls it
automatically yet (that orchestration — deciding *which* channels should
currently be compositing, from Rails config + live status — is a later
phase, owned by `dataplane`), but it's directly reachable for manual
validation once the dev stack is up:

```bash
curl http://localhost:18081/healthz
curl http://localhost:18081/caps   # what this machine can actually encode with

curl -X POST http://localhost:18081/jobs -H 'Content-Type: application/json' -d '{
  "id": "manual-test",
  "sources": [{"path": "live/<a real, currently-publishing stream key>", "label": "Cam"}],
  "options": {"width": 1920, "height": 1080, "fps": 30, "bitrateKbps": 4500, "outputPath": "composed/manual-test"}
}'
curl http://localhost:18081/jobs/manual-test   # state, restarts, the exact ffmpeg command in use
# then, in MediaMTX's own API: the composed/manual-test path should show up ready

curl -X DELETE http://localhost:18081/jobs/manual-test
```

**Known gap, expected until the next phase:** the job above reads its
source fine but MediaMTX's auth hook (`internal/authhook`) currently
returns `401 Unauthorized` on the actual publish — it only recognizes
`ProgramPath` (the old single global "program") and `AudioPrefix/*` as
authorized publish targets, nothing yet allows an arbitrary
`composed/<channelId>/<orientation>` path. Confirmed by running the exact
same command by hand: filtergraph, encoder args and the RTSP input all
work correctly; only the final ANNOUNCE is refused. Teaching the auth hook
about composed paths (authorized only when that specific composition is
actually supposed to be running, per Rails config) is exactly what the
data-plane orchestration phase adds.
