---
status: shipped
branch: feat-channels
---

# Channels: public/private streams, curated channels, access grants

## Intent

Every enabled stream is currently visible to whoever passes the single
global `settings.publicViewing` gate, with no per-stream visibility and no
way to show a curated subset of streams under its own URL. This adds
per-stream visibility (public/private), a "channel" concept (a named,
sluggable, curated stream list any logged-in user can build and share),
an optional homepage channel, access grants for private streams and
channels, a background-image upload for channels, an `update.sh` script,
and a per-tile stats overlay replacing the single aggregate readout in
browser-composed mode.

Full design in the approved plan: see the Decisions log below for the key
choices and their reasoning; the plan itself was written to
`C:\Users\conta\.claude\plans\misty-plotting-crayon.md` during planning.

## Plan

1. ~~Data model: `store.js` defaults/backfill (`channels: []`,
   `settings.homepageChannelId`, `stream.visibility`/`stream.sharedWith`).~~
2. ~~`streams.js`: visibility + sharedWith fields, validated in `update()`.~~
3. ~~New `access.js`: shared `canAccess(resource, user)` for streams and
   channels.~~
4. ~~New `channels.js`: CRUD, slug generation/uniqueness, homepage
   set/clear-on-delete, background image file cleanup.~~
5. ~~`proxy.js`: thread `req.user` into `resolvePlayback`/`resolveStream` so
   the media proxy itself enforces stream visibility, not just the API
   layer.~~
6. ~~`requireChannelAccess` middleware — ended up in `channels.js`, not
   `auth.js` as planned (auth.js would have had to require channels.js,
   which already requires auth.js for `findById`; moving it avoided the
   cycle).~~
7. ~~New `routes/channels.js`: channel-scoped viewer state, available-streams
   pool, owner-scoped "my channels" CRUD, background upload
   (`express.raw`, no new dependency).~~
8. ~~`routes/admin.js`: stream visibility/sharedWith patch, channels admin
   CRUD (moderation), homepage set/clear.~~
9. ~~`index.js`: homepage redirect, `/c/:slug` route, static mount for
   uploaded backgrounds.~~
10. ~~Client (`app.js`): channel-mode bootstrap, restricted-tile
    placeholders, hide/show toggle with localStorage persistence, per-tile
    stats overlay (preserving the existing bottom-right aggregate).~~
11. ~~New `channels.html` + `assets/channels.js`: "my channels" management
    UI for logged-in users.~~
12. ~~`admin.js`/`admin.html`: channels tab, per-stream access UI, stream
    visibility field. (Admin's own channel-create form has no stream
    picker, unlike `/channels`'s — logged as a candidate.)~~
13. ~~`update.sh` (thin wrapper around `install.sh --yes`), `Makefile`
    `update` target, `release.yml` bundle file list.~~
14. ~~Tests: visibility/backfill, channel CRUD + slug handling, `access.js`
    truth table, proxy denial/allow for private streams, channel-state API
    restricted-entry shape. 109/109 passing.~~
15. ~~Docs: `docs/ARCHITECTURE.md` gets a new section, plus a callout in
    "Storage" about the private-by-default backfill being an intentional
    behaviour change on upgrade, not just a safe default for new streams.~~

## Decisions

### 2026-08-21

- **Decision:** channels are browser-composed only — no new server-side
  encoder per channel.
- **Why:** the existing "web mode" (`planLayout()` + per-source WHEP) already
  does client-side compositing at zero server CPU cost. Giving every channel
  its own ffmpeg encoder (true parity with today's single server-composed
  programme, multiplied) would mean real CPU cost per simultaneously-watched
  channel — directly against the project's stated CPU-first design, and a
  much larger, riskier build (dynamic encoder pool, per-channel MediaMTX
  paths, per-channel HLS). Confirmed with the user before planning.
- **Impact:** any number of user-created channels cost nothing extra to
  host. No HLS fallback for a channel as a whole (individual sources still
  fall back to HLS per-tile, as today).

- **Decision:** private-channel visibility is owner + admins + explicitly
  granted users (not "any logged-in user with the slug").
- **Why:** confirmed with the user — a private channel is meant to be
  actually restricted, not just "logged in required."
- **Impact:** channels need their own `sharedWith` list, same shape as a
  stream's, checked by the same `access.canAccess()` helper.

- **Decision:** access grants are embedded directly on the resource
  (`stream.sharedWith` / `channel.sharedWith`, arrays of user ids) rather
  than a separate grants/junction collection.
- **Why:** matches the existing codebase pattern (`relays.js` embeds
  `streamId` directly rather than a join table); avoids a whole new module
  for what is, in practice, a small array per resource in a JSON-file store
  with a handful of records.
- **Impact:** no new "grants" collection in `store.js`; access checks are a
  single shared function (`access.js`) called from both the proxy and the
  channel-state API.

- **Decision:** the media proxy (`proxy.js`) is the enforcement point for
  stream-visibility access control, not just the higher-level channel-state
  API.
- **Why:** `docs/ARCHITECTURE.md`'s own security model states the proxy is
  "the one place access is decided." If only the channel-state API filtered
  private streams, a private stream's opaque playback id — once delivered
  to any authorized viewer inside a channel payload — would still be
  directly fetchable by anyone who obtained it, since `resolvePlayback` had
  no concept of *who* was asking.
- **Impact:** `resolvePlayback`/`resolveStream` now take a `user` parameter;
  `mount()`'s guard already attaches `req.user`, so this is a parameter
  thread-through, not a new guard. Existing SECURITY tests for the proxy
  are unaffected; new ones cover the private-stream case.

- **Decision:** background image is a real file upload, implemented via
  `express.raw({ type: 'image/*' })` reading the PUT body directly — no
  multipart parsing, no new dependency (e.g. no `multer`).
- **Why:** the user chose file upload over a URL field, but this codebase's
  stated design explicitly values staying at one runtime dependency
  (`docs/ARCHITECTURE.md`, "Choices worth knowing about"). `express.raw()`
  is already part of the one dependency this project has, and a
  single-file image upload doesn't need multipart form parsing at all if
  the client just PUTs the file body directly with its `Content-Type`.
- **Impact:** stored under a new `config.channelBackgroundsDir`
  (`/data/channel-backgrounds`), served via a new `express.static` mount;
  cleaned up on channel delete, same pattern as `streams.remove()` cleaning
  up relays.

- **Decision:** the homepage is a redirect (`GET /` → 302 →
  `GET /c/<slug>`), not a separate rendering path.
- **Why:** reuses 100% of the channel-viewing code (auth gate, state
  endpoint, client rendering) instead of duplicating it for `/`. When no
  homepage channel is configured, `/` is completely unchanged from today —
  full backward compatibility for existing deployments upgrading without
  touching channels at all.
- **Impact:** `index.js` gets a homepage-check handler ahead of the
  existing `/` handler, falling through via `next()` when unset or stale.

### 2026-08-22

- **Decision:** an existing stream backfills to `visibility: 'private'` on
  upgrade, not `'public'` — even though this is a real, visible behaviour
  change for a deployment that relied on every enabled stream being
  reachable through the classic browser-composed grid.
- **Why:** the alternative (backfill to public) is the "safe" choice for
  not surprising an existing deployment, but it directly contradicts the
  feature's own first requirement — "streams can be public/private, they
  default on private." Private-by-default has to mean private by default
  for every stream, not just newly created ones, or the setting is not
  really the default at all.
- **Impact:** documented prominently (`docs/ARCHITECTURE.md`, "Storage")
  with the fix an operator needs (Admin → Streams → Make public, or grant
  specific users) — flagged to the user directly when this shipped, not
  left to be discovered as a surprise after upgrading.

- **Decision:** hide/show for restricted tiles is a server-recomputed
  query param (`?hideRestricted=1`) on the channel-state endpoint, not a
  client-side layout patch.
- **Why:** the grid layout itself is computed server-side
  (`layout.js`'s `computeLayout()`), the same one every browser-composed
  grid uses. Reimplementing that math client-side to reflow around hidden
  tiles would risk drifting from the server's version; asking the server
  to compute the layout for a smaller on-air count instead reuses the
  exact same code path with zero duplication.
- **Impact:** `routes/channels.js`'s state handler takes `hideRestricted`
  as a query flag; the client just refetches on toggle rather than doing
  any layout math itself.

### 2026-08-22 (ship)

- **Decision:** shipped as commit `1317b9c` on `main`, tagged `v1.3.0`.
- **Why:** full test suite green (109/109), manually verified end-to-end
  against the local dev server (channel creation, viewing, homepage
  redirect, restricted-stream placeholder for both anonymous and granted
  viewers, background image upload round-trip).
- **Impact:** live in the `v1.3.0` release. See `LOGBOOK/candidates.md`
  (2026-08-22 entries) for what was deliberately left out: a stream picker
  on the admin channel-creation form, and a "link-only" visibility tier
  for channels.

### 2026-08-22 (post-ship fix)

- **Bug (reported by the user on their live deployment, minutes after
  v1.3.0 went out):** a public channel's public stream never connected —
  metadata (caption, audio-monitor entry) rendered fine, but the video
  never came up, "0 of 1 connected."
- **Root cause, found by tracing the actual request path rather than
  guessing:** `proxy.mount(app, auth.requireViewAccessApi)` in `index.js`
  put a blanket "signed in, or the site-wide publicViewing setting is on"
  guard in front of *every* WHEP/HLS request, unconditionally, before
  `resolvePlayback` ever ran. That guard predates this feature and has no
  concept of a stream's or channel's own visibility — so an anonymous
  viewer of a public channel's public stream was 401'd by the guard before
  ever reaching the check that should have admitted them. Two separate
  access systems were stacked in series (global session gate, then
  per-resource visibility) instead of one replacing the other.
- **A second, smaller issue found in the same pass:** `resolveStream` in
  the same file also still checked the *global* `showIndividualStreams` +
  `composition.mode` setting — a presentation choice for the classic
  view's "strip of previews behind the programme," unrelated to channels —
  which would have broken every channel's video too, for any operator who
  had that setting turned off, independent of the bug above.
- **Fix:** access is now decided exactly once, inside
  `resolvePlayback`/`resolveStream` itself. The composed programme (which
  has no visibility of its own) keeps the original publicViewing-or-signed-in
  rule, moved into `resolvePlayback`'s `PUBLIC_PROGRAM` branch. Individual
  streams rely solely on `access.canAccess`. `showIndividualStreams` moved
  to where it actually belongs — `routes/api.js` now omits `path`/
  `audioPath` from the classic view's own JSON when that setting says to
  hide them, instead of the proxy refusing the request. The now-redundant
  `auth.requireViewAccessApi` was deleted (zero remaining callers).
- **Why this got through initial testing:** every test that exercised the
  proxy did so as the signed-in admin (`call()`'s default cookie) or
  against a stream/channel where the difference did not surface. Nothing
  exercised the exact combination the user hit: *anonymous* request,
  *public* stream, *default* (false) site-wide publicViewing. New
  SECURITY tests cover that combination directly, plus the programme's own
  narrower rule, so this class of regression fails CI next time.
- **Impact:** `server/src/auth.js`, `index.js`, `proxy.js`, `routes/api.js`,
  plus two new SECURITY tests and one rewritten test. Shipped as `v1.3.1`.

## Links

- Branch: `feat-channels` (trunk-based repo; work lands on `main`)
- PR: TBD
- Related ideas: none
- Related features: none
- External: none
