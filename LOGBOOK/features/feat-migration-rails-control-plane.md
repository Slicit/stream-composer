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
7. Not yet started: channels, restream destinations, admin settings, the
   bootstrap-admin flow (`ADMIN_USER`/`ADMIN_PASSWORD` env vars in the Node
   backend — nothing seeds a first admin yet, see the README's manual
   workaround).
8. Not started: wiring the Go data plane's `streamstore.Store` to a real
   Rails internal API client (see phase 1's plan item 7 — the actual
   "connect the services" step).
9. Not started: React frontend.

## Decisions

### 2026-08-22

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

## Links

- Branch: `migration/go-rails-react`
- Related features: [[feat-migration-go-dataplane]] (phase 1, the sibling
  data-plane service), [[feat-channels]] (the `sharedWith`-as-array
  precedent), [[feat-streamer-role]] (the ownership/quota logic this ports)
- External: dev/test environment on the `siberian-next` Debian box
  (`ssh siberian`, `~/stream-composer/rails-service`)
