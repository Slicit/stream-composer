---
status: shipped
branch: migration/go-rails-react
---

# Self-registration, email confirmation, TOTP 2FA, and full admin Users page

## Intent

Every account up to this point was admin-created — there was no way for
someone to sign themselves up. This adds a public registration flow
(username/email/password → a confirmation email → sign-in), self-service
TOTP two-factor authentication, an admin override to force-reset a
locked-out user's 2FA, and rebuilds the admin Users page from a single
inline-editable table into a list page plus a full per-user edit page
(role/quota, password reset, avatar upload, 2FA reset).

Requested verbatim: "Admin user should not have any quota he has
compositor now in the users list / We will add a user self-registration
flow / with email, 2fa, email confirmation, the basics / By default
self-registered users are only viewers, and can only view public
channels, nothing else / Improve the crud page for users, with full edit
page, including avatar, reset 2fa (admin can override reset 2fa to unlock
a user, user can self serve)."

Confirmed scope, up front: email is nullable overall, required only for
the self-registration flow — admin-created accounts (including the
bootstrap admin) keep no email, no migration/backfill. 2FA is optional and
self-service, never mandatory at signup. SMTP is env-driven with a
`:test`-delivery dev fallback, not tied to a specific provider.

## Decisions

- **"Self-registered viewers can only see public channels" needed zero
  new access-control code.** `Channel#visibility` + the `Accessible`
  concern (Rails) / `internal/access` package (Go) already gate every
  listing and the actual WHEP media-playback path on
  public/owner/shared_with/admin, with anonymous (nil user) already
  handled. A fresh self-registered account owns nothing and is shared
  with nothing, so it already falls through to "public only." Verified
  live rather than assumed: registered a real account through the UI,
  confirmed it, and checked `GET /api/channels` returned only the one
  public channel out of two total.

- **`otp_secret` is encrypted at rest via Rails 8's `encrypts`, not
  hashed.** Unlike a password, a TOTP secret has to be read back to
  generate the expected code each login — hashing would make that
  impossible, so this needed Active Record's built-in encryption rather
  than the existing scrypt pattern. Costs nothing new operationally:
  `RAILS_MASTER_KEY` is already mandatory infra, and the three new
  `active_record_encryption.*` keys `db:encryption:init` generates are
  just another entry in the already-encrypted `credentials.yml.enc`.
  Verified live that this isn't a silent no-op: the raw DB column value
  for `otp_secret` is genuinely ciphertext, confirmed to differ from the
  plaintext both via `bin/rails runner` and an rspec "SECURITY" test.

- **A 2FA login mints no Session/cookie until the code is verified.**
  When `otp_enabled?` is true, `Api::AuthController#login` does not call
  `sign_in` — it only creates a `TwoFactorChallenge` (a short-lived,
  single-use, digest-only-storage twin of `Session`, added in the data
  model so the pattern was already proven) and returns
  `{twoFactorRequired, challengeToken}` in the body, never a cookie. A
  leaked step-1 response is therefore not a partial session, since there
  is no session yet — `ApplicationController#current_user` and every
  `require_*!` guard needed zero changes, because a mid-2FA caller was
  never signed in by that machinery in the first place. Verified live: a
  `curl` sequence confirmed step 1 sets no `Set-Cookie` at all, and a
  stale/replayed challenge token is rejected after a successful verify
  (single-use).

- **QR codes render server-side (`rqrcode`, SVG), not client-side.** One
  implementation of "turn a TOTP secret into a QR code" instead of two
  that could drift, and it added zero new npm dependencies to the React
  app — `EditProfileDialog` just drops the returned SVG string in via
  `dangerouslySetInnerHTML` (safe here: the SVG is generated server-side
  from this account's own secret, never user-authored content).

- **Avatar upload logic was extracted into a shared `AvatarUploadable`
  concern (Rails) and `AvatarCropField` component (React)**, rather than
  duplicating the existing self-service upload for the new admin-facing
  one. `Api::AuthController#avatar` and the new
  `Api::Admin::UsersController#avatar` both call `store_avatar!`;
  `EditProfileDialog` and the new `AdminUserEditPage` both render
  `AvatarCropField`, parameterized only by upload URL and target user.

- **Admin's 2FA reset requires no re-authentication; self-service disable
  requires the current password.** Different threat models: an admin
  clearing someone else's stuck 2FA is an administrative action already
  gated by `require_admin!`, while a user disabling their own 2FA is a
  security-lowering action on their own account and should re-prove
  identity the same way `update_me`'s password change already does.

- **A real, unrelated bug was found and fixed live, not in review:**
  `AuthContext.logout()` called `api.post('/api/auth/logout')`, but the
  route is a `DELETE` — every "Sign out" click had been silently 404ing.
  The existing test never caught it because it mocked the response
  unconditionally without asserting the HTTP method. Fixed the call site
  and hardened the test to assert `DELETE` specifically, so this can't
  regress silently again.

- **A React StrictMode double-invoke bug was found and fixed live, also
  not in review:** `ConfirmEmailPage`'s confirm POST fired twice under
  StrictMode's dev-only double-invoked effect. The confirmation token is
  single-use, so the second call failed and its error raced to overwrite
  the first call's real success in the UI — the account was actually
  confirmed server-side the whole time, but the page showed an error.
  Fixed with a ref that gates the POST to fire at most once per token;
  added a regression test that renders under `<StrictMode>` specifically,
  since none of the existing page tests did and so couldn't have caught
  it.

### 2026-08-29 (follow-up: backup/recovery codes)

- **Added the recovery-code capability originally deferred as out of
  scope for "the basics."** 10 single-use codes, digest-only storage
  (same pattern as `confirmation_token_digest`/`Session#token_digest`),
  generated automatically the moment 2FA is first enabled and shown
  exactly once in `EditProfileDialog`'s reveal panel — the only place in
  the app they're ever visible in plaintext. A self-service regenerate
  action (password-gated, like disable) replaces the whole set.
  `AuthController#verify_two_factor` tries a real TOTP code first, then
  falls back to a backup code — `LoginPage`'s single code field never
  needs to know which kind was typed. Disabling 2FA and an admin's
  force-reset both clear backup codes too, since they're meaningless
  without 2FA enabled.

- **A real, previously-silent gap in this session's own verification was
  found while working on this:** plain `tsc --noEmit` (used throughout
  every earlier phase's "clean typecheck" claim) checks nothing at all
  against this project's solution-style root `tsconfig.json` (`files: []`
  + `references`) — it silently succeeds regardless of real errors. The
  actual command this project's own `npm run build` uses is `tsc -b`
  (build mode, which walks the referenced `tsconfig.app.json`/
  `tsconfig.node.json`). Running the correct command surfaced exactly one
  real gap that had slipped through every earlier phase unnoticed —
  `ChannelEditPage.test.tsx`'s `User` fixture predated the email/2FA
  fields entirely — fixed, and `tsc -b --force` is now the command used
  to verify TypeScript in this project going forward.

## Verification

Every phase was proven live on the dev box, not just with unit tests, per
this project's established discipline — a repeated pattern this session:
a unit test proves the code is internally consistent, live use proves the
system actually behaves the way the design assumes.

Registration → confirmation: registered a throwaway account through the
real React UI, pulled the confirmation link out of `docker compose logs`
(SMTP left unset — the `:test`-delivery fallback still logs the real
link), confirmed via the real page, and signed in — including a StrictMode
regression that a plain component-render test would not have surfaced.

2FA: called `/api/two-factor/setup` for a real secret, generated a real
TOTP code from it (`ROTP::TOTP.new(secret).now`, standing in for an
authenticator app), enabled it, then ran a full `curl` login sequence
proving step 1 sets no cookie and a wrong code is rejected before a
correct one completes sign-in. Repeated end-to-end in a real browser: the
account menu's real rendered QR/secret scanned into a generated code,
sign-out, sign back in through the real two-step login UI, a wrong code
shown rejected on-screen before the correct one succeeded.

Admin Users rebuild: the new `show`/`reset-2fa`/`avatar` endpoints were
curl-verified before any frontend existed for them; then in a real
browser, the list page's new Email/2FA badge columns rendered correctly,
the edit page loaded a real user, and a real password reset was confirmed
to have actually taken effect via `User.authenticate_credentials`
afterward. The role `<Select>` and the 2FA-reset `confirm()` dialog
aren't drivable in this project's sandboxed browser-automation pane (a
known, pre-existing limitation — native `confirm()`/`alert()` auto-decline
there, and Radix `Select` doesn't respond to synthetic clicks) — both are
covered by component tests instead, with the underlying endpoint
independently curl-verified.

324 rspec examples and 33 vitest files / 148 tests green as of the final
commit (backup codes included), both re-run in full at least once per
phase, not just the files touched that phase — the vitest count now
verified with `tsc -b`, the command this project's own build actually
uses, not the silently-no-op `tsc --noEmit` used (and trusted) for every
earlier phase.

## Links

- Branch: `migration/go-rails-react`
- Related features: [[feat-migration-rails-control-plane]] (the User/
  Session model conventions this extends — scrypt passwords, digest-only
  session storage, decoy-hash timing protection — all reused rather than
  reinvented), [[feat-streamer-role]] (the role/quota precedent
  `compositor_quota`'s admin-hides-for-admin-role display rule already
  set, mirrored here for the Users list)
- External: none
