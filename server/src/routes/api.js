'use strict';

/** Viewer-facing API: just enough state to render and drive the player. */

const express = require('express');
const config = require('../config');
const store = require('../store');
const streams = require('../streams');
const compositor = require('../compositor');
const mediamtx = require('../mediamtx');

const router = express.Router();

router.get('/state', async (req, res) => {
  const d = store.get();
  const all = await streams.withLiveState();
  const status = compositor.status();
  const program = await mediamtx.programState().catch(() => ({ ready: false, readers: 0 }));

  res.json({
    user: req.user || null,
    settings: {
      siteName: d.settings.siteName,
      showIndividualStreams: d.settings.showIndividualStreams,
      publicViewing: d.settings.publicViewing,
    },
    program: {
      // Public alias; the real MediaMTX path stays server-side.
      path: 'program',
      ready: program.ready,
      readers: program.readers,
      width: d.composition.width,
      height: d.composition.height,
      fps: d.composition.fps,
      bitrateKbps: d.composition.bitrateKbps,
      enabled: d.composition.enabled,
      encoding: status.running,
      encoder: status.encoder,
      liveFps: status.progress.fps,
      liveBitrateKbps: status.progress.bitrateKbps,
    },
    layout: status.layout
      ? { name: status.layout.layout, cols: status.layout.cols, rows: status.layout.rows, cells: status.layout.cells, width: status.layout.width, height: status.layout.height }
      : null,
    // The on-air list is keyed by playback id like `streams` above: the
    // compositor tracks sources by ingest key, which must not reach a browser.
    onAir: status.sources
      .map((s) => {
        const known = all.find((x) => x.key === s.key);
        return known && known.playbackId ? { key: known.playbackId, name: s.name } : { key: null, name: s.name };
      }),
    streams: all
      .filter((s) => s.enabled !== false && s.playbackId)
      .map((s) => ({
        // The ingest key is a publishing credential and is deliberately absent.
        key: s.playbackId,
        name: s.name,
        live: s.live,
        hasAudio: s.hasAudio,
        // Media path the player subscribes to, via the authenticated proxy.
        path: `s/${s.playbackId}`,
      })),
    version: config.version,
    serverTime: new Date().toISOString(),
  });
});

module.exports = router;
