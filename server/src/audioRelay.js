'use strict';

/**
 * Per-source Opus transcode for the browser audio monitor.
 *
 * Every source here arrives over RTMP or SRT as AAC, the codec every OBS
 * setup produces, but browsers only negotiate Opus (or G.711/G.722) for
 * audio over WebRTC. The audio monitor's WHEP session therefore has no
 * codec in common with the raw ingest path and plays nothing. This module
 * keeps one supervised ffmpeg per live source with an audio track,
 * transcoding that track to Opus and republishing it to MediaMTX under
 * `<audioPrefix>/<key>` — which the proxy exposes to viewers as
 * `s/<playbackId>/audio`. See docs/ARCHITECTURE.md, "Audio".
 *
 * One encoder runs per live source with audio, whether or not anyone is
 * listening. Audio-only encoding is cheap (about the same order of cost as
 * relays.js's own AAC re-encode, roughly one percent of a core), so this
 * stays as simple as the rest of the stack: no session tracking, no
 * on-demand start/stop tied to viewer counts. See the feature's Decisions
 * log (LOGBOOK/features/feat-audio-monitor-opus.md) for why that tradeoff
 * was chosen over transcoding only while someone is listening.
 *
 * The internal MediaMTX credential embedded in the RTSP URLs below is not
 * scrubbed from ffmpeg's log output, matching compositor.js's own RTSP
 * publish — unlike relays.js, which scrubs *third-party* restream platform
 * keys, a different class of credential.
 */

const { spawn } = require('child_process');
const config = require('./config');
const logger = require('./logger');
const store = require('./store');
const mediamtx = require('./mediamtx');

const log = logger.scope('audio-relay');

// key -> { proc, key, startedAt }
const running = new Map();
// key -> { status, since, restarts, lastError, lastExit, delayMs, retryAt }
const health = new Map();

let pollTimer = null;
let stopping = false;

function rtspBase() {
  const url = new URL(config.mediamtx.rtmp.replace(/^rtmp:/, 'rtsp:'));
  const user = encodeURIComponent(config.mediamtx.internalUser);
  const pass = encodeURIComponent(config.mediamtx.internalPassword || '');
  const creds = config.mediamtx.internalPassword ? `${user}:${pass}@` : '';
  return `rtsp://${creds}${url.hostname}:${config.mediamtx.rtspPort}`;
}

function stateOf(key) {
  let entry = health.get(key);
  if (!entry) {
    entry = { status: 'off', since: null, restarts: 0, lastError: null, lastExit: null, delayMs: 0, retryAt: 0 };
    health.set(key, entry);
  }
  return entry;
}

function resetBackoff(key) {
  const s = stateOf(key);
  s.delayMs = 0;
  s.retryAt = 0;
}

/** Build the complete ffmpeg argument list for one source's audio transcode. */
function buildArgs(key) {
  const base = rtspBase();
  return [
    '-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-thread_queue_size', '1024',
    '-rtsp_transport', 'tcp',
    '-fflags', '+genpts+discardcorrupt',
    '-use_wallclock_as_timestamps', '1',
    '-i', `${base}/${config.ingestPrefix}/${key}`,
    '-map', '0:a:0',
    '-vn',
    '-c:a', 'libopus', '-b:a', '96k', '-ar', '48000', '-ac', '2',
    '-muxdelay', '0', '-muxpreload', '0',
    '-progress', 'pipe:1',
    '-nostats',
    '-f', 'rtsp',
    '-rtsp_transport', 'tcp',
    `${base}/${config.audioPrefix}/${key}`,
  ];
}

function startOne(key) {
  const args = buildArgs(key);
  const s = stateOf(key);

  log.info('audio transcode started', { key });

  const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = { proc: child, key, startedAt: Date.now() };
  running.set(key, entry);

  s.status = 'connecting';
  s.since = new Date().toISOString();
  s.lastError = null;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (s.status !== 'live' && /out_time_ms=/.test(chunk)) {
      s.status = 'live';
      resetBackoff(key);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    logger.ffmpeg(`[audio ${key}] ${chunk}`);
    const trimmed = String(chunk).trim();
    if (trimmed) s.lastError = trimmed.split('\n').slice(-1)[0].slice(0, 300);
  });

  child.on('error', (err) => {
    s.lastError = err.message;
    running.delete(key);
    scheduleRetry(key, 'ffmpeg could not be started');
  });

  child.on('exit', (code, signal) => {
    const current = running.get(key);
    if (current && current.proc !== child) return; // already superseded
    running.delete(key);
    s.lastExit = { code, signal, at: new Date().toISOString() };
    if (stopping || signal === 'SIGTERM' || signal === 'SIGKILL') {
      s.status = 'off';
      return;
    }
    log.warn('audio transcode stopped', { key, code, signal });
    scheduleRetry(key, `ffmpeg exited with code ${code}`);
  });
}

function stopOne(key, reason) {
  const entry = running.get(key);
  if (!entry) return;
  running.delete(key);
  const s = stateOf(key);
  s.status = 'off';
  s.since = null;
  log.info('audio transcode halted', { key, reason });
  try {
    entry.proc.kill('SIGTERM');
  } catch (_) {
    /* already gone */
  }
  setTimeout(() => {
    try {
      entry.proc.kill('SIGKILL');
    } catch (_) {
      /* already gone */
    }
  }, 3000).unref();
}

/**
 * Back off after a failure, the same shape as relays.js: a source whose audio
 * ffmpeg cannot open (misconfigured MediaMTX, a codec ffprobe would reject)
 * must not be respawned every poll for ever.
 */
function scheduleRetry(key, reason) {
  const s = stateOf(key);
  const settings = store.get().settings;
  s.restarts += 1;
  s.delayMs = s.delayMs
    ? Math.min(s.delayMs * 2, settings.maxRestartDelayMs || 15000)
    : settings.restartDelayMs || 2000;
  s.retryAt = Date.now() + s.delayMs;
  s.status = 'retrying';
  log.debug('will retry an audio transcode', { key, reason, inMs: s.delayMs });
}

// --------------------------------------------------------------------- loop

async function tick() {
  if (stopping) return;

  let live = [];
  try {
    live = await mediamtx.listIngest();
  } catch (err) {
    log.debug('could not read the stream list', err.message);
    return;
  }
  const wanted = new Set(live.filter((l) => l.ready && l.tracks && l.tracks.audio).map((l) => l.key));

  for (const key of [...running.keys()]) {
    if (!wanted.has(key)) stopOne(key, 'source stopped publishing or lost its audio track');
  }
  for (const key of [...health.keys()]) {
    if (!wanted.has(key) && !running.has(key)) health.delete(key);
  }

  for (const key of wanted) {
    if (running.has(key)) continue;
    const s = stateOf(key);
    if (s.retryAt && Date.now() < s.retryAt) continue;
    startOne(key);
  }
}

function nudge() {
  tick().catch((err) => log.error('nudge failed', err.message));
}

function startLoop() {
  stopping = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    tick().catch((err) => log.error('poll failed', err.message));
  }, config.pollIntervalMs);
  pollTimer.unref();
  nudge();
  log.info('watching sources for audio transcode');
}

function stop() {
  stopping = true;
  if (pollTimer) clearInterval(pollTimer);
  for (const key of [...running.keys()]) stopOne(key, 'shutdown');
}

module.exports = { buildArgs, startLoop, stop, nudge };
