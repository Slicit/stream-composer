'use strict';

/**
 * Tiny JSON-file store with atomic writes.
 *
 * Deliberately dependency-free: a stream server holds a handful of users and
 * stream keys, so a single JSON document is faster, easier to back up and
 * easier to hand-edit than a database, and it keeps the image small.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');

const log = logger.scope('store');

const DEFAULT_COMPOSITION = {
  enabled: true,
  layout: 'auto', // auto | solo | 1x2 | 2x1 | 2x2 | 3x3 | 4x4 | spotlight
  width: 1920,
  height: 1080,
  fps: 30,
  bitrateKbps: 4500,
  maxrateKbps: 5000,
  bufsizeKbps: 9000,
  preset: 'ultrafast', // x264 preset
  encoder: 'auto', // auto | x264 | vaapi | nvenc | qsv
  gopSeconds: 2,
  threads: 0, // 0 = let ffmpeg decide
  scaleFlags: 'bilinear', // bilinear | bicubic | fast_bilinear | lanczos
  background: '#0b1220',
  gapPx: 4,
  labels: true, // burn the stream name into each cell
  labelSize: 22,
  // The program carries no audio by design — viewers pick one stream's audio in
  // the player (see docs/ARCHITECTURE.md, "Audio").
  order: [], // explicit stream key order; unknown/absent keys fall back to name order
  include: 'live', // live = every publishing stream, manual = only keys in `order`
};

const DEFAULT_SETTINGS = {
  siteName: 'Stream Composer',
  publicViewing: false, // when false, viewers must log in
  showIndividualStreams: true,
  logLevel: config.logLevel,
  logMaxSizeMb: config.logMaxSizeMb,
  logMaxFiles: config.logMaxFiles,
  stabilizeMs: 1500, // wait for the stream set to settle before rebuilding
  restartDelayMs: 2000, // backoff before restarting a dead ffmpeg
  maxRestartDelayMs: 15000,
};

function defaults() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    users: [],
    streams: [],
    composition: { ...DEFAULT_COMPOSITION },
    settings: { ...DEFAULT_SETTINGS },
    secrets: { sessionSecret: crypto.randomBytes(32).toString('hex') },
  };
}

let data = null;
let writeQueued = false;

function mergeDefaults(loaded) {
  const base = defaults();
  const out = {
    ...base,
    ...loaded,
    composition: { ...base.composition, ...(loaded.composition || {}) },
    settings: { ...base.settings, ...(loaded.settings || {}) },
    secrets: { ...base.secrets, ...(loaded.secrets || {}) },
  };
  out.users = Array.isArray(loaded.users) ? loaded.users : [];
  out.streams = Array.isArray(loaded.streams) ? loaded.streams : [];
  return out;
}

function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  try {
    const raw = fs.readFileSync(config.configFile, 'utf8');
    data = mergeDefaults(JSON.parse(raw));
    log.info('configuration loaded', { file: config.configFile, users: data.users.length, streams: data.streams.length });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.error('configuration unreadable, starting from defaults', err.message);
      try {
        fs.copyFileSync(config.configFile, `${config.configFile}.corrupt-${Date.now()}`);
      } catch (_) {
        /* ignore */
      }
    }
    data = defaults();
    persist();
    log.info('created a fresh configuration', { file: config.configFile });
  }

  // Environment always wins for the session secret when it is supplied.
  if (config.sessionSecret) data.secrets.sessionSecret = config.sessionSecret;
  return data;
}

function persist() {
  const tmp = `${config.configFile}.${process.pid}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, payload, { mode: 0o600 });
  fs.renameSync(tmp, config.configFile);
}

/** Coalesce rapid writes into one flush per tick. */
function save() {
  if (writeQueued) return;
  writeQueued = true;
  setImmediate(() => {
    writeQueued = false;
    try {
      persist();
    } catch (err) {
      log.error('failed to persist configuration', err.message);
    }
  });
}

function get() {
  if (!data) load();
  return data;
}

function update(mutator) {
  const d = get();
  const result = mutator(d);
  save();
  return result;
}

module.exports = { get, load, save, update, defaults, DEFAULT_COMPOSITION, DEFAULT_SETTINGS };
