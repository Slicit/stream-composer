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
      // Where the grid is assembled: 'server' (one encoded programme) or
      // 'web' (the player subscribes to each source and arranges them).
      mode: status.mode,
      // Public alias; the real MediaMTX path stays server-side. There is no
      // programme stream at all in web mode, so nothing to point at.
      path: status.mode === 'web' ? null : 'program',
      ready: status.mode === 'web' ? status.sources.length > 0 : program.ready,
      readers: program.readers,
      width: d.composition.width,
      height: d.composition.height,
      fps: d.composition.fps,
      bitrateKbps: d.composition.bitrateKbps,
      enabled: d.composition.enabled,
      encoding: status.running,
      // Cosmetic, but the player draws its own captions in web mode and should
      // draw them only when the operator asked for captions at all.
      labels: !!d.composition.labels,
      labelSize: d.composition.labelSize,
      background: d.composition.background,
      gapPx: d.composition.gapPx,
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
        const caption = s.label || s.name;
        return known && known.playbackId ? { key: known.playbackId, name: caption } : { key: null, name: caption };
      }),
    streams: all
      .filter((s) => s.enabled !== false && s.playbackId)
      .map((s) => ({
        // The ingest key is a publishing credential and is deliberately absent.
        key: s.playbackId,
        // The nickname is the on-air name, so viewers see the same words that
        // are burnt into the cell rather than the operator's internal label.
        name: (s.nickname || '').trim() || s.name,
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
