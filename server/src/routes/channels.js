'use strict';

/**
 * Viewer-facing channels API: viewing a channel by slug (no blanket
 * `publicViewing` gate — each route here carries its own, appropriate to
 * what it does), the pool of streams a user may build a channel from, and
 * owner-scoped "my channels" CRUD. Mounted ahead of routes/api.js in
 * index.js so none of this inherits that router's public-viewing relaxation.
 */

const express = require('express');
const auth = require('../auth');
const store = require('../store');
const config = require('../config');
const streams = require('../streams');
const channels = require('../channels');
const access = require('../access');
const { computeLayout } = require('../layout');

const router = express.Router();

function fail(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Something went wrong.' });
}

// -------------------------------------------------------------- viewing

router.get('/channels/:slug/state', channels.requireChannelAccess, async (req, res) => {
  const channel = req.channel;
  const d = store.get();
  const all = await streams.withLiveState();
  const byId = new Map(all.map((s) => [s.id, s]));
  const members = channel.streamIds.map((id) => byId.get(id)).filter(Boolean);
  const liveMembers = members.filter((s) => s.live && s.enabled !== false);
  const restrictedOnAir = liveMembers.filter((s) => !access.canAccess(s, req.user));

  // The viewer may ask to declutter: exclude restricted-and-inaccessible
  // tiles from the grid entirely rather than showing their placeholder, so
  // the layout genuinely reflows around fewer cells. Computed server-side
  // because the layout itself is (layout.js's computeLayout(), the same
  // one every browser-composed grid uses).
  const hideRestricted = req.query.hideRestricted === '1';
  const onAirMembers = hideRestricted ? liveMembers.filter((s) => access.canAccess(s, req.user)) : liveMembers;

  const comp = d.composition;
  const layout = computeLayout(onAirMembers.length, {
    width: comp.width,
    height: comp.height,
    gap: comp.gapPx,
    layout: comp.layout,
  });

  res.json({
    user: req.user || null,
    channel: { name: channel.name, slug: channel.slug, backgroundImage: channel.backgroundImage || null, hiddenCount: restrictedOnAir.length },
    settings: { siteName: channel.name },
    program: {
      mode: 'web', // channels are always browser-composed — see channels.js
      path: null,
      ready: onAirMembers.length > 0,
      readers: 0,
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      bitrateKbps: comp.bitrateKbps,
      enabled: true,
      encoding: false,
      fallback: comp.fallback === 'warn' ? 'warn' : 'hls',
      labels: !!comp.labels,
      labelSize: comp.labelSize,
      background: comp.background,
      gapPx: comp.gapPx,
      encoder: null,
      liveFps: 0,
      liveBitrateKbps: 0,
    },
    layout: { name: layout.layout, cols: layout.cols, rows: layout.rows, cells: layout.cells, width: layout.width, height: layout.height },
    onAir: onAirMembers.map((s) => ({ key: s.playbackId, name: (s.nickname || '').trim() || s.name })),
    streams: members.map((s) => {
      const restricted = !access.canAccess(s, req.user);
      const caption = (s.nickname || '').trim() || s.name;
      if (restricted) {
        return { key: s.playbackId, name: caption, live: s.live, hasAudio: false, problem: null, restricted: true, path: null, audioPath: null };
      }
      return {
        key: s.playbackId,
        name: caption,
        live: s.live,
        hasAudio: s.hasAudio,
        problem: s.playback && s.playback.problem ? s.playback.problem : null,
        restricted: false,
        path: `s/${s.playbackId}`,
        audioPath: `s/${s.playbackId}/audio`,
      };
    }),
    version: config.version,
    serverTime: new Date().toISOString(),
  });
});

// -------------------------------------------------- pool for building one

router.get('/streams/available', auth.requireUser, async (req, res) => {
  const all = await streams.withLiveState();
  const available = all
    .filter((s) => access.canAccess(s, req.user))
    .map((s) => ({ id: s.id, name: s.name, nickname: s.nickname, visibility: s.visibility, live: s.live }));
  res.json({ streams: available });
});

// --------------------------------------------------------- "my channels"

const mine = express.Router();
mine.use(auth.requireUser);
mine.use(express.json({ limit: '64kb' }));

mine.get('/', (req, res) => {
  res.json({ channels: channels.list().filter((c) => c.ownerId === req.user.id) });
});

mine.post('/', (req, res) => {
  try {
    res.status(201).json({ channel: channels.create({ ...(req.body || {}), ownerId: req.user.id }) });
  } catch (err) {
    fail(res, err);
  }
});

mine.patch('/:id', (req, res) => {
  try {
    access.requireOwner(channels.find(req.params.id), req.user);
    res.json({ channel: channels.update(req.params.id, req.body || {}) });
  } catch (err) {
    fail(res, err);
  }
});

mine.delete('/:id', (req, res) => {
  try {
    access.requireOwner(channels.find(req.params.id), req.user);
    channels.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// No express.json() on this one — the body is the image itself, not JSON.
mine.put('/:id/background', express.raw({ type: 'image/*', limit: '5mb' }), (req, res) => {
  try {
    access.requireOwner(channels.find(req.params.id), req.user);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw Object.assign(new Error('Send the image as the raw request body with an image Content-Type (png, jpeg, webp or gif).'), { status: 400 });
    }
    const channel = channels.setBackgroundImage(req.params.id, req.body, String(req.headers['content-type'] || '').split(';')[0].trim());
    res.json({ channel });
  } catch (err) {
    fail(res, err);
  }
});

router.use('/channels/mine', mine);

module.exports = router;
