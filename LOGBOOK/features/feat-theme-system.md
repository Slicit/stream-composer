---
status: shipped
branch: migration/go-rails-react
---

# Theme system: Legacy, Studio, Aurora, On Air

## Intent

The React app had exactly one look, with no theming mechanism at all.
Requested verbatim: "Build 3 themes, that match the streaming/video/live
vibe well, the 3 themes must feature different color schemes, the first
one is our current theme, we can probably increase the contrast a little
between nav and body," followed by clarifying constraints: keep the
current theme as Legacy, unchanged; turn an improved version of it into
one of the three new themes; end up with four themes total.

Shipped four themes (Legacy, Studio, Aurora, On Air) plus the entire
theme-switching mechanism from scratch: CSS custom properties keyed off a
`data-theme` attribute, a `ThemeSwitcher` dropdown, a `ThemeContext`, and
(in a same-day follow-up) server-side persistence to the account instead
of `localStorage` alone.

## Decisions

- **Themes are CSS custom properties under `[data-theme="..."]"`
  attribute selectors** (`react-app/src/index.css`), not a CSS-in-JS or
  Tailwind-config-swap approach. Every existing Tailwind utility class
  already resolves through the same custom-property tokens, so no
  component needed to change to support theming.

- **Legacy stayed pixel-for-pixel unchanged**, per explicit instruction.
  The contrast increase the user asked about ("increase the contrast a
  little between nav and body") landed as a new `--nav`/`--nav-foreground`
  token pair, introduced for the *new* themes and applied to Legacy only
  as the one deliberate, requested tweak, not a broader restyle.

- **Theme persists in two layers, not one.** `ThemeContext` still caches
  to `localStorage` (instant, no network round trip, works signed out) as
  the primary read path, but a signed-in account's choice also persists
  server-side (`users.theme` column + a small PATCH endpoint) and
  `ThemeAccountSync` applies the account's stored theme once per sign-in
  (a `useRef` guard keyed on user id, so it does not fight a same-session
  local change). This was a same-day follow-up ("move themes outside
  localstorage, make them real persistent themes") after the first
  version shipped local-only.

- **FOUC avoided with a blocking inline `<script>` in `index.html`** that
  reads the cached theme and sets `data-theme` on `<html>` before React
  hydrates, rather than a `useEffect` that would paint the default theme
  first and flash to the real one.

## Verification

Proven with the new Playwright suite (`react-app/e2e/theme-switcher.spec.ts`,
see [[feat-e2e-playwright-mailpit]]): a signed-out visitor sees all four
themes listed, a real click applies one and it survives a reload; a
signed-in account's choice, set in one browser context, is proven to
follow the account (not just that context's `localStorage`) by copying
only the session cookie into a brand-new browser context with empty
storage and confirming the theme still applies there.

## Links

- Branch: `migration/go-rails-react`
- Related features: [[feat-e2e-playwright-mailpit]] (the e2e coverage
  that proves persistence), [[feat-migration-react-frontend]] (the base
  component/routing structure themes were layered onto)
- External: none
