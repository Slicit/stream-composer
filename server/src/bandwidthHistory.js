'use strict';

/**
 * A long-horizon bandwidth trend, distinct from the Server tab's existing
 * output-bitrate sparkline (last two minutes, in-memory only, programme
 * output specifically). This tracks total inbound (ingest) and outbound
 * (every read MediaMTX has served, from any path) bytes, sampled every
 * fifteen minutes and kept for seven days — coarse on purpose, this is a
 * capacity-planning trend, not a real-time monitor.
 *
 * "Outbound" is honestly labelled rather than narrowly accurate: MediaMTX
 * does not distinguish a viewer's WHEP read from the compositor reading a
 * source or a restream destination pulling one, so this is every read
 * combined, not internet egress alone. Splitting those apart would mean
 * tracking bytes per session ourselves instead of trusting MediaMTX's own
 * counters, for a distinction this trend graph does not need to make.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const mediamtx = require('./mediamtx');

const log = logger.scope('bandwidth-history');

const SAMPLE_INTERVAL_MS = 15 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_FILE = path.join(config.dataDir, 'bandwidth-history.json');

let history = []; // [{ at: isoString, inboundKbps, outboundKbps }]
let lastCounters = null; // { at, inboundBytes, outboundBytes }
let timer = null;

function load() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    history = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    history = [];
  }
}

function persist() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${HISTORY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(history));
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (err) {
    log.error('failed to persist bandwidth history', err.message);
  }
}

function prune() {
  const cutoff = Date.now() - RETENTION_MS;
  history = history.filter((s) => new Date(s.at).getTime() >= cutoff);
}

async function sample() {
  let paths;
  try {
    paths = await mediamtx.listPaths();
  } catch (err) {
    log.debug('could not sample bandwidth', err.message);
    return;
  }

  const prefix = `${config.ingestPrefix}/`;
  let inboundBytes = 0;
  let outboundBytes = 0;
  for (const p of paths) {
    if (typeof p.name === 'string' && p.name.startsWith(prefix)) inboundBytes += p.bytesReceived || 0;
    outboundBytes += p.bytesSent || 0;
  }

  const now = Date.now();
  const point = { at: new Date(now).toISOString(), inboundKbps: 0, outboundKbps: 0 };

  // A counter going backwards means a publisher (or MediaMTX itself)
  // restarted since the last sample — same reasoning as mediamtx.js's own
  // programme-bitrate measurement: record a zero rather than a negative or
  // a nonsense spike, and let the next sample re-establish the baseline.
  if (lastCounters && inboundBytes >= lastCounters.inboundBytes && outboundBytes >= lastCounters.outboundBytes) {
    const seconds = (now - lastCounters.at) / 1000;
    if (seconds > 0) {
      point.inboundKbps = Math.round(((inboundBytes - lastCounters.inboundBytes) * 8) / 1000 / seconds);
      point.outboundKbps = Math.round(((outboundBytes - lastCounters.outboundBytes) * 8) / 1000 / seconds);
    }
  }
  lastCounters = { at: now, inboundBytes, outboundBytes };

  history.push(point);
  prune();
  persist();
}

function nudge() {
  sample().catch((err) => log.error('sample failed', err.message));
}

function startLoop() {
  load();
  prune();
  if (timer) clearInterval(timer);
  timer = setInterval(nudge, SAMPLE_INTERVAL_MS);
  timer.unref();
  nudge();
  log.info('tracking bandwidth history', { points: history.length, intervalMs: SAMPLE_INTERVAL_MS });
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** A copy, oldest first — safe for a route to hand straight to JSON.stringify. */
function get() {
  return history.map((s) => ({ ...s }));
}

module.exports = { startLoop, stop, get, nudge, sample };
