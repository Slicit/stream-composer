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
- `cmd/dataplane` — wires the above into an HTTP server.

Not yet ported: compositor/ffmpeg supervision, the restream relay, the audio
monitor relay, bandwidth history. Those are later slices of the same phase.
