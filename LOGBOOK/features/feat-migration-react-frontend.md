---
status: active
branch: migration/go-rails-react
---

# Migration phase 3: React frontend

## Intent

Third phase of the migration (see [[feat-migration-go-dataplane]] and
[[feat-migration-rails-control-plane]] for phases 1-2). Scaffolded with
`npm create vite@latest . -- --template react-ts`, on the same Debian dev
box as the other two phases (no Node toolchain on the Windows laptop
either — same "author locally, sync/test remotely" loop).

Ships one complete, tested vertical slice — sign in, and full admin user
management — rather than a broad, shallow pass over every screen the
vanilla app has. The rest is intentionally left as open questions (below)
instead of guessed through, per the user's own instruction for this phase.

## Plan

1. ~~Scaffold: Vite + React 19 + TypeScript, React Router, Vitest +
   Testing Library. `vite.config.ts` proxies `/api` to Rails so the
   browser only ever talks to one origin in dev — no CORS/SameSite story
   to solve for `sc_session` locally.~~
2. ~~`src/api/client.ts` + `src/api/types.ts`: a thin fetch wrapper
   (`credentials: 'include'`, throws `ApiError` with the server's own
   message) and TypeScript types matching each Rails model's
   `as_public_json` field-for-field.~~
3. ~~`src/auth/AuthContext.tsx` + `ProtectedRoute`: current-user state
   backed by `/api/auth/{login,logout,me}`, route gating by session and
   role.~~
4. ~~`LoginPage` and `AdminUsersPage` (list, create, change role/quota
   inline, delete with the last-signed-in-account guard reflected in the
   UI, not just enforced server-side) — the one complete slice. 9 Vitest
   component tests (mocked `fetch`, real component/DOM behavior). `tsc -b`
   and `vite build` both clean.~~
5. ~~Verified in an actual browser (Claude's Browser pane, not just a
   headless test run): opened the real dev server, signed in as the real
   bootstrap admin, watched the user table render real data from Postgres
   through Rails through the Vite proxy, created a real user through the
   UI and watched it appear without a page reload.~~
6. ~~**Design system answered**: shadcn/ui (Radix + Tailwind CSS v3, the
   classic `shadcn@2.3.0` CLI — the newer `shadcn@4.x` targets Next.js/
   Tailwind v4 by default and its interactive preset picker did not fit
   this non-interactive box workflow; `2.3.0` is the well-documented
   "new-york style + CSS variables" flow everything else assumes).
   `src/index.css`'s theme tokens are the vanilla app's
   `server/public/assets/style.css` `:root` palette converted hex -> HSL
   triple, not a new palette — background, card, primary (accent blue),
   destructive (critical red), border and muted-foreground all confirmed
   against a real running instance via computed styles (`rgb(26,26,26)`
   card, `rgb(56,134,229)` primary button — both within 1 unit of the
   source hex, i.e. imperceptible). `LoginPage`, `AdminUsersPage`,
   `NavBar` rebuilt on `Button`/`Input`/`Label`/`Card`/`Table`/`Select`.
   Radix's `Select` needs `hasPointerCapture`/`scrollIntoView` stubs to
   run in jsdom at all (`src/setupTests.ts`) — without them every test
   that opens one throws before asserting anything; a new test exercises
   an actual Select open/select/close cycle to prove the stubs work, not
   just that the page renders. 10 Vitest tests (was 9), `tsc -b` and
   `vite build` both clean, re-verified live in a real browser.~~
7. Not started, and not guessed at: everything below "Open questions"
   other than design system (now resolved, see above).

## Open questions for this phase

Named explicitly per the user's own instruction ("leave open questions for
the react app just after") rather than assumed one way and possibly
rebuilt later. Whoever picks this phase back up should get an answer to
these before building further, not infer one from what already exists:

- **How much of the vanilla app does React actually replace, and on what
  timeline?** The existing `server/public/*.html` + vanilla JS
  (`app.js`/`admin.js`/`streamer.js`/`channels.js`) is a fully working,
  shipped product today. Does this migration run the two side by side
  until React has full parity, or is there a cutover point per surface
  (e.g., admin first, viewer last)? This affects almost every other
  question below.
- ~~**Design system**~~ — answered 2026-08-22: shadcn/ui, themed from the
  vanilla app's own palette. See the Plan and Decisions.
- **How does the viewer/player page work in React at all?** This is the
  single biggest gap. The vanilla app's `app.js` does WHEP session
  negotiation directly against the Go data plane's media proxy
  (`/mtx/webrtc`, `/mtx/hls` — see `go-service/internal/mediaproxy`) with
  substantial client-side logic (web-composed grid layout, per-tile stats,
  audio-source picking, HLS fallback). None of that has an owner in the
  React app yet, and it is not a small port — it is most of the vanilla
  frontend's actual complexity. Does React reimplement all of it, wrap the
  existing vanilla JS as an escape hatch, or does the player stay
  server-rendered/vanilla indefinitely while React only owns admin/CRUD
  surfaces?
- **Build/deploy target.** This phase only has a Vite *dev* server
  (`Dockerfile.dev`, `npm run dev`). There is no production Dockerfile,
  no decision on static hosting vs. SSR, and no decision on how the built
  assets reach users relative to Rails and the Traefik-fronted deployment
  `docker-compose.yml` already describes for the current (pre-migration)
  stack.
- **Auth in production, not just local dev.** The dev proxy trick (Vite
  proxies `/api`, so the browser only ever sees one origin) only works
  because Vite's dev server sits in front of Rails. A production build
  serves static files from *somewhere* — if that somewhere is not behind
  the same reverse-proxy origin as Rails, `sc_session` becomes a
  cross-site cookie and needs `SameSite`/CORS decisions this phase never
  had to make.
- **Testing strategy beyond component tests.** 9 Vitest tests cover one
  slice with mocked `fetch`. Is an integration/e2e layer wanted (Playwright
  against the real dev stack, the way the Go/Rails phases used real
  MediaMTX/Postgres for their own end-to-end checks), or does component
  testing with mocked API responses stay the standard for this codebase?
- **Everything else not built yet**, concretely: streams/relays/channels
  admin UI, the streamer role's self-service pages
  (`/streams/mine`, `/relays/mine`), the channels self-service page
  (`/channels/mine`, including the background-image upload), admin
  settings. Now unblocked — straightforward extensions of the
  `AdminUsersPage` pattern on the shadcn components already in
  `src/components/ui/` — but still deliberately not started in this
  session, to keep this a reviewable slice rather than five more screens
  at once.

## Decisions

### 2026-08-22 (shadcn theme)

- **Decision:** pinned to `shadcn@2.3.0` (the CLI package's own version,
  not a component version) rather than the `@latest` (4.19.0 at the time).
- **Why:** 4.x's `init` defaults to a Next.js template and an interactive,
  arrow-key preset picker (Nova/Vega/Maia/...) bundling opinionated
  font/icon choices — there is no scriptable way to say "just Tailwind CSS
  variables I will set myself," and Ink-style arrow-key prompts cannot be
  driven by piped stdin the way this box's non-interactive workflow needs.
  `2.3.0` is the classic flow (style/base-color/CSS-variables prompts,
  all answerable via `-y -d -f`) virtually every existing shadcn tutorial
  and this session's own knowledge assumes.
- **Impact:** Tailwind CSS v3 (not v4) — `2.3.0` detects Tailwind via
  `tailwind.config.js`, which v4's CSS-only configuration doesn't produce.
  Not a real limitation for a project this size; revisit only if a
  concrete v4 feature is needed later.

- **Decision:** the theme is the vanilla app's existing palette, converted,
  not a new one.
- **Why:** the user's explicit instruction — "craft a theme that matches
  application before migration." `server/public/assets/style.css`'s
  `:root` block already encodes real design decisions (the reserved
  status-color palette, the specific blue, the neutral-warm grays);
  redoing that from scratch would be inventing a second product identity
  mid-migration for no reason.
- **Impact:** every hex value in the source `:root` was converted to HSL
  by hand and mapped onto shadcn's token names (`--background` <-
  `--plane`, `--primary` <- `--accent`, `--destructive` <- `--critical`,
  etc. — see `src/index.css`'s inline comments for the full mapping).
  Verified against a live instance, not just by eye: computed
  `backgroundColor`/`color` on real rendered elements came back within 1
  RGB unit of the source hex values.

## Links

- Branch: `migration/go-rails-react`
- Related features: [[feat-migration-go-dataplane]],
  [[feat-migration-rails-control-plane]]
- External: dev/test environment on the `siberian-next` Debian box
  (`ssh siberian`, `~/stream-composer/react-app`)
