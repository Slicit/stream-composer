---
status: active
branch: migration/go-rails-react
---

# Migration: production build/deploy for the Go/Rails/React stack

## Intent

The last item of the original 8-item gap-fill plan, and then of its own
5-item follow-on plan (session auth, viewer page, admin/streamer/channels
CRUD, channel viewing, this) — flagged from the start as "a real decision
— reverse proxy topology — not just code," not something to guess at.
The user's own instruction settled the decision: keep Traefik, the same
way the pre-migration Node stack already uses it for TLS — re-point it at
the new three-service split instead of inventing a different approach.

## Decisions

### 2026-08-22

- **Decision:** Rails serves the built React SPA from its own `public/`
  directory (a `react-build` Docker stage copies `dist/` in at image build
  time), rather than a fourth container (nginx or similar) fronting static
  files.
- **Why:** matches this project's stated minimalism (`docs/ARCHITECTURE.md`'s
  "one runtime dependency" framing for the original Node app) — one fewer
  moving part, one fewer thing to route through Traefik, and it is exactly
  the same origin as the API, so `sc_session` never becomes a cross-site
  cookie in production the way it would if the SPA were served from
  somewhere else. A new `PagesController#app` plus a trailing
  `get "*path"`/`root` route (declared last, so every `/api`, `/internal`
  and `/up` route above still wins) serves `index.html` for any client-side
  route, so a hard refresh on `/admin/streams` or `/c/some-channel` works.
- **Impact:** `rails-service/Dockerfile` replaces the stock
  `rails new`-generated one (Kamal/Thruster-oriented, never wired into any
  compose file — confirmed via git log that nothing ever referenced it).
  A checked-in `public/index.html` placeholder (overwritten by the real
  build in the image) keeps `PagesController` testable in dev/test, where
  React isn't built.

- **Decision:** one domain fronts two backends, split by path rather than
  by subdomain — `rails` gets everything by default, a higher-priority
  router pair (`dataplane-state`, `dataplane-mtx`) carries only
  `GET /api/state`, `GET /api/channels/:slug/state`, and `/mtx/*` to the
  Go data plane.
- **Why:** matches the dev-server Vite proxy's own split (`vite.config.ts`)
  exactly, for the same reason — those are the only paths that are
  actually the Go service's, and `/api/channels/:slug/state` needs a
  regex rule (`PathRegexp`), not a plain prefix, because a prefix on
  `/api/channels` would also catch `/api/channels/mine` (self-service
  CRUD, which belongs to Rails).
- **Impact:** `docker-compose.go-rails-react.tls.yml`'s Traefik labels are
  the production mirror of `vite.config.ts`'s dev-time routing — a change
  to one almost certainly needs the same change in the other.

- **Decision:** `/internal/*` on both services gets no Traefik router at
  all — not "gated," simply absent.
- **Why:** it is the shared-secret channel the two services already use
  directly over the container network (`http://rails:3000/internal/...`,
  `http://dataplane:8080/internal/.../mediamtx/auth`), and must never be
  reachable from outside it — the same posture this endpoint has had
  since the very first Go phase. The `rails` router's rule additionally
  excludes it explicitly (`&& !PathPrefix(\`/internal\`)`) as defense in
  depth, even though no other router would ever match it either.
- **Impact:** none of this needed new code — only compose/Traefik
  configuration, since the endpoints' own access story (shared secret in
  the URL) was already correct from the first Go phase onward.

- **Finding, not a decision:** `docker compose config`/`--format json`
  re-escapes a literal `$` inside a label value to `$$` when redisplaying
  it, which looks exactly like a real interpolation bug in a Traefik
  `PathRegexp` rule (`^/api/channels/[^/]+/state$`). It is not — a
  throwaway busybox container (started, inspected, torn down) confirmed
  the actual applied label carries a single, correct `$`. Recorded so a
  future reader doesn't "fix" this into an actual bug based on `config`'s
  own display output.

- **Finding, not a decision:** two real, latent production bugs, found
  only by actually building the images and bringing the base stack up
  (no `config`-only check would have caught either):
  - `database.yml`'s `production:` section was still the Rails-generated
    primary/cache/queue multi-database template — unused, since this app
    has neither Solid Cache nor Solid Queue configured — which silently
    ignores `DATABASE_URL` in favor of a hardcoded username/database and
    no host, falling back to a local Unix socket that does not exist
    inside a container. Replaced with a single `url: <%= ENV[
    "DATABASE_URL"] %>` section, matching development/test's own shape.
  - `config.hosts`, set to just the public `DOMAIN`, blocked the Go data
    plane's own calls to `http://rails:3000` (its Compose service name,
    not the public domain) with a 403 — the exact same class of problem
    `development.rb` already had to solve once (`config.hosts << "rails"`,
    for the same reason), needed again here since `production.rb`'s hosts
    list doesn't inherit development's.
  Both fixed; 154 RSpec examples, 0 failures, unaffected by either.

## Verification

Built both production images for real (`docker compose build`, not just
`config`), then brought the base stack (`postgres`, `mediamtx`, `rails`,
`dataplane` — no TLS overlay, so no host ports touched at all, to avoid
any conflict with the already-running dev migration stack or anything
else on this shared box) up with the real `RAILS_MASTER_KEY` from
`rails-service/config/master.key` and confirmed, from other containers on
the same network (a `Host` header matching `DOMAIN` simulates what
Traefik actually forwards): `/`, `/api/auth/me`, and an SPA client-side
route all return 200; the data plane connects to Rails cleanly on a fresh
boot with no retry/backoff needed; `GET /healthz` on the data plane
responds. Full stack (including volumes) torn down afterward; confirmed
the dev migration stack (`scmig-*` containers) was never touched.

Not verified: an actual end-to-end run through the TLS overlay itself
(real Traefik + a real or staging Let's Encrypt certificate + real DNS)
— that needs a real domain pointed at a real reachable host, which this
dev box is not. The compose file itself, its required-variable guards,
and the path-based routing rules are all validated as above; the ACME
flow specifically is the one piece that can only be proven by an actual
deployment.

## Links

- Branch: `migration/go-rails-react`
- Related features: [[feat-migration-go-dataplane]],
  [[feat-migration-rails-control-plane]], [[feat-migration-react-frontend]]
- Related docs: `docs/ARCHITECTURE.md` ("Security model"), the
  pre-migration `docker-compose.tls.yml` this overlay's Traefik
  configuration mirrors
