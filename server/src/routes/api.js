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
      path: config.programPath,
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
    onAir: status.sources,
    streams: all
      .filter((s) => s.enabled !== false)
      .map((s) => ({
        key: s.key,
        name: s.name,
        live: s.live,
        hasAudio: s.hasAudio,
        // Media paths the player can subscribe to, via the authenticated proxy.
        path: `${config.ingestPrefix}/${s.key}`,
      })),
    version: config.version,
    serverTime: new Date().toISOString(),
  });
});

module.exports = router;
