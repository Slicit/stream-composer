# react-app — frontend

Phase 3 of the Rails/Postgres/React migration (see
`LOGBOOK/features/feat-migration-react-frontend.md`). Vite + React +
TypeScript, talking to `rails-service`'s API — nothing here talks to Go or
MediaMTX directly (see `docs/ARCHITECTURE.md`'s security model: playback is
proxied, not something a frontend should reach for on its own).

No Node toolchain is required locally — everything here runs through
Docker, on the same dev box as the other two services.

## Test

```bash
docker run --rm -u $(id -u):$(id -g) -v $(pwd):/app -w /app node:20-slim npm test
```

## Run (dev stack)

```bash
docker compose -f docker-compose.migration.yml up -d --build
```

Open `http://<box>:15173`. The Vite dev server proxies `/api` straight to
Rails (`vite.config.ts`), so the browser only ever talks to one origin —
this is what keeps the `sc_session` cookie simple for local dev, with no
CORS or cross-site `SameSite` story to solve. A real deployment will need
one (either build-time env pointing at the real API origin, or a reverse
proxy putting both behind the same host).

## Layout

- `src/api/client.ts` — a thin fetch wrapper (`credentials: 'include'`,
  JSON in/out, throws `ApiError` with the server's own message).
- `src/api/types.ts` — TypeScript types matching each Rails model's
  `as_public_json` field-for-field.
- `src/auth/AuthContext.tsx` — current-user state, backed by
  `/api/auth/{login,logout,me}`.
- `src/components/ProtectedRoute.tsx` — gates a route on being signed in,
  optionally on role.
- `src/pages/LoginPage.tsx`, `src/pages/AdminUsersPage.tsx` — the one
  complete, tested vertical slice this phase ships: sign in, and full
  admin user management (list, create, change role/quota, delete, with the
  last-signed-in-account delete guard reflected in the UI).
- `src/pages/HomePage.tsx` — placeholder; the real viewer/player page does
  not exist yet.

Everything else (streams/relays/channels admin UI, the streamer and
channels self-service pages, the actual viewer/player) is not built. See
the LOGBOOK entry's Decisions for the open questions this phase intentionally
ends on rather than guessing through.
