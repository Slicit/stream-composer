---
status: shipped
branch: migration/go-rails-react
---

# Playwright e2e suite, and a self-hosted Mailpit for real SMTP testing

## Intent

Every prior "browser-verified" claim in this project relied on this
session's sandboxed Browser pane, which cannot reliably drive real
clicks against a Radix `Select` or a native `confirm()`/`alert()` dialog
(see [[feat-self-registration-2fa]]'s admin Users rebuild, which had to
fall back to component tests plus curl for exactly those two
interactions). The user separately flagged that live browser-pane
testing was slow and interrupting flow: "can you find another way to
test, it as both annoying, and very slowing me... I always accept
nonetheless, I just want fast iteration, not bottleneck browser tests,
write it for now and the future," then asked directly for a headless
option: "maybe you can also run a headless chrome container in docker or
something specifically to run visual/click tests." Finally: "go for
everything / for the SMTP you can mount yourself a small SMTP docker
image with creds to test and a mailcatch so you can run full test
suites."

This ships both: a Playwright suite (`@playwright/test`, installed
directly on the dev box, headless Chromium) that runs against the
already-running dev server rather than a container the tests manage
themselves, and a Mailpit service (`axllent/mailpit`) added to
`docker-compose.migration.yml` so registration email really sends and is
really asserted on, instead of only ever being read out of Rails logs.

## Decisions

- **Playwright runs directly on the dev box against the live dev
  server**, not inside its own Docker container hitting a container
  network address. Simpler than wiring a Playwright container into
  `scmig-net` for no real benefit: the dev server is already reachable at
  `claude-machine-03.home:15173` and already has `vite.config.ts`'s
  `server.allowedHosts` including that name for exactly this purpose.

- **`page.request`, never the standalone `request` fixture, for any
  API-based login inside a spec.** Playwright's top-level `request`
  fixture does not share cookies with `page` — using it to log in leaves
  the browser context unauthenticated even though the login call itself
  succeeded. This was already known from `admin-user-edit.spec.ts`
  earlier in the project and deliberately re-applied correctly in every
  new spec (`registration.spec.ts`, `two-factor.spec.ts`,
  `theme-switcher.spec.ts`).

- **`global-setup.ts` seeds fixed fixture accounts via `docker exec ...
  bin/rails runner`** (an argv array via `execFileSync`, never a shell
  string, so the seed script cannot be affected by shell interpretation)
  so every run starts from known state without hand setup. Added a third
  fixture, `e2e-2fa` (no 2FA pre-enabled), alongside the existing
  `e2e-admin`/`e2e-target`, specifically for specs that walk through
  self-service 2FA setup from scratch.

- **A real TOTP code, not a mock, drives the 2FA spec.** `e2e/totp.ts`
  shells out to the same `docker exec ... bin/rails runner 'ROTP::TOTP...'`
  pattern to compute a real code against the real secret returned by the
  setup endpoint, the same library the server verifies against, standing
  in for an authenticator app.

- **Found and fixed a real, previously-undiscovered SMTP bug while
  wiring Mailpit up**, not in review: `smtp_settings` in both
  `development.rb` and `production.rb` passed `authentication: :plain`
  unconditionally, which makes the `mail` gem attempt SMTP AUTH even with
  a `nil` username, raising `ArgumentError: SMTP-AUTH requested but
  missing user name` against any server that does not require auth (like
  Mailpit). Fixed by only including `user_name`/`password`/
  `authentication:` in the settings hash when `SMTP_USERNAME` is present.
  This had never been caught before because every prior verification
  pass used the `:test`-delivery fallback (no real SMTP settings ever
  actually exercised) or a provider that does require auth.

- **A container without a bind-mounted source directory needs a real
  rebuild, not just a file sync, for a change to take effect** — this
  bit the first e2e run of `two-factor.spec.ts`: syncing the new
  `data-testid="otp-secret"` in `EditProfileDialog.tsx` to the box did
  nothing until `docker compose build react && docker compose up -d
  react` actually rebuilt the image (`scmig-react`'s `Dockerfile.dev`
  does a plain `COPY . .`, no volume). `scmig-rails` has the same
  property. Proposed as a `notes.md` gotcha; see below.

## Verification

Full suite, run together (not just the files touched per change): 6
specs green — `admin-user-edit.spec.ts` (2, pre-existing), `registration.spec.ts`
(1, real SMTP round trip through Mailpit's REST API), `theme-switcher.spec.ts`
(2), `two-factor.spec.ts` (1, real QR/secret through a real generated code,
backup-codes reveal, sign-out, and the real two-step login UI including a
rejected wrong code before a correct one succeeds).

`registration.spec.ts` was live-verified against real SMTP delivery:
register through the real form, poll Mailpit's `/api/v1/messages` until
the real email lands, pull the real confirm link out of the real message
body, confirm, sign in.

`tsc -b --force` was re-verified as actually covering the new e2e files
(not just reporting clean) by expanding `tsconfig.node.json`'s `include`
to `["vite.config.ts", "playwright.config.ts", "e2e/**/*.ts"]` and then
grepping the resulting `tsconfig.node.tsbuildinfo` for the new filenames,
rather than trusting a clean exit code alone — the same class of
silent-no-op this project already got burned by once with `tsc --noEmit`
(see [[feat-self-registration-2fa]]).

330 rspec examples and the full vitest suite green alongside the new e2e
run.

## Links

- Branch: `migration/go-rails-react`
- Related features: [[feat-self-registration-2fa]] (the flows this
  suite proves, and the Radix Select / native `confirm()` limitation
  that motivated moving off the sandboxed browser pane),
  [[feat-theme-system]] (the other new spec this suite covers)
- External: [Playwright](https://playwright.dev), [Mailpit](https://github.com/axllent/mailpit)
