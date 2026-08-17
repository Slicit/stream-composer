# Screenshots

Every image here is a real capture of a running instance — no mock-ups, no
retouching. They are 1440-wide pages captured at 2× and downscaled to 1600 px.

| File | Screen |
|---|---|
| [viewer.png](viewer.png) | Viewer page: composed programme, source strip, layout map |
| [viewer-audio.png](viewer-audio.png) | Viewer page with one source unmuted in the audio monitor |
| [viewer-cinema.png](viewer-cinema.png) | Cinema mode: the picture at ~90% of the window, one slim audio row |
| [viewer-web.png](viewer-web.png) | Viewer page with the grid composed in the browser, no encoder running |
| [login.png](login.png) | Sign-in |
| [admin-streams.png](admin-streams.png) | Admin → Streams: keys, nicknames, live status |
| [admin-restream.png](admin-restream.png) | Admin → Restream: forwarding sources on to other platforms |
| [admin-composition.png](admin-composition.png) | Admin → Composition: layout, output, encoder |
| [admin-users.png](admin-users.png) | Admin → Users: accounts and roles |
| [admin-server.png](admin-server.png) | Admin → Server: load, encoder health, settings |
| [admin-logs.png](admin-logs.png) | Admin → Logs |

## How they were taken

`scripts/screenshots.sh` boots a throwaway instance, publishes synthetic sources
into it, and drives a headless browser over the real pages. Two details are worth
knowing when reading the images:

- **The sources are ffmpeg test patterns**, not cameras — `testsrc2`, colour bars,
  a Mandelbrot zoom and a gradient sweep, each 720p with a tone on its audio
  track. That is what makes the grid look like a test card rather than a concert.
- **The viewer captures publish VP8 rather than H.264.** Chromium builds without
  proprietary codecs — which is what headless capture uses — cannot decode H.264,
  so the player would show its "this browser cannot play the stream" notice
  instead of a picture. Only the programme's output codec is swapped for the
  capture; the layout, the labels, the ingest path, WHEP and the UI are all
  the shipped ones. This is why the viewer's *Received* tile reads `VP8` while
  *Encoder* reads `x264`. The admin captures use the real H.264 encoder.
- **The Restream destinations are seeded, and only the local one is switched
  on.** It forwards to an ffmpeg listening on `127.0.0.1` that stands in for a
  platform, which is why its address looks like that — the *Forwarding* status,
  the rate and the byte count are all measured on a real outgoing socket. The
  Twitch and YouTube rows carry plausible-looking keys and are deliberately off:
  a capture run must never open a connection to somebody's real ingest.

The CPU figure on the Server tab includes the four synthetic publishers, which in
a real deployment would be running on other machines entirely. See
[../PERFORMANCE.md](../PERFORMANCE.md) for what the compositor alone costs.

## Refreshing them

```bash
./scripts/screenshots.sh          # needs ffmpeg, a mediamtx binary and playwright
```

Pass `--mediamtx /path/to/mediamtx` if it is not on `PATH`. The script writes to
`docs/screenshots/`, so the diff shows exactly which screens changed.
