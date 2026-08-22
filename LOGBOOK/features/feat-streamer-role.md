---
status: shipped
branch: feat-streamer-role
---

# Streamer role: self-service streams and restream, under a quota

## Intent

A third role, `streamer`, alongside `admin`/`viewer`. Created by an admin,
never self-registered. An admin sets how many streams a streamer account may
add. A streamer self-registers their own streams within that quota, manages
each one's key (rotate only, never set) and private/public visibility, and
manages restream destinations for their own streams only.

Requested verbatim: "A streamer must be created by an admin / An admin can
configure the number of streams a streamer can add/configure / A streamer
can self-register his own streams, and manage his key, private/public / A
streamer can also access Restream and manage his OWN streams and his OWN
restream."

Designed as a direct analogy to the already-shipped channels ownership model
([[feat-channels]]): `stream.ownerId` mirrors `channel.ownerId`,
`access.requireOwner` is reused unchanged, `/streams/mine` and `/relays/mine`
follow the exact `/channels/mine` convention.

Same session also carried a large, separately-requested simplification of
the viewer page: the Programme/Layout/Sources/Audio-monitor sidebar cards
and the cinema/normal view-mode toggle were removed entirely, since every
control the sidebar used to hold now lives in the player overlay. That work
has no security surface and is not itself tracked as a LOGBOOK feature, but
touched the same files this entry lists.

## Plan

1. ~~`auth.js`: `ROLES` gains `'streamer'`; `user.streamQuota` (default 0,
   clamped 0-1000); `setStreamQuota()`; `requireStreamerOrAdmin` middleware.~~
2. ~~`access.js`: new `requireOwner(resource, user)`, generalized out of
   `routes/channels.js`'s previously-inline `ownedOrAdmin()` (now deleted;
   both routers share the one helper).~~
3. ~~`streams.js`: `ownerId` field on create/update, validated against
   `auth.findById`.~~
4. ~~`store.js`: backfill `stream.ownerId = null` and
   `user.streamQuota = 0` for pre-existing records.~~
5. ~~New `routes/streamer.js`: `/streams/mine` and `/relays/mine`, each its
   own path-scoped sub-router (see Decisions — this took two attempts).~~
6. ~~`routes/admin.js`: `PATCH /users/:id` accepts `streamQuota`; `POST
   /users` already forwarded arbitrary body fields, so `role: 'streamer'`
   and `streamQuota` needed no extra code there.~~
7. ~~`index.js`: mount the streamer router; `/streamer` page route,
   redirecting anyone who is not a streamer or admin.~~
8. ~~`admin.html`/`admin.js`: role selector gains `streamer`; a quota field
   that only appears for that role; a quota column in the users table.~~
9. ~~New `streamer.html` + `assets/streamer.js`: self-service page,
   deliberately its own file rather than sharing code with `admin.js` (same
   precedent `channels.js` already set against `admin.js`) — streams table
   and restream form/table adapted from admin.js's rendering, pointed at the
   `/mine` endpoints instead.~~
10. ~~`app.js`: "My streams" link in the header for streamer/admin, next to
    the existing "My channels" link.~~
11. ~~Tests: role/quota validation and backfill, quota enforcement (at the
    boundary, and admin bypass), cross-tenant isolation for both streams and
    relays, viewer-role exclusion, the `/streamer` page route per role, and
    a regression test for the routing bug below. 120/120 passing.~~
12. ~~Docs: `docs/ARCHITECTURE.md` gets a "Streamer role" section;
    `docs/CONFIGURATION.md`'s Users section gains the third role, and its
    "viewer's own settings" section is rewritten for the removed cinema
    toggle.~~

## Decisions

### 2026-08-22

- **Decision:** a streamer's self-service PATCH allowlists
  `name`/`nickname`/`visibility`/`enabled`/`note` only. `sharedWith`,
  `ownerId` and `key` are not accepted through `/streams/mine`.
- **Why:** `sharedWith` needs a full user picker, which is admin UI a
  non-admin has no business seeing (the same reasoning already logged for
  channels — see `LOGBOOK/candidates.md`, "Admin's own 'Add a channel' form
  has no stream picker"). `ownerId` reassignment and arbitrary key-setting
  are moderation actions, not self-service ones.
- **Impact:** a streamer rotates their key via a dedicated
  `POST /streams/mine/:id/rotate-key` instead; ownership reassignment stays
  admin-only via `/api/admin/streams`.

- **Decision:** quota is enforced only at stream-creation time, and an admin
  calling `/streams/mine` is never quota-limited, regardless of their own
  `streamQuota` value.
- **Why:** a quota is a constraint an admin places on *other* accounts, not
  a ceiling that should apply to themselves through a side door they happen
  to also have access to.
- **Impact:** `POST /streams/mine`'s quota check is skipped entirely when
  `req.user.role === 'admin'`.

- **Bug, found by running the full suite before shipping (not by manual
  testing, which never exercised a plain-viewer or anonymous session against
  `/api/state` in the same pass as this feature):** the first version of
  `routes/streamer.js` put `router.use(auth.requireStreamerOrAdmin)` at the
  top of the router mounted via `app.use('/api', require('./routes/streamer'))`.
  Since that `.use()` carried no path of its own, it ran for *every* request
  reaching the router, not just the `/streams/mine` and `/relays/mine`
  routes actually defined in it. A plain viewer's `GET /api/state` came back
  403, and an anonymous request came back 401, both from a file that has no
  route for `/state` at all — two of `npm test`'s existing tests failed
  immediately.
- **Root cause:** identical bug shape to the `v1.3.0` → `v1.3.1` incident
  logged in [[feat-channels]] (a blanket guard stacked in front of, or in
  this case straddling, unrelated routes), except the earlier one was an
  *old* guard breaking a *new* per-resource check, and this one is a *new*
  guard breaking *old*, unrelated routes. Same underlying mistake: a bare
  `router.use(guard)` is scoped to wherever the *router* is mounted, not to
  the specific paths the guard is meant to protect.
- **Fix:** restructured into two path-scoped sub-routers, `streamsMine` and
  `relaysMine`, each carrying its own `.use(auth.requireStreamerOrAdmin)`
  but mounted at `router.use('/streams/mine', streamsMine)` and
  `router.use('/relays/mine', relaysMine)` respectively — the exact pattern
  `routes/channels.js`'s own `/channels/mine` sub-router already
  established for the identical situation, which I did not check against
  before writing the first version.
- **Verified by deliberately reintroducing the bug**, confirming the new
  regression test (`SECURITY: the streamer guard does not leak onto
  /api/state or /api/admin/*`) fails against it, then restoring the fix and
  confirming the full suite passes again.
- **Impact:** `server/src/routes/streamer.js` rewritten; one new test.
  Logged as a candidate for `notes.md` (see `LOGBOOK/candidates.md`,
  2026-08-22) since this is now the second independent time this exact
  mistake shape has shipped in this codebase.

## Links

- Branch: `feat-streamer-role` (trunk-based repo; work lands on `main`)
- PR: TBD
- Related ideas: none
- Related features: [[feat-channels]] (ownership/access pattern this
  directly reuses)
- External: none
