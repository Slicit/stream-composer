'use strict';

/** Administration API. Every route in here is behind requireAdmin. */

const express = require('express');
const os = require('os');
const config = require('../config');
const store = require('../store');
const auth = require('../auth');
const streams = require('../streams');
const compositor = require('../compositor');
const encoder = require('../encoder');
const logger = require('../logger');
const stats = require('../stats');
const mediamtx = require('../mediamtx');
const { LAYOUTS, isValidLayout, computeLayout } = require('../layout');

const router = express.Router();
router.use(express.json({ limit: '256kb' }));

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) logger.scope('admin').error(err.message, err.stack);
  return res.status(status).json({ error: err.message || 'Something went wrong.' });
}

function num(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ------------------------------------------------------------------ streams

router.get('/streams', async (_req, res) => {
  try {
    res.json({ streams: await streams.withLiveState() });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/streams', (req, res) => {
  try {
    const stream = streams.create(req.body || {});
    compositor.nudge();
    res.status(201).json({ stream: { ...stream, ingest: streams.ingestInfo(stream) } });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/streams/:id', (req, res) => {
  try {
    const stream = streams.update(req.params.id, req.body || {});
    compositor.nudge();
    res.json({ stream: { ...stream, ingest: streams.ingestInfo(stream) } });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/streams/:id/rotate-key', (req, res) => {
  try {
    const stream = streams.rotateKey(req.params.id);
    compositor.nudge();
    res.json({ stream: { ...stream, ingest: streams.ingestInfo(stream) } });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/streams/:id', (req, res) => {
  try {
    streams.remove(req.params.id);
    compositor.nudge();
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// -------------------------------------------------------------------- users

router.get('/users', (_req, res) => {
  res.json({ users: auth.listUsers() });
});

router.post('/users', (req, res) => {
  try {
    res.status(201).json({ user: auth.createUser(req.body || {}) });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/users/:id', (req, res) => {
  try {
    const { role, password } = req.body || {};
    let user = null;
    if (role) user = auth.setRole(req.params.id, role);
    if (password) user = auth.setPassword(req.params.id, password);
    if (!user) throw Object.assign(new Error('Nothing to change.'), { status: 400 });
    res.json({ user });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/users/:id', (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      throw Object.assign(new Error('You cannot delete the account you are signed in with.'), { status: 409 });
    }
    auth.deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// -------------------------------------------------------------- composition

router.get('/composition', (_req, res) => {
  res.json({
    composition: store.get().composition,
    layouts: LAYOUTS,
    encoders: encoder.available(),
    resolved: encoder.resolve(store.get().composition.encoder),
    capabilities: {
      ffmpeg: encoder.caps.ffmpegVersion,
      drawtext: encoder.caps.drawtext,
      cores: encoder.caps.cores,
      cpu: encoder.caps.cpuModel,
    },
  });
});

router.put('/composition', (req, res) => {
  try {
    const body = req.body || {};
    const comp = store.get().composition;
    const next = { ...comp };

    if (body.enabled !== undefined) next.enabled = !!body.enabled;
    if (body.mode !== undefined) {
      if (!['server', 'web'].includes(body.mode)) {
        throw Object.assign(new Error('Composition mode must be "server" or "web".'), { status: 400 });
      }
      next.mode = body.mode;
    }
    if (body.layout !== undefined) {
      if (!isValidLayout(body.layout)) throw Object.assign(new Error('That layout is not recognised.'), { status: 400 });
      next.layout = String(body.layout);
    }
    if (body.width !== undefined) next.width = num(body.width, { min: 320, max: 3840, fallback: comp.width });
    if (body.height !== undefined) next.height = num(body.height, { min: 180, max: 2160, fallback: comp.height });
    if (body.fps !== undefined) next.fps = num(body.fps, { min: 1, max: 60, fallback: comp.fps });
    if (body.bitrateKbps !== undefined) next.bitrateKbps = num(body.bitrateKbps, { min: 200, max: 50000, fallback: comp.bitrateKbps });
    if (body.maxrateKbps !== undefined) next.maxrateKbps = num(body.maxrateKbps, { min: 200, max: 60000, fallback: comp.maxrateKbps });
    if (body.bufsizeKbps !== undefined) next.bufsizeKbps = num(body.bufsizeKbps, { min: 200, max: 120000, fallback: comp.bufsizeKbps });
    if (body.gopSeconds !== undefined) next.gopSeconds = num(body.gopSeconds, { min: 1, max: 10, fallback: comp.gopSeconds });
    if (body.threads !== undefined) next.threads = num(body.threads, { min: 0, max: 64, fallback: comp.threads });
    if (body.gapPx !== undefined) next.gapPx = num(body.gapPx, { min: 0, max: 64, fallback: comp.gapPx });
    if (body.labelSize !== undefined) next.labelSize = num(body.labelSize, { min: 10, max: 72, fallback: comp.labelSize });
    if (body.labels !== undefined) next.labels = !!body.labels;
    if (body.preset !== undefined) {
      const presets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'];
      if (!presets.includes(body.preset)) throw Object.assign(new Error(`Preset must be one of: ${presets.join(', ')}.`), { status: 400 });
      next.preset = body.preset;
    }
    if (body.encoder !== undefined) {
      const kinds = ['auto', 'x264', 'vaapi', 'nvenc', 'qsv'];
      if (!kinds.includes(body.encoder)) throw Object.assign(new Error(`Encoder must be one of: ${kinds.join(', ')}.`), { status: 400 });
      next.encoder = body.encoder;
    }
    if (body.scaleFlags !== undefined) {
      const flags = ['fast_bilinear', 'bilinear', 'bicubic', 'lanczos', 'neighbor'];
      if (!flags.includes(body.scaleFlags)) throw Object.assign(new Error(`Scaler must be one of: ${flags.join(', ')}.`), { status: 400 });
      next.scaleFlags = body.scaleFlags;
    }
    if (body.background !== undefined) {
      if (!/^#?[0-9a-fA-F]{6}$/.test(String(body.background))) throw Object.assign(new Error('Background must be a hex colour such as #0b1220.'), { status: 400 });
      next.background = String(body.background).startsWith('#') ? body.background : `#${body.background}`;
    }
    if (body.include !== undefined) {
      if (!['live', 'manual'].includes(body.include)) throw Object.assign(new Error('Source selection must be "live" or "manual".'), { status: 400 });
      next.include = body.include;
    }
    if (body.order !== undefined) {
      if (!Array.isArray(body.order)) throw Object.assign(new Error('Order must be a list of stream keys.'), { status: 400 });
      // De-duplicate: repeated keys would spawn one ffmpeg input per copy of
      // the same stream.
      next.order = [...new Set(body.order.filter((k) => typeof k === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(k)))].slice(0, 32);
    }

    if (next.maxrateKbps < next.bitrateKbps) next.maxrateKbps = next.bitrateKbps;
    if (next.bufsizeKbps < next.maxrateKbps) next.bufsizeKbps = next.maxrateKbps * 2;
    next.width = Math.floor(next.width / 2) * 2;
    next.height = Math.floor(next.height / 2) * 2;

    store.update((d) => {
      d.composition = next;
    });
    compositor.nudge();
    res.json({ composition: next, resolved: encoder.resolve(next.encoder) });
  } catch (err) {
    fail(res, err);
  }
});

/** Preview a layout without touching the running configuration. */
router.get('/layout-preview', (req, res) => {
  const comp = store.get().composition;
  const count = num(req.query.count, { min: 0, max: 32, fallback: compositor.status().sources.length });
  const layoutId = req.query.layout && isValidLayout(req.query.layout) ? String(req.query.layout) : comp.layout;
  res.json({
    layout: computeLayout(count, { width: comp.width, height: comp.height, gap: comp.gapPx, layout: layoutId }),
  });
});

router.get('/ffmpeg-command', (_req, res) => {
  try {
    res.json(compositor.preview());
  } catch (err) {
    fail(res, err);
  }
});

router.post('/restart', (_req, res) => {
  compositor.nudge();
  res.json({ ok: true });
});

// ----------------------------------------------------------------- settings

router.get('/settings', (_req, res) => {
  res.json({ settings: store.get().settings, ingest: { prefix: config.ingestPrefix, host: config.rtmpHost, rtmpPort: config.rtmpPort, rtmpsEnabled: config.rtmpsEnabled, rtmpsPort: config.rtmpsPort, srtEnabled: config.srtEnabled, srtPort: config.srtPort, publicUrl: config.publicUrl } });
});

router.put('/settings', (req, res) => {
  try {
    const body = req.body || {};
    const s = store.get().settings;
    const next = { ...s };

    if (body.siteName !== undefined) next.siteName = String(body.siteName).trim().slice(0, 64) || 'Stream Composer';
    if (body.publicViewing !== undefined) next.publicViewing = !!body.publicViewing;
    if (body.showIndividualStreams !== undefined) next.showIndividualStreams = !!body.showIndividualStreams;
    if (body.logLevel !== undefined) {
      if (!Object.keys(logger.LEVELS).includes(body.logLevel)) throw Object.assign(new Error('Log level must be error, warn, info or debug.'), { status: 400 });
      next.logLevel = body.logLevel;
    }
    if (body.logMaxSizeMb !== undefined) next.logMaxSizeMb = num(body.logMaxSizeMb, { min: 1, max: 1024, fallback: s.logMaxSizeMb });
    if (body.logMaxFiles !== undefined) next.logMaxFiles = num(body.logMaxFiles, { min: 1, max: 50, fallback: s.logMaxFiles });
    if (body.stabilizeMs !== undefined) next.stabilizeMs = num(body.stabilizeMs, { min: 0, max: 30000, fallback: s.stabilizeMs });
    if (body.restartDelayMs !== undefined) next.restartDelayMs = num(body.restartDelayMs, { min: 250, max: 60000, fallback: s.restartDelayMs });
    if (body.maxRestartDelayMs !== undefined) next.maxRestartDelayMs = num(body.maxRestartDelayMs, { min: 1000, max: 300000, fallback: s.maxRestartDelayMs });

    store.update((d) => {
      d.settings = next;
    });
    logger.configure({ level: next.logLevel, maxSizeMb: next.logMaxSizeMb, maxFiles: next.logMaxFiles });
    res.json({ settings: next });
  } catch (err) {
    fail(res, err);
  }
});

// --------------------------------------------------------------------- logs

router.get('/logs', (req, res) => {
  const channel = ['server', 'ffmpeg'].includes(req.query.channel) ? req.query.channel : 'server';
  const lines = num(req.query.lines, { min: 10, max: 2000, fallback: 300 });
  res.json({ channel, lines: logger.tail(channel, lines), files: logger.stats() });
});

// -------------------------------------------------------------------- stats

router.get('/status', async (_req, res) => {
  const status = compositor.status();
  const program = await mediamtx.programState().catch(() => ({ ready: false, readers: 0 }));
  res.json({
    compositor: status,
    program,
    mediamtx: mediamtx.health(),
    host: stats.snapshot(),
    node: { version: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1048576), uptimeSec: Math.round(process.uptime()) },
    app: { version: config.version, hostname: os.hostname() },
  });
});

module.exports = router;
