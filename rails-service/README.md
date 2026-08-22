# rails-service — control plane

Phase 2 of the Rails/Postgres/React migration (see
`LOGBOOK/features/feat-migration-rails-control-plane.md`). This is the
admin/CRUD half of the backend split: users, auth, and stream management —
ported from `server/src/auth.js`, `server/src/streams.js`,
`server/src/access.js` and `server/src/routes/{admin,streamer}.js`, kept
behaviorally identical so it can be diffed against the originals.

The data-plane half (media proxy, MediaMTX auth hook) is the Go service
(`../go-service`) — not here. This service knows nothing about MediaMTX;
that boundary is deliberate (see the top-level migration LOGBOOK entry).

No Ruby/Rails/Postgres toolchain is required locally — everything here runs
through Docker, on the same dev box as `go-service`.

## Test

From the repo root:

```bash
docker compose -f docker-compose.migration.yml build rails
docker compose -f docker-compose.migration.yml run --rm \
  -e RAILS_ENV=test \
  -e DATABASE_URL=postgres://scmig:migration-dev-secret@postgres:5432/scmig_test \
  rails bash -c 'bin/rails db:test:prepare && bundle exec rspec'
```

(A dedicated `DATABASE_URL` for the test run matters — the compose file's
own `DATABASE_URL` points at the *development* database, and Rails' own
DATABASE_URL handling overrides the per-environment database name in
`config/database.yml`, so without this override `db:test:prepare` would
reach for the same database the dev server container is using.)

## Run (dev stack)

```bash
docker compose -f docker-compose.migration.yml up -d postgres rails
curl http://localhost:13000/up
```

No bootstrap-admin flow exists yet (that's the Node backend's
`ADMIN_USER`/`ADMIN_PASSWORD` env vars, not yet ported) — seed one by hand
for now:

```bash
docker compose -f docker-compose.migration.yml exec rails bin/rails runner \
  'User.create!(username: "admin", password: "change-me-please", role: "admin")'
```

## Migrating from the legacy `config.json`

```bash
docker compose -f docker-compose.migration.yml exec rails \
  bin/rails migrate_from_json:run[/path/to/config.json]
```

Straight field copy, no fuzz: user passwords carry over exactly (Ruby's
`OpenSSL::KDF.scrypt` produces byte-for-byte identical output to Node's
`crypto.scryptSync` for the same salt/params — confirmed and pinned in
`spec/models/user_spec.rb`), so no forced password reset. Safe to re-run
against the same file; matches existing rows by `id`.

## Layout

- `app/models/user.rb` — auth, roles, quota, the last-administrator guard,
  scrypt password hashing compatible with the Node backend.
- `app/models/session.rb` — DB-backed sessions behind the `sc_session`
  cookie (a step beyond the Node backend's stateless signed cookie: only a
  SHA-256 digest of the token is ever stored).
- `app/models/stream.rb` + `app/models/concerns/accessible.rb` —
  `accessible_to?`, ported from `access.js`'s `canAccess` the same way the
  Go data plane's `internal/access` ports it, so all three implementations
  stay diffable against each other.
- `app/controllers/api/` — `auth#login/logout/me`,
  `admin/{users,streams}` (full admin CRUD), `streams` (the streamer role's
  `/streams/mine` self-service, quota-enforced, ownership-scoped).
- `lib/tasks/migrate_from_json.rake` — the config.json -> Postgres import.

Not yet ported: channels, restream destinations, the audio-monitor
relay's configuration, admin settings. Those are later slices of this same
phase.
