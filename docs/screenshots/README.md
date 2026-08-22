# Screenshots

Every image here is a real capture of a running go-rails-react dev stack,
no mock-ups. 1440x900 pages, captured with Chromium via Playwright.

| File | Screen |
|---|---|
| [viewer-home.png](viewer-home.png) | The default viewer page, showing whichever channel is live on air |
| [channel-viewer.png](channel-viewer.png) | A channel's own page: its grid, plus the Streams favorites panel in the left nav |
| [admin-users.png](admin-users.png) | Admin → Users: accounts, roles, and the impersonate action |
| [admin-streams.png](admin-streams.png) | Admin → Streams: masked keys and per-stream visibility |
| [admin-relays.png](admin-relays.png) | Admin → Relays: forwarding sources on to other platforms |
| [admin-channels.png](admin-channels.png) | Admin → Channels: curated stream lists and their visibility |
| [admin-stats.png](admin-stats.png) | Admin → Server & Stats: CPU/memory, service health, bandwidth history |

## How they were taken

`scripts/screenshots/capture.mjs` logs into an already-running dev stack
(`docker-compose.migration.yml`) as an admin user and drives a headless
Chromium over the real pages, no throwaway environment bootstrapped from
scratch. Two things worth knowing when reading the images:

- **The sources are ffmpeg test patterns** (`testsrc`/`testsrc2` with a
  tone on the audio track), published over RTMP the same way OBS would,
  not cameras.
- **Headless Chromium doesn't paint decoded video frames into the
  screenshot even when playback is genuinely working**, so live tiles show
  as solid black with the source name burned in underneath rather than a
  picture. The live indicators, layout, and everything else are real.

## Refreshing them

```bash
cd scripts/screenshots
npm install && npx playwright install chromium   # first time only

BASE_URL=http://localhost:15173 \
ADMIN_USERNAME=<admin username> ADMIN_PASSWORD=<admin password> \
CHANNEL_SLUG=<a public channel with a couple of live members> \
  node capture.mjs
```

Needs the dev stack already running (`docker-compose.migration.yml`) with
at least one enabled stream and, ideally, a public channel with a couple of
sources actually publishing so the shots aren't empty placeholders. Writes
to `docs/screenshots/`, so the diff shows exactly which screens changed.
