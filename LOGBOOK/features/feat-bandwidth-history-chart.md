---
status: shipped
branch: feat-bandwidth-history-chart
---

# 7-day bandwidth chart on Admin → Server

## Intent

The Server tab's only bandwidth visibility was a 2-minute, in-memory-only
sparkline of the programme's own output bitrate. Add an interactive,
hover-for-values chart of total inbound/outbound bandwidth over the last
7 days, persisted so it survives restarts.

## Plan

1. `server/src/bandwidthHistory.js`: sample MediaMTX's own byte counters
   every 15 minutes, compute kb/s from the delta since the last sample
   (same reset-handling reasoning as `mediamtx.js`'s programme-bitrate
   measurement), persist to `/data/bandwidth-history.json` (separate from
   `config.json` on purpose — different write pattern, see
   `docs/ARCHITECTURE.md`, "Storage"), prune anything older than 7 days.
2. `GET /api/admin/bandwidth-history` — plain array, no new auth concerns
   (already behind `requireAdmin`).
3. Client: vendor `chart.js` the same way `hls.js` already is (own
   `/vendor/chart.js` route, no CDN — see `docs/ARCHITECTURE.md`, "Choices
   worth knowing about"), lazy-loaded only when the Server tab is shown.
   Chart.js's built-in tooltip (`interaction: {mode:'index'}`) gave the
   "hover shows values" requirement with no custom code.
4. Tests: the endpoint's shape survives MediaMTX being unreachable, and a
   failed sample records nothing rather than a bogus point.

## Decisions

### 2026-08-22

- **Decision:** "outbound" is every byte MediaMTX has read from any path —
  viewer playback, restream forwarding, the compositor's own reads,
  combined — not internet egress alone.
- **Why:** MediaMTX's own counters do not distinguish reader types.
  Isolating "leaves the box" traffic would mean tracking bytes per session
  ourselves instead of trusting the counters this whole app already trusts
  elsewhere (`mediamtx.js`'s programme bitrate). Labelling the chart
  honestly ("every read combined") was cheaper and more truthful than
  building that, and is said directly in the admin UI's own caption, not
  just in code comments.
- **Impact:** `bandwidthHistory.js`'s doc comment and the Server tab's
  caption both spell this out, so nobody mistakes it for a metered-egress
  number later.

- **Decision:** `require.resolve('chart.js/dist/chart.umd.min.js')` does
  not work — chart.js's `package.json` "exports" map only declares `.`,
  `./auto` and `./helpers` as importable subpaths, unlike hls.js. Resolved
  instead via `path.dirname(require.resolve('chart.js'))` +
  `chart.umd.min.js`, which sidesteps the exports restriction by doing
  filesystem path math rather than asking Node to resolve that subpath.
  Caught by actually running the vendored file through the dev server
  rather than trusting the hls.js pattern to generalize — it didn't, first
  try (404, silently "not installed").
- **Why:** worth recording since the next vendored client library is
  likely to hit the same "exports map does not list the build artifact"
  wall, and the fix (resolve the package root, then dirname) generalizes.
- **Impact:** `server/src/index.js`'s `/vendor/chart.js` route.

## Links

- Branch: `feat-bandwidth-history-chart` (trunk-based repo; work lands on `main`)
- PR: TBD
- Related ideas: none
- Related features: none
- External: none
