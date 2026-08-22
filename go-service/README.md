# go-service — data plane

Phase 1 of the Rails/Postgres/React migration (see
`LOGBOOK/features/feat-migration-go-dataplane.md`). This is the
performance-critical half of the backend split: the MediaMTX auth hook and
the WHEP/HLS media proxy, ported from `server/src/routes/hooks.js` and
`server/src/proxy.js` to stay behaviorally identical and diffable against
the originals.

The control-plane half (admin/CRUD/auth/users) is not here — that is the
upcoming Rails service. Until it exists, this service reads stream
configuration from the same JSON file the Node backend already writes (see
`internal/streamstore.JSONBridge`), polled every 2s. That bridge is deleted
once the Rails internal API is live; nothing in `internal/authhook` or
`internal/mediaproxy` needs to change either time, since both depend only on
the `streamstore.Store` interface.

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

Point `STREAM_CONFIG_PATH` (and bind-mount it under `./migration-data`) at a
real `config.json` to test against real stream data — see the compose file's
comments.

## Layout

- `internal/streamstore` — the `Store` interface both other packages depend
  on, an in-memory `Memory` implementation, and the interim JSON-file bridge.
- `internal/access` — `CanAccess`, ported from `server/src/access.js`.
- `internal/authhook` — the MediaMTX auth callback, ported from
  `server/src/routes/hooks.js`.
- `internal/mediaproxy` — the WHEP/HLS reverse proxy, ported from
  `server/src/proxy.js`.
- `cmd/dataplane` — wires the above into an HTTP server.

Not yet ported: compositor/ffmpeg supervision, the restream relay, the audio
monitor relay, bandwidth history. Those are later slices of the same phase.
