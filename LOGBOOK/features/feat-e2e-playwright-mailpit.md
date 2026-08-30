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

### 2026-08-30 (wiring the suite into `ci-go-rails-react.yml`)

- **Found and fixed a real, previously-broken CI gap, not hypothetical:**
  the `rails` CI job has never had a `RAILS_MASTER_KEY`, so every spec
  touching `otp_secret` has been failing in actual CI since the 2FA
  feature shipped — confirmed by simulating a clean CI checkout (fresh
  clone, no `config/master.key`) in a throwaway container: 18 of 330
  examples failed with `ActiveRecord::Encryption::Errors::Configuration`.
  Not caught earlier because this session's own verification always ran
  on the dev box, which has the real key.

- **Decision: CI gets fixed, disposable encryption keys, never the real
  master key.** `test.rb` now sets `config.active_record.encryption.*` to
  hardcoded insecure values unconditionally; `development.rb` sets the
  same, gated on `ENV["CI"]` so a real development box (which does have
  the real key) is unaffected. Confirmed the real master key is never
  needed at all in either environment: Rails' `require_master_key`
  defaults to false, so a missing key with `credentials.yml.enc` present
  (tracked in git) makes `Rails.application.credentials` read as empty
  rather than raise — the only actual failure was
  `ActiveRecord::Encryption` demanding its own config be present.
  Verified directly, not assumed: a throwaway container built from a
  fresh checkout, in both `test` and `development` RAILS_ENV, with no
  master key file anywhere, booted cleanly and successfully
  encrypted/decrypted a real `otp_secret` round-trip.
- **Why not the real key as a GitHub secret (the simpler alternative):**
  asked the user directly rather than picking either unilaterally, since
  it's a security-relevant CI decision this project's own convention
  flags as needing a documented reason. Chosen because it means the real
  master key never touches GitHub's secret store at all — CI data is
  fully disposable, so there's nothing to lose by using throwaway keys
  instead of duplicating the real one into a second location.

- **The e2e job in CI runs the same `docker-compose.migration.yml` used
  on the dev box**, built fresh from the checkout (`docker compose up -d
  --build`), rather than GitHub Actions' `services:` container pattern
  the `rails` job uses — that pattern publishes containers straight onto
  the runner's network under `localhost`, which doesn't give
  `global-setup.ts`/`totp.ts` the named `scmig-rails` container their
  `docker exec` calls require. The compose approach reuses the exact
  same container names as local dev, so nothing in the spec files needed
  to change for CI at all.

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
