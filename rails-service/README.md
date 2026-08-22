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

The first `db:prepare` on a freshly created database seeds a bootstrap
admin (`User.ensure_bootstrap_admin!`, `db/seeds.rb`), same as the Node
backend's `ADMIN_USER`/`ADMIN_PASSWORD` env vars — set those, or read the
generated password it prints once, in the `rails` container's logs.

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
- `app/models/relay_destination.rb` — restream destinations' *data model*
  only (validation, provider defaults, key masking), ported from
  `relays.js`. The ffmpeg process supervision half of that file (starting,
  backing off, progress) is not here — that stays a data-plane concern for
  a later Go slice, same boundary as the media proxy.
- `app/models/channel.rb` — a named, sluggable, curated stream list any
  signed-in user may own, ported from `channels.js`'s *configuration* half
  (name/slug/membership/sharing/background image). Viewing a channel's live
  state (layout computation, on-air status) is not here — same data-plane
  boundary as everything else in this list.
- `app/models/app_setting.rb` — a deliberately tiny singleton, today only
  `homepage_channel_id`. Not a general settings store; see its own comment.
- `app/controllers/api/` — `auth#login/logout/me`,
  `admin/{users,streams,relays,channels}` (full admin CRUD, plus
  `PUT/DELETE admin/channels/:id/homepage`), `streams`/`relays`/`channels`
  (self-service `/streams/mine`, `/relays/mine`, `/channels/mine` —
  streams/relays are streamer-role and quota-enforced, channels are open to
  any signed-in user with no quota, matching `routes/channels.js`),
  `streams_available#index` (`/api/streams/available`, the pool a user may
  build a channel from). A channel's background image is a raw-body PUT
  (`Api::ChannelsController#background`) written to `public/uploads/`, no
  multipart parsing and no new dependency — mirrors `express.raw()` in the
  Node backend exactly.
- `app/controllers/internal/streams_controller.rb` — `GET
  /internal/:token/streams`, the read-only feed `go-service`'s
  `RailsBridge` polls every 2s. This is the actual integration point
  between the two services: same shared-secret-in-the-URL convention as
  the Node backend's own `/internal/*` (see its `routes/hooks.js`).
- `lib/tasks/migrate_from_json.rake` — the config.json -> Postgres import
  (users, streams, restream destinations, channels, and the homepage
  setting).

Not yet ported: the audio-monitor relay's configuration, most of admin
settings (only the two fields `Channel`/the internal API need exist).
Viewing a channel's live state is deliberately out of scope for Rails
entirely — see the LOGBOOK entry's Decisions.
