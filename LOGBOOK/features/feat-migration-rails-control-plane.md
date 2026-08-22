---
status: active
branch: migration/go-rails-react
---

# Migration phase 2: Rails control plane

## Intent

Second phase of the React/Rails/Postgres migration (see
[[feat-migration-go-dataplane]] for phase 1 and the overall plan). Rails
owns everything the Go data plane deliberately does not: users, auth,
sessions, and stream/access-control CRUD. Ported from `server/src/auth.js`,
`server/src/streams.js`, `server/src/access.js`,
`server/src/routes/admin.js` and `server/src/routes/streamer.js`, kept
behaviorally identical (same validation rules, same error shapes, same
ownership/quota logic) so it can be diffed against the originals the same
way the Go phase's ports can.

Scaffolded with `rails new . --api --database=postgresql`, API-only, on the
same Debian dev box as the Go phase (no Ruby toolchain on the Windows
laptop either). `rails new` runs `git init` by default; that nested repo
was deleted immediately, since this app lives inside the stream-composer
repo, not its own.

## Plan

1. ~~Users: model (validations, roles, quota clamp, the last-administrator
   guard), scrypt password hashing confirmed byte-for-byte compatible with
   the Node backend, DB-backed sessions behind an `sc_session` cookie
   (only a SHA-256 digest of the token is stored, a step beyond the Node
   backend's stateless signed cookie).~~
2. ~~Streams: model (`Accessible` concern for `canAccess`/`accessible_to?`,
   ported identically across Node/Go/Rails), key/playback-id generation,
   `shared_with` as a Postgres array rather than a join table (matches the
   JSON it migrates from most directly).~~
3. ~~Controllers + routes: `Api::AuthController`
   (login/logout/me), `Api::Admin::UsersController`,
   `Api::Admin::StreamsController` (full admin CRUD), `Api::StreamsController`
   (`/streams/mine` self-service: quota-enforced on create, allowlisted
   PATCH fields, ownership-checked on every mutation).~~
4. ~~66 RSpec examples: model validations, the last-admin guard, the scrypt
   golden-value regression test, and request specs for every controller —
   including the exact cross-tenant-isolation and quota-boundary cases the
   Node streamer-role tests and the Go data plane's tests already cover, so
   the three implementations can be checked against the same scenarios.~~
5. ~~`lib/tasks/migrate_from_json.rake`: one-shot config.json -> Postgres
   import for users and streams, idempotent by id, with its own spec.~~
6. ~~End-to-end smoke test against the real running server (not just
   RSpec): login, cookie issued, authenticated stream creation, anonymous
   refusal — all confirmed over real HTTP through `docker compose up`.~~
7. ~~`User.ensure_bootstrap_admin!`, ported from `ensureBootstrapAdmin()`:
   only acts on a genuinely empty install, from `ADMIN_USER`/
   `ADMIN_PASSWORD`, generating and printing a password when unset/weak.
   Called from `db/seeds.rb` (run by `db:prepare` on first create), not an
   initializer — the latter runs at every boot, including `rails console`
   and asset tasks with no live database.~~
8. ~~Restream destinations: `RelayDestination` model (validation, provider
   defaults, key masking) ported from `relays.js`'s *data* half only — the
   ffmpeg process supervision half stays a data-plane concern, deferred to
   a later Go slice, same boundary the media proxy already draws.
   `Api::Admin::RelaysController` (full CRUD) and `Api::RelaysController`
   (`/relays/mine`, ownership following the source stream, not the relay
   row) with the same cross-tenant-isolation test coverage as streams. 102
   RSpec examples total now. Verified end to end against the real running
   server (create, list, key masked in the response).~~
9. ~~Channels: `Channel` model (slug generation/uniqueness, membership and
   sharing as arrays, background image as a raw-body upload written to
   `public/uploads/`, no multipart parsing) ported from `channels.js`'s
   *configuration* half — viewing a channel's live state stays out of
   scope, same data-plane boundary as everything else. A tiny `AppSetting`
   singleton for `homepage_channel_id`, since `Channel#destroy` needs to
   clear it. `Api::Admin::ChannelsController` (full CRUD + homepage
   set/clear) and `Api::ChannelsController` (`/channels/mine`, open to any
   signed-in user, not just streamer/admin — no quota, matching
   `routes/channels.js` exactly) plus `/api/streams/available`. 129 RSpec
   examples total now (was 102). Verified end to end against the real
   server: channel created with an auto-generated slug, background image
   uploaded and served back through Rails' own static file handling.~~
10. ~~`migrate_from_json.rake` now imports relay destinations and channels
    too (previously only users and streams), plus the homepage-channel
    setting. Covered by the same idempotent-re-run spec as the rest.~~
11. ~~`AppSetting.public_viewing` added (previously only
    `homepage_channel_id`) — the one other field the internal API needs to
    answer the data plane's "can an anonymous visitor watch the programme"
    question.~~
12. ~~**The actual "connect the services" step**: `Internal::StreamsController`
    (`GET /internal/:token/streams`), a read-only feed of every stream's
    data-plane-relevant fields plus `publicViewing`, gated by the same
    shared-secret-in-URL convention the Node backend's own hook uses.
    `go-service`'s new `RailsBridge` polls it every 2s and refreshes the
    same `Memory` store `JSONBridge` used to — `cmd/dataplane/main.go` now
    prefers `RAILS_INTERNAL_API_URL`/`RAILS_INTERNAL_API_TOKEN` over
    `STREAM_CONFIG_PATH` when both are set. Verified as a real integration,
    not just both services' own test suites passing independently: created
    a stream through Rails' admin API, waited for the Go service's poll,
    published to it over real RTMP through real MediaMTX and watched
    MediaMTX's own log confirm the publish was accepted; deleted the
    stream through Rails and confirmed the same key now gets a 401
    "unknown stream key" directly from the Go hook. Both services' full
    test suites (133 RSpec, all Go tests) still green together.~~
13. Not started: React frontend.

## Decisions

### 2026-08-22

- **Bug, tooling gotcha (not a code bug):** writing `relay_destination.rb`'s
  URL-validation regex as `/[\s\x00-\x1f\x7f]/` produced a file containing
  *literal* raw NUL, 0x1f and 0x7f bytes instead of the six-character Ruby
  escape sequences — invisible in a normal read/diff, confirmed only with
  `xxd`. The regex silently matched nothing useful and every "no control
  characters" test still happened to pass for unrelated reasons, which is
  what made it dangerous rather than merely broken.
- **Why it matters:** `\xHH`-style escape sequences in file content passed
  through Claude Code's Write tool can be decoded into literal bytes rather
  than staying as source text, at least in this session. POSIX bracket
  expressions (`[[:space:][:cntrl:]]`) and literal printable-range
  characters (`[!-~]` instead of `[\x21-\x7e]`) sidestep the whole class of
  mistake and read at least as clearly.
- **Impact:** rewrote the one affected method; swept the entire
  `rails-service` tree for the same byte pattern (`grep -P
  '[\x00-\x08\x0e-\x1f\x7f]'` — a comparison run purely inside the Bash
  tool, not written as file content, so the same risk does not apply there)
  and found nothing else affected. Worth a `notes.md` entry once confirmed
  a second time.

- **Decision:** passwords stay scrypt (N: 16384, r: 8, p: 1, keylen: 64),
  not switched to bcrypt/`has_secure_password`.
- **Why:** confirmed Ruby's `OpenSSL::KDF.scrypt` produces byte-for-byte
  identical output to Node's `crypto.scryptSync` for the same
  salt/password/params (cross-checked directly, pinned as a regression
  test). This makes the config.json -> Postgres migration a straight
  salt/hash copy with zero forced password resets — "no fuzz required," the
  user's own words for the migration script, extended to mean the same for
  the accounts it moves.
- **Impact:** `User#authenticate`/`.authenticate_credentials` reimplement
  auth.js's exact scheme, including its decoy-hash timing mitigation for an
  unknown username. `lib/tasks/migrate_from_json.rake` copies `salt`/`hash`
  directly via a dedicated `User.import_legacy!` that bypasses the
  plaintext-password strength validation entirely, since there is no
  plaintext at import time.

- **Decision:** sessions are DB-backed (a `sessions` table storing a
  SHA-256 digest of a random token, not the token itself), behind the same
  `sc_session` cookie name the Node backend used, rather than a stateless
  signed cookie.
- **Why:** the Node backend's stateless cookie was a deliberate "zero
  dependencies, no database" choice — moot now that Postgres exists. A real
  session table gets instant revocation (delete the row) and means a
  database leak alone cannot mint a valid session, both strictly better
  than what a signed cookie can do, for a cost (one DB lookup per request)
  that no longer matters once there is a database anyway.
- **Impact:** `Session.start_for`/`.authenticate` in `app/models/session.rb`;
  `ApplicationController#sign_in`/`#sign_out`/`#current_user`.

- **Decision:** `Stream#shared_with` is a Postgres array column, not a join
  table, matching `server/src/streams.js`'s JSON shape directly.
- **Why:** same reasoning [[feat-channels]] already used for the Node
  version's embedded `sharedWith` array over a grants collection — this is
  what makes the migration script a field-for-field copy instead of a
  reshaping. Flagged as normalizable later if it ever needs proper
  per-entry referential integrity (a GIN index currently keeps membership
  queries reasonable without it).
- **Impact:** `db/migrate/20260822000003_create_streams.rb`'s
  `t.uuid :shared_with, array: true`; validated by a custom
  `shared_with_is_sane` check against `User` rather than a foreign key.

- **Bug caught by the test suite, not manual testing:** the first version
  of `User.import_legacy!` set a bypass flag that skipped the *presence*
  check for a missing password but not the *strength* check, which then
  ran against a `nil` plaintext password (there is none, at import) and
  failed every legacy import with "Password must be at least 8 characters."
  A second bug in the same task: neither `import_legacy!` nor the stream
  half of the rake task actually upserted by id — a second run against the
  same file hit the username/`created_at` NOT NULL constraints instead of
  updating existing rows, contradicting the task's own "safe to re-run"
  doc comment. Both fixed; the "re-run against the same file" case is now
  an explicit spec, not just a claim in a comment.
- **Impact:** `app/models/user.rb`'s two separate bypass flags
  (`@password_assignment_attempted` for a fresh plaintext password vs.
  `@importing_legacy_hash` for an already-hashed one — conflating them was
  the root cause), and `lib/tasks/migrate_from_json.rake` now
  `find_or_initialize_by(id:)` for both users and streams.

- **Decision:** `Channel` owns configuration only — slug, membership,
  sharing, background image. Viewing a channel (`GET /api/channels/:slug/state`
  in the Node backend: layout computation, live/on-air status, the
  `restricted` placeholder shape for an inaccessible member stream) is not
  ported here at all.
- **Why:** that endpoint needs `layout.js`'s pure layout math plus live
  stream state from MediaMTX — neither of which the control plane has or
  should have. It is a rendering concern for whoever ends up serving actual
  viewers, which per the migration's own split is the data plane's job, not
  Rails'.
- **Impact:** no `Api::ChannelsStateController` exists yet. Whether channel
  *viewing* ends up in the Go service or stays a gap until a decision is
  made explicitly is unresolved — flagged here rather than silently
  assumed either way.

- **Decision:** `AppSetting` is a one-column singleton
  (`homepage_channel_id`), not a general settings key-value store, even
  though the Node backend's `settings` object has many more fields
  (`publicViewing`, composition config, restart backoff, ...).
- **Why:** `Channel#destroy` needs *something* to clear when it was the
  homepage channel, and building that required the smallest real thing
  that could work — porting every other setting is unrelated scope this
  channels slice does not need to unblock.
- **Impact:** `AppSetting.instance` (`first_or_create!`) is the only access
  pattern; adding a second setting later means literally adding a column,
  not redesigning anything.

### 2026-08-22 (connecting the services)

- **Bug, found immediately on first real integration attempt:** every
  request from `go-service` to Rails came back `403`, with MediaMTX/RTMP
  publishes hanging with no error. Root cause: Rails' default
  `ActionDispatch::HostAuthorization` middleware only allows
  `localhost`/`127.0.0.1`/`.local` Host headers in development, and the Go
  service calls Rails as `http://rails:3000` — its Docker Compose service
  name, not localhost. Every internal-API request was being silently
  blocked before it ever reached the controller.
- **Fix:** `config.hosts << "rails"` in `config/environments/development.rb`.
  Flagged as development-only in its own comment; a real deployment needs
  its actual hostname (or `ActionDispatch::HostAuthorization` configured
  for whatever reverse proxy fronts it) instead.
- **Impact:** the fix itself briefly introduced a syntax error (a dropped
  trailing `end` on `Rails.application.configure do` from an imprecise
  edit) — caught immediately by a plain `ruby -c` syntax check before even
  attempting to boot the container, cheaper than debugging it via a failed
  container start.
- **Separately, a manual-testing trap worth naming:** this service now has
  *two* different shared secrets that both "unlock an internal endpoint" —
  `MEDIAMTX_INTERNAL_PASSWORD` (gates `go-service`'s own
  `/internal/:token/mediamtx/auth`, called by MediaMTX) and
  `INTERNAL_API_TOKEN`/`RAILS_INTERNAL_API_TOKEN` (gates Rails'
  `/internal/:token/streams`, called by `go-service`). Manually curling
  the wrong endpoint with the wrong one of the two produces a plausible-
  looking but misleading 404, easy to misread as "the stream doesn't
  exist" rather than "wrong secret for this endpoint." Worth remembering
  which secret belongs to which direction before assuming a test result.

### 2026-08-22 (RSpec suite silently running under the wrong Rails env)

- **Bug:** every RSpec request spec started failing with a universal 403,
  regardless of endpoint — even `POST /api/auth/login` with correct
  credentials. Root cause: `docker-compose.migration.yml` bakes
  `RAILS_ENV=development` into the `rails` container (needed for the live
  service), and that env var leaks into every `docker exec ... bundle exec
  rspec` invocation. `spec/rails_helper.rb`'s `ENV["RAILS_ENV"] ||= "test"`
  only applies when unset, so the whole suite silently ran under
  `development` instead of `test` — which mostly still worked, except
  `development.rb`'s `config.hosts << "rails"` (added for the Go data
  plane to reach Rails by its Compose hostname) then blocked every
  request-spec's default `www.example.com` host via
  `ActionDispatch::HostAuthorization`, rendered as a 403 with no
  indication the environment was ever wrong. A secondary symptom
  (`ActiveRecord::ConnectionNotEstablished` against a local Postgres
  socket during `db:test:load_schema`) was a real, separate gap: the
  `test:` section of `database.yml` had no way to reach the `postgres`
  container at all.
- **Fix:** `spec/rails_helper.rb` now sets `ENV["RAILS_ENV"] = "test"`
  unconditionally (not `||=`) — specs must always run under `test`, full
  stop, regardless of the ambient environment. `config/database.yml`'s
  `test:` section gained an explicit `url: <%= ENV["TEST_DATABASE_URL"] %>`
  branch (Rails only auto-merges `DATABASE_URL` into *`Rails.env`'s own*
  section; `maintain_test_schema!` always targets the `test:` section
  specifically regardless of which env the process is actually running
  under, so it needs its own URL spelled out). `docker-compose.migration.
  yml`'s `rails` service gained `TEST_DATABASE_URL`, pointing at a
  `scmig_test` database on the same `postgres` container.
- **Why this matters beyond the immediate fix:** `||=` for `RAILS_ENV` is
  the Rails-generated default specifically so an unusual, deliberate
  override is still possible — but in a containerized dev stack where the
  same image serves both the live app and the test suite, that flexibility
  is exactly the footgun: nothing overrode it on purpose, the container's
  own baked default silently won every time, and the resulting failures
  (403 everywhere) gave no clue that the environment was ever wrong.
- **Impact:** `bundle exec rspec` now reliably passes (134 examples, 0
  failures, matching the pre-regression baseline) no matter how it's
  invoked — with or without an explicit `-e RAILS_ENV=...` override — and
  the earlier connection-noise on every run is gone too.

## Links

- Branch: `migration/go-rails-react`
- Related features: [[feat-migration-go-dataplane]] (phase 1, the sibling
  data-plane service), [[feat-channels]] (the `sharedWith`-as-array
  precedent), [[feat-streamer-role]] (the ownership/quota logic this ports)
- External: dev/test environment on the `siberian-next` Debian box
  (`ssh siberian`, `~/stream-composer/rails-service`)
