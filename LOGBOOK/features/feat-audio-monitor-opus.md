---
status: active
branch: feat-audio-monitor-opus
---

# Opus transcode for the browser audio monitor

## Intent

The audio picker (Viewer, "listen to one source") opens an audio-only WHEP
session straight to a source's raw ingest path. That path carries whatever
OBS published, which is always AAC, and browsers only negotiate Opus (or
G.711/G.722) for audio over WebRTC. The session never finds a common codec,
so the viewer selects a source and hears nothing. Fix: transcode each live
source's audio to Opus and republish it internally, so the audio monitor has
something a browser can actually play.

## Plan

1. Confirm the root cause: audio-only WHEP hits the raw ingest path
   directly (`app.js` `selectAudio`), no transcode exists for it at all.
2. Confirm Alpine's `ffmpeg` package is already built `--enable-libopus`
   (checked the APKBUILD) — the encoder is present, only the transcode stage
   is missing.
3. Decide always-on per live source vs on-demand tied to WHEP subscriptions
   (see Decisions, 2026-08-21) — always-on chosen.
4. New supervised module (`server/src/audioRelay.js`), mirroring
   `relays.js`'s per-item supervisor: one ffmpeg per live source with audio,
   RTSP in from `live/<key>`, `-c:a libopus`, RTSP out to `audio/<key>`.
5. `config.js`: add `audioPrefix` (default `audio`).
6. `routes/hooks.js`: allow publish to `audio/<key>` only with the internal
   credential; allow reads the same way `live/<key>` reads are allowed.
7. `proxy.js`: resolve `s/<playbackId>/audio` to `audio/<key>`, reusing the
   same visibility gating as the video path (`resolveStream` helper);
   widen the webrtc segment-count bound to fit the extra path segment.
8. `routes/api.js`: expose `audioPath: s/<playbackId>/audio` per stream.
9. `app.js`: point `selectAudio`'s `WhepClient` at `stream.audioPath`
   instead of `stream.path`.
10. `index.js`: wire `audioRelay.startLoop()` / `.stop()` alongside
    `relays`.
11. Tests: `buildArgs` (codec, no video, correct paths), hook `decide()`
    publish/read rules, `proxy.resolvePlayback`/`parseRequest` for the new
    path shape, including the existing traversal/security assertions.
12. CI: assert the image's ffmpeg actually has `libopus`, not just any
    `opus` encoder — the thing this whole feature depends on.
13. Docs: update `docs/ARCHITECTURE.md`'s "Audio" section.

## Decisions

### 2026-08-21

- **Decision:** transcode continuously for every live source with an audio
  track, whether or not anyone is listening, rather than starting on demand
  when a viewer picks that source's audio.
- **Why:** matches the existing `relays.js` restream module exactly (one
  supervised ffmpeg per item, no session tracking), and Opus encoding is
  cheap — the same order of cost as `relays.js`'s own AAC re-encode path,
  documented there at roughly one percent of a core. On-demand would need
  new coordination between the WHEP proxy and the transcoder (start on
  first request, poll MediaMTX reader counts to tear down), for a CPU
  saving that is small given audio encoding is already cheap. Confirmed
  with the user before building.
- **Impact:** `server/src/audioRelay.js` is new; CPU cost scales with the
  number of *live* sources with audio, not with viewer count. Deferred:
  on-demand start/stop tied to WHEP subscriptions, if CPU cost ever becomes
  a real concern with many simultaneous live sources. Logged to
  `LOGBOOK/candidates.md`.
- **Decision:** the internal MediaMTX credential embedded in the transcoder's
  RTSP URLs is not scrubbed from `ffmpeg.log`, matching `compositor.js`'s
  existing behaviour for its own RTSP publish (unlike `relays.js`, which
  does scrub — but that scrubs *third-party* restream platform keys, a
  different class of credential).
- **Why:** consistency with the existing precedent for this exact class of
  credential; inventing a new scrubbing behaviour for the internal
  credential in one module but not the other would be an unexplained
  inconsistency.
- **Impact:** `server/src/audioRelay.js` logs full ffmpeg commands and
  stderr the same way `compositor.js` does.

## Links

- Branch: `feat-audio-monitor-opus` (work landed on `main`; this repo is
  trunk-based, see `LOGBOOK.md`)
- PR: TBD
- Related ideas: none
- Related features: none
- External: none
