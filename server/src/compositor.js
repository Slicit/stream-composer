'use strict';

/**
 * The compositor.
 *
 * Watches MediaMTX for live ingest streams, works out the layout, builds an
 * ffmpeg filtergraph and supervises the encoder process that publishes the
 * composed program back into MediaMTX.
 *
 * Design notes:
 *  - Sources are read over RTSP (not RTMP) internally: lower overhead, no FLV
 *    container constraints, and it is MediaMTX's native transport.
 *  - The frame rate is normalised *before* scaling so we never scale a frame we
 *    are about to drop. On a CPU-only box scaling is the second biggest cost
 *    after the encoder, so this matters.
 *  - Cells are composited with `overlay` onto a solid background rather than
 *    `xstack`. xstack can only tile a perfect matrix; overlay lets us centre
 *    partial rows, leave gutters and do spotlight layouts from the same code.
 *  - Changes to the live stream set are debounced, because OBS reconnects and
 *    key-frame gaps would otherwise restart the encoder repeatedly.
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');
const config = require('./config');
const logger = require('./logger');
const store = require('./store');
const mediamtx = require('./mediamtx');
const encoderCaps = require('./encoder');
const { computeLayout } = require('./layout');

const log = logger.scope('compositor');

const state = {
  running: false,
  startedAt: null,
  sources: [], // [{key, name, path, hasAudio}]
  layout: null,
  encoder: null,
  restarts: 0,
  lastExit: null,
  lastError: null,
  progress: { fps: 0, bitrateKbps: 0, speed: 0, frames: 0, droppedFrames: 0, uptimeSec: 0 },
  command: null,
};

const events = new EventEmitter();

let proc = null;
let pollTimer = null;
let stabiliseTimer = null;
let restartTimer = null;
let desiredSignature = null;
let currentSignature = null;
let restartDelay = 0;
let stopping = false;

// ------------------------------------------------------------------ helpers

function settings() {
  return store.get().settings;
}

function composition() {
  return store.get().composition;
}

function rtspBase() {
  const url = new URL(config.mediamtx.rtmp.replace(/^rtmp:/, 'rtsp:'));
  url.port = '8554';
  const user = encodeURIComponent(config.mediamtx.internalUser);
  const pass = encodeURIComponent(config.mediamtx.internalPassword || '');
  const creds = config.mediamtx.internalPassword ? `${user}:${pass}@` : '';
  return `rtsp://${creds}${url.hostname}:8554`;
}

/** drawtext is picky: colons, backslashes, quotes and percent signs must go. */
function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "’")
    .replace(/%/g, '\\%')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 48);
}

function hexColor(value, fallback = '0x0b1220') {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(value || ''));
  return m ? `0x${m[1]}` : fallback;
}

/** Which streams should be on air, in the operator's chosen order. */
function selectSources(live) {
  const d = store.get();
  const comp = d.composition;
  const configured = new Map(d.streams.map((s) => [s.key, s]));
  const readyKeys = new Set(live.filter((s) => s.ready).map((s) => s.key));

  let keys;
  if (comp.include === 'manual') {
    keys = (comp.order || []).filter((k) => readyKeys.has(k));
  } else {
    const ordered = (comp.order || []).filter((k) => readyKeys.has(k));
    const rest = [...readyKeys].filter((k) => !ordered.includes(k)).sort((a, b) => {
      const na = (configured.get(a) || {}).name || a;
      const nb = (configured.get(b) || {}).name || b;
      return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
    });
    keys = [...ordered, ...rest];
  }

  // Streams that were explicitly disabled never make it on air.
  keys = keys.filter((k) => {
    const s = configured.get(k);
    return !s || s.enabled !== false;
  });

  return keys.map((key) => {
    const meta = configured.get(key);
    const liveInfo = live.find((s) => s.key === key) || {};
    return {
      key,
      name: (meta && meta.name) || key,
      path: `${config.ingestPrefix}/${key}`,
      hasAudio: !!(liveInfo.tracks && liveInfo.tracks.audio),
    };
  });
}

function signatureOf(sources, comp) {
  return JSON.stringify({
    keys: sources.map((s) => `${s.key}:${s.hasAudio ? 'a' : ''}`),
    c: {
      l: comp.layout, w: comp.width, h: comp.height, f: comp.fps, b: comp.bitrateKbps,
      mr: comp.maxrateKbps, bs: comp.bufsizeKbps, p: comp.preset, e: comp.encoder,
      g: comp.gopSeconds, t: comp.threads, sf: comp.scaleFlags, bg: comp.background,
      gap: comp.gapPx, lb: comp.labels, ls: comp.labelSize, en: comp.enabled,
    },
  });
}

// --------------------------------------------------------------- filtergraph

/**
 * Build the complete ffmpeg argument list.
 * Exported (via buildCommand) so the admin UI can show exactly what will run.
 */
function buildArgs(sources, comp, encoderKind) {
  const layout = computeLayout(sources.length, {
    width: comp.width,
    height: comp.height,
    gap: comp.gapPx,
    layout: comp.layout,
  });

  const placed = sources.slice(0, layout.cells.length);
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin'];

  if (encoderKind === 'vaapi' || encoderKind === 'qsv') {
    args.push('-vaapi_device', config.vaapiDevice);
  }

  const base = rtspBase();
  for (const src of placed) {
    args.push(
      '-thread_queue_size', '1024',
      '-rtsp_transport', 'tcp',
      '-fflags', '+genpts+discardcorrupt',
      '-use_wallclock_as_timestamps', '1',
      '-i', `${base}/${src.path}`,
    );
  }

  const fps = comp.fps || 30;
  const scaleFlags = ['bilinear', 'bicubic', 'fast_bilinear', 'lanczos', 'neighbor'].includes(comp.scaleFlags)
    ? comp.scaleFlags
    : 'bilinear';
  const bg = hexColor(comp.background);
  const useLabels = comp.labels && encoderCaps.caps.drawtext;

  const parts = [];
  parts.push(`color=c=${bg}:s=${layout.width}x${layout.height}:r=${fps}[bg]`);

  placed.forEach((src, i) => {
    const cell = layout.cells[i];
    let chain =
      `[${i}:v]fps=${fps},` +
      `scale=${cell.w}:${cell.h}:force_original_aspect_ratio=decrease:flags=${scaleFlags},` +
      `pad=${cell.w}:${cell.h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    if (useLabels) {
      const size = Math.max(10, Math.min(72, comp.labelSize || 22));
      const font = encoderCaps.caps.fontFile ? `fontfile='${encoderCaps.caps.fontFile}':` : '';
      chain +=
        `,drawtext=${font}text='${escapeDrawtext(src.name)}':` +
        `fontcolor=white:fontsize=${size}:` +
        'box=1:boxcolor=black@0.55:boxborderw=8:' +
        `x=12:y=h-th-12`;
    }
    parts.push(`${chain}[c${i}]`);
  });

  let last = 'bg';
  placed.forEach((_, i) => {
    const cell = layout.cells[i];
    const out = i === placed.length - 1 ? 'stacked' : `o${i}`;
    parts.push(`[${last}][c${i}]overlay=x=${cell.x}:y=${cell.y}:eof_action=pass:repeatlast=1[${out}]`);
    last = out;
  });
  if (placed.length === 0) last = 'bg';

  // Final pixel format / hardware upload stage.
  if (encoderKind === 'vaapi') {
    parts.push(`[${last}]format=nv12,hwupload[outv]`);
  } else if (encoderKind === 'qsv') {
    parts.push(`[${last}]format=nv12,hwupload=extra_hw_frames=16[outv]`);
  } else {
    parts.push(`[${last}]format=yuv420p[outv]`);
  }

  // ---- audio ----
  // The composed program is deliberately video-only. Mixing several live rooms
  // into one track produces an unlistenable result, so audio stays with the
  // original streams and the player subscribes to whichever one the viewer
  // picks (audio-only WHEP, one at a time, muted by default). This also saves
  // an AAC encode per program on CPU-only boxes.
  args.push('-filter_complex', parts.join(';'));
  args.push('-map', '[outv]', '-an');

  args.push(...encoderCaps.outputArgs(encoderKind, comp));

  args.push(
    '-fps_mode', 'cfr',
    '-flags', '+low_delay',
    '-muxdelay', '0',
    '-muxpreload', '0',
    '-progress', 'pipe:1',
    '-nostats',
    '-f', 'rtsp',
    '-rtsp_transport', 'tcp',
    `${rtspBase()}/${config.programPath}`,
  );

  return { args, layout, placed };
}

// ------------------------------------------------------------------ process

function parseProgress(chunk, buffer) {
  const text = buffer + chunk;
  const lines = text.split('\n');
  const rest = lines.pop();
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    switch (key) {
      case 'fps':
        state.progress.fps = Math.round(parseFloat(value) * 10) / 10 || 0;
        break;
      case 'bitrate': {
        const kb = parseFloat(value);
        state.progress.bitrateKbps = Number.isFinite(kb) ? Math.round(kb) : 0;
        break;
      }
      case 'frame':
        state.progress.frames = parseInt(value, 10) || 0;
        break;
      case 'drop_frames':
        state.progress.droppedFrames = parseInt(value, 10) || 0;
        break;
      case 'speed':
        state.progress.speed = parseFloat(value) || 0;
        break;
      case 'out_time_ms':
        state.progress.uptimeSec = Math.round((parseInt(value, 10) || 0) / 1e6);
        break;
      default:
        break;
    }
  }
  return rest;
}

function killCurrent(reason) {
  if (!proc) return;
  log.info('stopping the encoder', { reason, pid: proc.pid });
  const doomed = proc;
  proc = null;
  state.running = false;
  try {
    doomed.kill('SIGTERM');
  } catch (_) {
    /* already gone */
  }
  setTimeout(() => {
    try {
      doomed.kill('SIGKILL');
    } catch (_) {
      /* already gone */
    }
  }, 3000).unref();
}

function start(sources, comp) {
  const encoderKind = encoderCaps.resolve(comp.encoder);
  const { args, layout, placed } = buildArgs(sources, comp, encoderKind);

  state.sources = placed.map((s) => ({ key: s.key, name: s.name, hasAudio: s.hasAudio }));
  state.layout = layout;
  state.encoder = encoderKind;
  state.command = `${config.ffmpegPath} ${args.map((a) => (/[\s;'"]/.test(a) ? `'${a}'` : a)).join(' ')}`;

  log.info('starting the encoder', {
    streams: placed.map((s) => s.key),
    layout: `${layout.layout} (${layout.cols}x${layout.rows})`,
    encoder: encoderKind,
    output: `${comp.width}x${comp.height}@${comp.fps} ${comp.bitrateKbps}k`,
  });
  logger.ffmpeg(`\n=== ${new Date().toISOString()} launching ===\n${state.command}\n`);

  const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc = child;
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.progress = { fps: 0, bitrateKbps: 0, speed: 0, frames: 0, droppedFrames: 0, uptimeSec: 0 };

  let progressBuffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    progressBuffer = parseProgress(chunk, progressBuffer);
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    logger.ffmpeg(chunk);
    const trimmed = chunk.trim();
    if (trimmed) state.lastError = trimmed.split('\n').slice(-1)[0].slice(0, 300);
  });

  child.on('error', (err) => {
    log.error('failed to launch ffmpeg', err.message);
    state.lastError = err.message;
    state.running = false;
    proc = null;
    scheduleRestart();
  });

  child.on('exit', (code, signal) => {
    const wasCurrent = proc === child;
    if (wasCurrent) {
      proc = null;
      state.running = false;
    }
    state.lastExit = { code, signal, at: new Date().toISOString() };
    log.warn('the encoder exited', { code, signal });
    events.emit('exit', state.lastExit);
    if (wasCurrent && !stopping) scheduleRestart();
  });

  currentSignature = signatureOf(sources, comp);
  events.emit('started', { sources: state.sources, layout });
}

function scheduleRestart() {
  if (stopping || restartTimer) return;
  const s = settings();
  restartDelay = restartDelay ? Math.min(restartDelay * 2, s.maxRestartDelayMs || 15000) : s.restartDelayMs || 2000;
  state.restarts += 1;
  log.info('restarting shortly', { inMs: restartDelay, restarts: state.restarts });
  restartTimer = setTimeout(() => {
    restartTimer = null;
    currentSignature = null; // force a rebuild on the next poll
    tick().catch((err) => log.error('restart tick failed', err.message));
  }, restartDelay);
  restartTimer.unref();
}

// --------------------------------------------------------------------- loop

async function tick() {
  if (stopping) return;
  const comp = composition();

  let live = [];
  try {
    live = await mediamtx.listIngest();
  } catch (err) {
    log.debug('could not read the stream list', err.message);
    return;
  }

  const sources = comp.enabled ? selectSources(live) : [];
  const signature = signatureOf(sources, comp);
  events.emit('sources', sources);

  if (signature === currentSignature && (proc || sources.length === 0)) {
    desiredSignature = signature;
    if (proc) restartDelay = 0; // healthy for a full poll cycle
    return;
  }

  if (signature !== desiredSignature) {
    // The set changed — wait for it to settle before acting.
    desiredSignature = signature;
    if (stabiliseTimer) clearTimeout(stabiliseTimer);
    const wait = Math.max(0, settings().stabilizeMs || 1500);
    stabiliseTimer = setTimeout(() => {
      stabiliseTimer = null;
      apply(sources, comp, signature).catch((err) => log.error('apply failed', err.message));
    }, wait);
    stabiliseTimer.unref();
  }
}

async function apply(sources, comp, signature) {
  if (stopping) return;
  if (signature !== desiredSignature) return; // superseded while we waited

  killCurrent('configuration or stream set changed');

  if (!comp.enabled) {
    log.info('composition is switched off — nothing to encode');
    currentSignature = signature;
    return;
  }
  if (sources.length === 0) {
    log.info('no live streams — the encoder stays idle');
    currentSignature = signature;
    state.sources = [];
    state.layout = computeLayout(0, { width: comp.width, height: comp.height, gap: comp.gapPx, layout: comp.layout });
    return;
  }

  // Give MediaMTX a moment to release the previous publisher on the program path.
  await new Promise((r) => setTimeout(r, 250));
  start(sources, comp);
}

function nudge() {
  currentSignature = null;
  desiredSignature = null;
  tick().catch((err) => log.error('nudge failed', err.message));
}

function startLoop() {
  stopping = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    tick().catch((err) => log.error('poll failed', err.message));
  }, config.pollIntervalMs);
  pollTimer.unref();
  tick().catch((err) => log.error('initial poll failed', err.message));
  log.info('watching for streams', { everyMs: config.pollIntervalMs });
}

function stop() {
  stopping = true;
  if (pollTimer) clearInterval(pollTimer);
  if (stabiliseTimer) clearTimeout(stabiliseTimer);
  if (restartTimer) clearTimeout(restartTimer);
  killCurrent('shutdown');
}

function status() {
  const comp = composition();
  return {
    running: state.running,
    enabled: comp.enabled,
    startedAt: state.startedAt,
    encoder: state.encoder,
    restarts: state.restarts,
    lastExit: state.lastExit,
    lastError: state.lastError,
    sources: state.sources,
    layout: state.layout,
    progress: state.progress,
    output: {
      path: config.programPath,
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      bitrateKbps: comp.bitrateKbps,
    },
  };
}

/** What would run for the current configuration, without starting anything. */
function preview(sourcesOverride) {
  const comp = composition();
  const sources = sourcesOverride || state.sources;
  const kind = encoderCaps.resolve(comp.encoder);
  const { args, layout, placed } = buildArgs(sources, comp, kind);
  return {
    encoder: kind,
    layout,
    placed: placed.map((s) => s.key),
    command: `ffmpeg ${args.join(' ')}`,
  };
}

module.exports = { startLoop, stop, nudge, status, preview, buildArgs, selectSources, events, escapeDrawtext };
