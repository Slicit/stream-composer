'use strict';

/**
 * Restreaming: forwarding an ingest source on to somebody else's platform.
 *
 * One source, any number of destinations. Each destination is an independently
 * supervised ffmpeg doing a straight remux — RTSP in from MediaMTX, FLV out
 * over RTMP — with no filtering and no video encode, so the cost is a memcpy
 * and a socket rather than a core. That is the whole point: the composed
 * programme is for the web viewer, and this ships the *individual* streams to
 * Twitch, YouTube or anywhere else that speaks RTMP.
 *
 * Design notes:
 *  - Destinations live in the config file alongside streams and users, so they
 *    survive `docker compose pull && up -d` and are covered by `make backup`.
 *  - A relay follows its source. Nothing is forwarded while the source is not
 *    publishing; when OBS reconnects the relay comes back on its own.
 *  - Failures back off per destination. One rejected stream key must not turn
 *    into an ffmpeg spawned every two seconds for the rest of the day.
 *  - Audio is copied by default. RTMP can only carry AAC, so a source that
 *    publishes anything else (Opus over WebRTC, for instance) gets the
 *    "re-encode to AAC" option — the only transcode this module will ever do,
 *    and it costs about one percent of a core.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');
const store = require('./store');
const mediamtx = require('./mediamtx');

const log = logger.scope('relays');

/**
 * Where the well-known platforms want their RTMP.
 *
 * `url` is only a starting point: every one of these is editable afterwards,
 * because ingest hostnames are regional and do change. The hints are the part
 * that actually saves time — finding the stream key is the step people get
 * stuck on, not typing a URL.
 */
const PROVIDERS = [
  {
    id: 'twitch',
    label: 'Twitch',
    url: 'rtmp://live.twitch.tv/app',
    urlLabel: 'Ingest server',
    urlHint: 'The default hands you to Twitch’s nearest point of presence. Swap in a specific server from the ingest list if you need to pin one.',
    keyLabel: 'Primary stream key',
    keyHint: 'Creator Dashboard → Settings → Stream → Primary Stream key. It begins with live_.',
  },
  {
    id: 'youtube',
    label: 'YouTube Live',
    url: 'rtmp://a.rtmp.youtube.com/live2',
    urlLabel: 'Ingest server',
    urlHint: 'a.rtmp.youtube.com is the primary ingest. Use rtmps://a.rtmps.youtube.com/live2 if outbound 1935 is blocked — that one runs on 443.',
    keyLabel: 'Stream key',
    keyHint: 'YouTube Studio → Go live → Stream settings → Stream key. It looks like abcd-efgh-ijkl-mnop-qrst.',
  },
  {
    id: 'youtube-backup',
    label: 'YouTube Live (backup ingest)',
    url: 'rtmp://b.rtmp.youtube.com/live2?backup=1',
    urlLabel: 'Ingest server',
    urlHint: 'YouTube’s redundant ingest. Add it alongside the primary, with the same key, and YouTube keeps the broadcast up if one path drops.',
    keyLabel: 'Stream key',
    keyHint: 'The same key as the primary ingest.',
  },
  {
    id: 'custom',
    label: 'Custom RTMP',
    url: '',
    urlLabel: 'Server URL',
    urlHint: 'Anything that speaks RTMP: Facebook, Kick, Restream.io, another Stream Composer, your own MediaMTX. rtmp:// or rtmps://.',
    keyLabel: 'Stream key',
    keyHint: 'Appended to the server URL as the final path segment. Leave it empty if the whole address is in the URL above.',
  },
];

const AUDIO_MODES = ['copy', 'aac'];

// relayId -> { proc, relayId, startedAt, progress, sawData }
const running = new Map();
// relayId -> { status, since, restarts, lastError, lastExit, progress, retryInMs }
const health = new Map();

let pollTimer = null;
let stopping = false;

// ------------------------------------------------------------------ helpers

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function rtspBase() {
  const url = new URL(config.mediamtx.rtmp.replace(/^rtmp:/, 'rtsp:'));
  const user = encodeURIComponent(config.mediamtx.internalUser);
  const pass = encodeURIComponent(config.mediamtx.internalPassword || '');
  const creds = config.mediamtx.internalPassword ? `${user}:${pass}@` : '';
  return `rtsp://${creds}${url.hostname}:${config.mediamtx.rtspPort}`;
}

function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

/**
 * Join a server URL and a stream key the way every RTMP platform expects: the
 * key is the last path segment.
 *
 * The query string has to be preserved *after* the key, not before it, because
 * YouTube's backup ingest is `.../live2?backup=1` and appending the key to the
 * end of that would send it the literal key "1".
 */
function destinationUrl(relay) {
  const raw = String((relay && relay.url) || '').trim();
  const key = String((relay && relay.key) || '').trim();
  if (!key) return raw;
  const q = raw.indexOf('?');
  const base = (q < 0 ? raw : raw.slice(0, q)).replace(/\/+$/, '');
  const query = q < 0 ? '' : raw.slice(q);
  return `${base}/${key}${query}`;
}

/**
 * What the operator may safely be shown, and what may safely be logged.
 * A third-party stream key is a publishing credential for somebody else's
 * channel, so it goes nowhere near a log line or a status payload.
 */
function maskKey(key) {
  const value = String(key || '');
  if (!value) return '';
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 3)}${'•'.repeat(6)}${value.slice(-3)}`;
}

function safeUrl(relay) {
  const raw = String((relay && relay.url) || '').trim();
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch (_) {
    return raw;
  }
}

// --------------------------------------------------------------- validation

function cleanUrl(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) throw fail('Give the destination a server URL.');
  if (raw.length > 400) throw fail('That server URL is too long.');
  // Control characters and spaces have no business in a URL and are the shape
  // an injection attempt takes, even though this is spawned without a shell.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) throw fail('The server URL cannot contain spaces or control characters.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw fail('That does not look like a URL. It should start with rtmp:// or rtmps://.');
  }
  if (!['rtmp:', 'rtmps:'].includes(parsed.protocol)) {
    throw fail('A destination must be an rtmp:// or rtmps:// URL.');
  }
  if (!parsed.hostname) throw fail('That URL has no host.');
  return raw;
}

function cleanKey(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return '';
  if (raw.length > 256) throw fail('That stream key is too long.');
  // Printable ASCII only: platform keys are all in this range, and it rules
  // out anything that could smuggle a newline into a log or an argument list.
  if (!/^[\x21-\x7e]+$/.test(raw)) throw fail('A stream key cannot contain spaces or unusual characters.');
  return raw;
}

function cleanName(value, fallbackName) {
  const raw = String(value === undefined || value === null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim();
  if (raw.length > 48) throw fail('A destination name can be at most 48 characters.');
  return raw || fallbackName;
}

// ------------------------------------------------------------------- model

function all() {
  return store.get().relays || [];
}

function find(id) {
  return all().find((r) => r.id === id);
}

function streamFor(relay) {
  return store.get().streams.find((s) => s.id === relay.streamId) || null;
}

function create(body = {}) {
  const stream = store.get().streams.find((s) => s.id === body.streamId);
  if (!stream) throw fail('Pick a source stream to forward.');

  const provider = providerById(body.provider) || providerById('custom');
  const url = cleanUrl(body.url !== undefined && body.url !== '' ? body.url : provider.url);
  const key = cleanKey(body.key);
  const audio = AUDIO_MODES.includes(body.audio) ? body.audio : 'copy';

  if (all().length >= 64) throw fail('That is as many destinations as one server will manage.');

  const relay = {
    id: crypto.randomUUID(),
    streamId: stream.id,
    provider: provider.id,
    name: cleanName(body.name, provider.id === 'custom' ? new URL(url).hostname : provider.label),
    url,
    key,
    audio,
    enabled: body.enabled === undefined ? true : !!body.enabled,
    createdAt: new Date().toISOString(),
  };

  store.update((d) => d.relays.push(relay));
  log.info('destination added', { source: stream.name, provider: relay.provider, url: safeUrl(relay), enabled: relay.enabled });
  nudge();
  return relay;
}

function update(id, patch = {}) {
  const relay = find(id);
  if (!relay) throw fail('No such destination.', 404);

  const changes = {};
  if (patch.provider !== undefined) {
    const provider = providerById(patch.provider);
    if (!provider) throw fail('That provider is not recognised.');
    changes.provider = provider.id;
  }
  if (patch.url !== undefined) changes.url = cleanUrl(patch.url);
  if (patch.key !== undefined) changes.key = cleanKey(patch.key);
  if (patch.audio !== undefined) {
    if (!AUDIO_MODES.includes(patch.audio)) throw fail('Audio must be "copy" or "aac".');
    changes.audio = patch.audio;
  }
  if (patch.name !== undefined) changes.name = cleanName(patch.name, relay.name);
  if (patch.enabled !== undefined) changes.enabled = !!patch.enabled;
  if (patch.streamId !== undefined) {
    const stream = store.get().streams.find((s) => s.id === patch.streamId);
    if (!stream) throw fail('No such source stream.');
    changes.streamId = stream.id;
  }

  store.update(() => Object.assign(relay, changes));

  // Anything that changes where the bytes go has to take effect now, not at
  // the next reconnect — including switching it off.
  const restarts = ['url', 'key', 'audio', 'streamId', 'enabled'];
  if (restarts.some((k) => changes[k] !== undefined)) {
    stopOne(relay.id, 'the destination was changed');
    resetBackoff(relay.id);
  }
  log.info('destination updated', { id, changes: Object.keys(changes) });
  nudge();
  return relay;
}

function remove(id) {
  const relay = find(id);
  if (!relay) throw fail('No such destination.', 404);
  stopOne(id, 'the destination was deleted');
  health.delete(id);
  store.update((d) => {
    d.relays = d.relays.filter((r) => r.id !== id);
  });
  log.info('destination deleted', { name: relay.name, url: safeUrl(relay) });
}

/** The raw key, for the reveal button. Deliberately its own call. */
function revealKey(id) {
  const relay = find(id);
  if (!relay) throw fail('No such destination.', 404);
  return relay.key || '';
}

// ---------------------------------------------------------------- processes

function stateOf(id) {
  let entry = health.get(id);
  if (!entry) {
    entry = { status: 'off', since: null, restarts: 0, lastError: null, lastExit: null, delayMs: 0, retryAt: 0 };
    health.set(id, entry);
  }
  return entry;
}

function resetBackoff(id) {
  const s = stateOf(id);
  s.delayMs = 0;
  s.retryAt = 0;
}

function buildArgs(relay, sourcePath) {
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-thread_queue_size', '1024',
    '-rtsp_transport', 'tcp',
    '-i', `${rtspBase()}/${sourcePath}`,
    // Video is never touched. Audio is optional: a silent camera should still
    // reach the platform rather than failing to start.
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'copy',
  ];
  if (relay.audio === 'aac') {
    args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2');
  } else {
    args.push('-c:a', 'copy');
  }
  args.push(
    '-f', 'flv',
    // FLV wants to rewrite the header with a duration when it finishes. There
    // is no finish here, and the socket is not seekable.
    '-flvflags', 'no_duration_filesize',
    '-progress', 'pipe:1',
    '-nostats',
    destinationUrl(relay),
  );
  return args;
}

/** What ffmpeg would run, with the stream key removed. */
function previewCommand(relay, sourcePath) {
  const args = buildArgs({ ...relay, key: relay.key ? 'STREAM-KEY' : '' }, sourcePath);
  return `ffmpeg ${args.join(' ')}`;
}

function parseProgress(chunk, buffer, entry) {
  const text = buffer + chunk;
  const lines = text.split('\n');
  const rest = lines.pop();
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === 'bitrate') {
      const kb = parseFloat(value);
      entry.progress.bitrateKbps = Number.isFinite(kb) ? Math.round(kb) : 0;
    } else if (key === 'total_size') {
      const bytes = parseInt(value, 10);
      if (Number.isFinite(bytes)) {
        entry.progress.bytesSent = bytes;
        if (bytes > 0) entry.sawData = true;
      }
    } else if (key === 'out_time_ms') {
      entry.progress.uptimeSec = Math.round((parseInt(value, 10) || 0) / 1e6);
    } else if (key === 'drop_frames') {
      entry.progress.droppedFrames = parseInt(value, 10) || 0;
    }
  }
  return rest;
}

function startOne(relay, sourcePath) {
  const args = buildArgs(relay, sourcePath);
  const s = stateOf(relay.id);

  log.info('forwarding started', {
    name: relay.name,
    provider: relay.provider,
    to: safeUrl(relay),
    from: sourcePath,
    audio: relay.audio,
  });

  const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = {
    proc: child,
    relayId: relay.id,
    startedAt: Date.now(),
    sawData: false,
    progress: { bitrateKbps: 0, bytesSent: 0, uptimeSec: 0, droppedFrames: 0 },
  };
  running.set(relay.id, entry);

  s.status = 'connecting';
  s.since = new Date().toISOString();
  s.lastError = null;

  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer = parseProgress(chunk, buffer, entry);
    if (entry.sawData && s.status !== 'live') {
      s.status = 'live';
      // A destination that has actually carried bytes is working; forget any
      // backoff earned by earlier attempts.
      resetBackoff(relay.id);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    // The destination URL contains the stream key and ffmpeg echoes it in
    // errors, so scrub it before anything reaches the log file.
    const text = relay.key ? String(chunk).split(relay.key).join('•••') : String(chunk);
    logger.ffmpeg(`[relay ${relay.name}] ${text}`);
    const trimmed = text.trim();
    if (trimmed) s.lastError = trimmed.split('\n').slice(-1)[0].slice(0, 300);
  });

  child.on('error', (err) => {
    s.lastError = err.message;
    running.delete(relay.id);
    scheduleRetry(relay.id, 'ffmpeg could not be started');
  });

  child.on('exit', (code, signal) => {
    const current = running.get(relay.id);
    if (current && current.proc !== child) return; // already superseded
    running.delete(relay.id);
    s.lastExit = { code, signal, at: new Date().toISOString() };
    if (stopping || signal === 'SIGTERM' || signal === 'SIGKILL') {
      s.status = 'off';
      return;
    }
    log.warn('forwarding stopped', { name: relay.name, to: safeUrl(relay), code, signal });
    scheduleRetry(relay.id, `ffmpeg exited with code ${code}`);
  });
}

function stopOne(id, reason) {
  const entry = running.get(id);
  if (!entry) return;
  running.delete(id);
  const s = stateOf(id);
  s.status = 'off';
  s.since = null;
  log.info('forwarding halted', { id, reason });
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
 * Back off after a failure. A rejected stream key fails instantly and for ever,
 * so without this one typo becomes an ffmpeg every couple of seconds.
 */
function scheduleRetry(id, reason) {
  const s = stateOf(id);
  const settings = store.get().settings;
  s.restarts += 1;
  s.delayMs = s.delayMs
    ? Math.min(s.delayMs * 2, settings.maxRestartDelayMs || 15000)
    : settings.restartDelayMs || 2000;
  s.retryAt = Date.now() + s.delayMs;
  s.status = 'retrying';
  log.debug('will retry a destination', { id, reason, inMs: s.delayMs });
}

// --------------------------------------------------------------------- loop

async function tick() {
  if (stopping) return;
  const relays = all();
  const wanted = relays.filter((r) => r.enabled);

  // Anything running that should not be — switched off, deleted, reassigned.
  for (const id of [...running.keys()]) {
    if (!wanted.some((r) => r.id === id)) stopOne(id, 'no longer wanted');
  }
  for (const id of [...health.keys()]) {
    if (!relays.some((r) => r.id === id)) health.delete(id);
  }
  for (const relay of relays) {
    if (!relay.enabled) {
      const s = stateOf(relay.id);
      s.status = 'off';
      s.since = null;
    }
  }

  if (wanted.length === 0) return;

  let live = [];
  try {
    live = await mediamtx.listIngest();
  } catch (err) {
    log.debug('could not read the stream list', err.message);
    return;
  }
  const liveKeys = new Set(live.filter((l) => l.ready).map((l) => l.key));

  for (const relay of wanted) {
    const stream = streamFor(relay);
    const s = stateOf(relay.id);

    if (!stream || stream.enabled === false) {
      stopOne(relay.id, 'the source stream is unavailable');
      s.status = 'off';
      continue;
    }
    if (!liveKeys.has(stream.key)) {
      // The source is not publishing. That is not a failure, so it must not
      // earn a backoff — OBS reconnecting should resume immediately.
      if (running.has(relay.id)) stopOne(relay.id, 'the source stopped publishing');
      s.status = 'waiting';
      s.since = null;
      resetBackoff(relay.id);
      continue;
    }
    if (running.has(relay.id)) continue;
    if (s.retryAt && Date.now() < s.retryAt) continue;

    startOne(relay, `${config.ingestPrefix}/${stream.key}`);
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
  log.info('watching restream destinations', { destinations: all().length });
}

function stop() {
  stopping = true;
  if (pollTimer) clearInterval(pollTimer);
  for (const id of [...running.keys()]) stopOne(id, 'shutdown');
}

// ------------------------------------------------------------------- status

/**
 * Every destination with its live state, safe to hand to a browser: the stream
 * key is masked, and the URL is stripped of anything after the path.
 */
function withState() {
  const streams = store.get().streams;
  return all().map((relay) => {
    const stream = streams.find((s) => s.id === relay.streamId) || null;
    const s = stateOf(relay.id);
    const entry = running.get(relay.id);
    return {
      id: relay.id,
      streamId: relay.streamId,
      sourceName: stream ? stream.name : null,
      sourceMissing: !stream,
      provider: relay.provider,
      providerLabel: (providerById(relay.provider) || {}).label || relay.provider,
      name: relay.name,
      url: relay.url,
      keyMasked: maskKey(relay.key),
      hasKey: !!relay.key,
      audio: relay.audio,
      enabled: !!relay.enabled,
      createdAt: relay.createdAt,
      status: relay.enabled ? s.status : 'off',
      since: s.since,
      restarts: s.restarts,
      lastError: s.lastError,
      retryInMs: s.status === 'retrying' && s.retryAt ? Math.max(0, s.retryAt - Date.now()) : 0,
      progress: entry ? { ...entry.progress } : { bitrateKbps: 0, bytesSent: 0, uptimeSec: 0, droppedFrames: 0 },
    };
  });
}

/** One line for the Server tab: how many destinations are actually carrying. */
function summary() {
  const relays = all();
  const live = relays.filter((r) => r.enabled && stateOf(r.id).status === 'live').length;
  return { total: relays.length, enabled: relays.filter((r) => r.enabled).length, live };
}

module.exports = {
  PROVIDERS,
  AUDIO_MODES,
  providerById,
  destinationUrl,
  maskKey,
  cleanUrl,
  cleanKey,
  buildArgs,
  previewCommand,
  create,
  update,
  remove,
  find,
  revealKey,
  withState,
  summary,
  startLoop,
  stop,
  nudge,
};
