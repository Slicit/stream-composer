<div align="center">

# Stream Composer

**Many streams in. One grid out.**

Point any number of OBS instances at one server and it composes them into a single
live programme — automatically laid out, sub-second latency, no GPU required.

[![CI](https://github.com/Slicit/stream-composer/actions/workflows/ci.yml/badge.svg)](https://github.com/Slicit/stream-composer/actions/workflows/ci.yml)
[![Release](https://github.com/Slicit/stream-composer/actions/workflows/release.yml/badge.svg)](https://github.com/Slicit/stream-composer/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Slicit/stream-composer/main/install.sh | bash
```

The installer checks Docker, downloads the latest release, asks four or five
questions (domain or port, administrator account, ingest port) and starts
everything. With a domain it obtains a Let's Encrypt certificate automatically.

Non-interactive:

```bash
curl -fsSL https://raw.githubusercontent.com/Slicit/stream-composer/main/install.sh | bash -s -- \
  --yes --domain stream.example.com --email you@example.com --admin-password 'a-good-password'
```

Then open the admin console, create a stream, and paste the key into OBS. That is
the whole setup.

## What it does

- **Composes automatically.** Streams appear and vanish; the grid re-lays itself.
  One source fills the frame, two sit side by side, three centre the odd one out,
  nine make a 3×3. Or pin a fixed layout, or a spotlight.
- **Sub-second playback** over WebRTC (WHEP), with low-latency HLS as a fallback
  for awkward networks.
- **Audio stays with its source.** The programme is deliberately silent — viewers
  pick one stream to listen to in the player, and everything starts muted.
  Mixing several live rooms together produces something nobody wants to hear.
- **CPU-first.** Sized and measured for machines with no GPU; hardware encoders
  are used automatically when they are there.
- **Managed from the browser.** Stream keys, users, layout, bitrate, logs and
  server load all live in one admin console.
- **Simple for OBS.** Server URL plus stream key. Optionally a Lua script that
  fills both in for you.

## How it fits together

```
  OBS  ──RTMP/SRT──┐
  OBS  ──RTMP/SRT──┤
  OBS  ──RTMP/SRT──┼──▶  MediaMTX  ──RTSP──▶  ffmpeg compositor  ──RTSP──▶  MediaMTX
                   │      (ingest)             (scale · lay out             (programme)
                   │                            · encode)                        │
                   │                                                             │
  Browser  ◀──WebRTC / HLS over HTTPS──  Stream Composer  ◀────────────────────────┘
                                          (web UI, API, auth, proxy)
```

One process supervises ffmpeg, decides the layout, serves the UI and proxies
playback. MediaMTX does ingest and packaging. Traefik terminates TLS.
Only the ingest ports and the WebRTC media port are exposed; everything else
sits on an internal network behind authentication.

More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting a stream on air

1. **Admin → Streams → Create.** Name it, and a key is generated.
2. Press **OBS** next to the stream to see the exact server URL and key.
3. In OBS: *Settings → Stream → Service: Custom*, paste both, **Start Streaming**.
4. Open the viewer page. The grid rebuilds itself within a couple of seconds.

Recommended OBS output for a 720p source: 1280×720, 30 fps, 2500–4000 kb/s,
keyframe interval 2 s, x264 `veryfast`, profile `high`, tune `zerolatency`.

There is also an [OBS helper script](obs/stream-composer.lua) that configures the
service for you — see [docs/OBS.md](docs/OBS.md).

## How much machine do I need?

Measure yours rather than guessing:

```bash
./scripts/benchmark.sh
```

It encodes a real H.264 grid at increasing source counts and tells you where the
machine stops keeping up. On a 2-core 2.1 GHz Xeon the cost works out at roughly

```
core-seconds per second of output  ≈  0.24  +  0.111 × sources
```

for 720p30 inputs into a 1080p30 output at preset `ultrafast` — about 9 sources
at the limit, 6 with comfortable headroom. Full tables, the reasoning and the
levers that actually matter are in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Everyday commands

```bash
cd /opt/stream-composer

docker compose ps                 # what is running
docker compose logs -f            # container logs
docker compose pull && docker compose up -d   # upgrade
make backup                       # tarball of users and configuration
./scripts/benchmark.sh            # capacity check
node scripts/selftest.js --count 6   # render a synthetic grid to a PNG
```

## Documentation

| Document | What is in it |
|---|---|
| [docs/OBS.md](docs/OBS.md) | Connecting OBS, encoder settings, the helper script, multiple instances |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every environment variable and admin setting, including the Compose v1 fallback |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | CPU sizing, measurements, tuning, hardware encoders |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit, security model, design decisions |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | When something is not working |

## Development

```bash
git clone https://github.com/Slicit/stream-composer.git
cd stream-composer
cp .env.example .env               # then set the two secrets

COMPOSE_FILE=docker-compose.yml:docker-compose.local.yml:docker-compose.build.yml \
  docker compose up -d --build

cd server && npm install && npm test
```

`node scripts/selftest.js --count 9 --layout spotlight --encode` renders the real
filtergraph against synthetic sources — the fastest way to check a change to the
compositor without a camera in sight.

## Licence

MIT — see [LICENSE](LICENSE).

Built on [MediaMTX](https://github.com/bluenviron/mediamtx),
[FFmpeg](https://ffmpeg.org/) and [Traefik](https://traefik.io/).
