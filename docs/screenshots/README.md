# Screenshots

Every image here is a real capture of a running go-rails-react dev stack,
no mock-ups. 1440x900 pages, captured with Chromium via Playwright.

| File | Screen |
|---|---|
| [viewer-home.png](viewer-home.png) | The default viewer page, showing whichever channel is live on air |
| [channel-viewer.png](channel-viewer.png) | A channel's own page in "Fixed" layout mode: its grid, plus the Streams favorites panel in the left nav |
| [channel-viewer-maximize.png](channel-viewer-maximize.png) | A channel in "Maximize" layout mode: the grid fits itself to the available page space instead of a locked canvas |
| [admin-users.png](admin-users.png) | Admin → Users: accounts, roles, and the impersonate action |
| [admin-streams.png](admin-streams.png) | Admin → Streams: masked keys and per-stream visibility |
| [admin-relays.png](admin-relays.png) | Admin → Relays: forwarding sources on to other platforms |
| [admin-channels.png](admin-channels.png) | Admin → Channels: curated stream lists and their visibility |
| [admin-channel-edit.png](admin-channel-edit.png) | A channel's full edit page: name, slug, description, topic, featured game, visibility, layout mode, owner, members, background image |
| [admin-games.png](admin-games.png) | Admin → Games: the list channels pick a featured game from |
| [admin-settings.png](admin-settings.png) | Admin → Settings: the site-wide default layout mode and the public-viewing toggle |
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
- **Two adjacent solid-black tiles can look like one merged rectangle.**
  There is a real gap between them (see `channel-viewer-maximize.png`),
  it just isn't visible against two identical black backgrounds in a
  static image — with real video this isn't an issue.

## Refreshing them

```bash
cd scripts/screenshots
npm install && npx playwright install chromium   # first time only

BASE_URL=http://localhost:15173 \
ADMIN_USERNAME=<admin username> ADMIN_PASSWORD=<admin password> \
CHANNEL_SLUG=<a public channel with a couple of live members> \
MAXIMIZE_CHANNEL_SLUG=<a channel using "maximize" layout mode> \
EDIT_CHANNEL_ID=<uuid of the channel MAXIMIZE_CHANNEL_SLUG names> \
  node capture.mjs
```

Needs the dev stack already running (`docker-compose.migration.yml`) with
at least one enabled stream and, ideally, a public channel with a couple of
sources actually publishing so the shots aren't empty placeholders.
`MAXIMIZE_CHANNEL_SLUG`/`EDIT_CHANNEL_ID` are optional — without them,
`channel-viewer-maximize.png` and `admin-channel-edit.png` are simply
skipped. Writes to `docs/screenshots/`, so the diff shows exactly which
screens changed.
