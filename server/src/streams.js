'use strict';

/**
 * Stream keys: the things you paste into OBS.
 *
 * A key is both the identity and the secret for an ingest slot, which is what
 * makes OBS setup a two-field job (server URL + key) exactly like every other
 * streaming platform.
 */

const crypto = require('crypto');
const store = require('./store');
const config = require('./config');
const logger = require('./logger');
const mediamtx = require('./mediamtx');
const playability = require('./playability');
const relays = require('./relays');
const auth = require('./auth');

const log = logger.scope('streams');

// Unambiguous alphabet: no 0/O, 1/l/I.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const VISIBILITIES = ['private', 'public'];

/**
 * Deduplicated, existing user ids only, capped the same way relays.js caps
 * the number of restream destinations — a runaway list here is either a
 * mistake or an attempt to bloat the config file, not a real access list.
 */
function cleanSharedWith(value) {
  const ids = Array.isArray(value) ? value : [];
  const unique = [...new Set(ids.map((v) => String(v)))].filter((id) => auth.findById(id));
  if (unique.length > 200) {
    throw Object.assign(new Error('That is more people than one stream will track access for.'), { status: 400 });
  }
  return unique;
}

/**
 * Public, non-secret handle a browser uses to ask for a stream. Viewers must
 * never see the ingest key: it is the publishing credential.
 */
function generatePlaybackId() {
  return crypto.randomBytes(12).toString('hex');
}

function generateKey(length = 20) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * The on-air caption. Separate from `name` on purpose: the name identifies the
 * slot to whoever runs the server ("Camera 1", "Backstage laptop"), while the
 * nickname is what the audience reads, and those are rarely the same words.
 * Kept short because it has to stay legible inside a grid cell.
 */
function cleanNickname(value) {
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  if (text.length > 32) {
    throw Object.assign(new Error('A nickname can be at most 32 characters.'), { status: 400 });
  }
  return text;
}

function isValidKey(key) {
  return /^[A-Za-z0-9_-]{6,64}$/.test(String(key || ''));
}

function list() {
  return store.get().streams.map((s) => ({ ...s }));
}

function find(id) {
  return store.get().streams.find((s) => s.id === id);
}

function findByKey(key) {
  return store.get().streams.find((s) => s.key === key);
}

function create({ name, key, enabled = true, note = '', nickname = '', visibility = 'private', sharedWith = [], ownerId = null }) {
  const label = String(name || '').trim();
  if (!label || label.length > 48) {
    throw Object.assign(new Error('Give the stream a name of 1-48 characters.'), { status: 400 });
  }
  let finalKey = String(key || '').trim() || generateKey();
  if (!isValidKey(finalKey)) {
    throw Object.assign(new Error('A stream key may only contain letters, digits, dashes and underscores (6-64 characters).'), { status: 400 });
  }
  if (findByKey(finalKey)) {
    throw Object.assign(new Error('That stream key is already in use.'), { status: 409 });
  }
  if (!VISIBILITIES.includes(visibility)) {
    throw Object.assign(new Error('Visibility must be "private" or "public".'), { status: 400 });
  }
  if (ownerId && !auth.findById(ownerId)) {
    throw Object.assign(new Error('That owner does not exist.'), { status: 400 });
  }
  const stream = {
    id: crypto.randomUUID(),
    name: label,
    key: finalKey,
    playbackId: generatePlaybackId(),
    nickname: cleanNickname(nickname),
    enabled: !!enabled,
    note: String(note || '').slice(0, 200),
    // Private by default: a stream must be deliberately made public, not
    // accidentally exposed by whatever the default used to be.
    visibility,
    sharedWith: cleanSharedWith(sharedWith),
    // Null for every admin-managed stream created before self-service
    // streamers existed, and for any admin-created stream since — only
    // routes/streamer.js sets this, to the creating streamer's own id.
    ownerId: ownerId || null,
    createdAt: new Date().toISOString(),
  };
  store.update((d) => d.streams.push(stream));
  log.info('stream created', { name: label, key: finalKey, visibility, ownerId: stream.ownerId });
  return { ...stream };
}

function update(id, patch) {
  const stream = find(id);
  if (!stream) throw Object.assign(new Error('No such stream.'), { status: 404 });

  const changes = {};
  if (patch.name !== undefined) {
    const label = String(patch.name).trim();
    if (!label || label.length > 48) throw Object.assign(new Error('Give the stream a name of 1-48 characters.'), { status: 400 });
    changes.name = label;
  }
  if (patch.nickname !== undefined) changes.nickname = cleanNickname(patch.nickname);
  if (patch.note !== undefined) changes.note = String(patch.note).slice(0, 200);
  if (patch.enabled !== undefined) changes.enabled = !!patch.enabled;
  if (patch.visibility !== undefined) {
    if (!VISIBILITIES.includes(patch.visibility)) {
      throw Object.assign(new Error('Visibility must be "private" or "public".'), { status: 400 });
    }
    changes.visibility = patch.visibility;
  }
  if (patch.sharedWith !== undefined) changes.sharedWith = cleanSharedWith(patch.sharedWith);
  if (patch.ownerId !== undefined) {
    const next = patch.ownerId || null;
    if (next && !auth.findById(next)) throw Object.assign(new Error('That owner does not exist.'), { status: 400 });
    changes.ownerId = next;
  }
  if (patch.key !== undefined) {
    const next = String(patch.key).trim();
    if (!isValidKey(next)) throw Object.assign(new Error('A stream key may only contain letters, digits, dashes and underscores (6-64 characters).'), { status: 400 });
    const clash = findByKey(next);
    if (clash && clash.id !== id) throw Object.assign(new Error('That stream key is already in use.'), { status: 409 });
    changes.key = next;
  }

  const oldKey = stream.key;
  store.update(() => Object.assign(stream, changes));

  // Rotating a key or disabling a stream must drop whoever is publishing now.
  if ((changes.key && changes.key !== oldKey) || changes.enabled === false) {
    mediamtx.kickPublisher(`${config.ingestPrefix}/${oldKey}`).catch(() => {});
    // Any destination forwarding this source is reading the old path; point it
    // at the new one now rather than waiting for ffmpeg to notice.
    relays.nudge();
  }
  log.info('stream updated', { id, changes: Object.keys(changes) });
  return { ...stream };
}

function rotateKey(id) {
  return update(id, { key: generateKey() });
}

function remove(id) {
  const stream = find(id);
  if (!stream) throw Object.assign(new Error('No such stream.'), { status: 404 });
  store.update((d) => {
    d.streams = d.streams.filter((s) => s.id !== id);
    d.composition.order = (d.composition.order || []).filter((k) => k !== stream.key);
    // Restream destinations belong to their source. Leaving them behind would
    // keep forwarding a key that has just been handed to somebody else.
    d.relays = (d.relays || []).filter((r) => r.streamId !== id);
    // Channels reference streams by id; a deleted stream just drops out of
    // whatever channels included it rather than leaving a dangling id.
    for (const c of d.channels || []) {
      c.streamIds = (c.streamIds || []).filter((sid) => sid !== id);
    }
  });
  relays.nudge(); // stop anything still forwarding it
  mediamtx.kickPublisher(`${config.ingestPrefix}/${stream.key}`).catch(() => {});
  log.info('stream deleted', { name: stream.name });
}

/** Everything an operator needs to configure OBS for one stream. */
function ingestInfo(stream) {
  const host = config.rtmpHost || (config.publicUrl ? new URL(config.publicUrl).hostname : 'YOUR-SERVER');
  const rtmpPort = config.rtmpPort === 1935 ? '' : `:${config.rtmpPort}`;
  const info = {
    rtmp: { server: `rtmp://${host}${rtmpPort}/${config.ingestPrefix}`, key: stream.key },
  };
  if (config.rtmpsEnabled) {
    info.rtmps = { server: `rtmps://${host}:${config.rtmpsPort}/${config.ingestPrefix}`, key: stream.key };
  }
  if (config.srtEnabled) {
    info.srt = { url: `srt://${host}:${config.srtPort}?streamid=publish:${config.ingestPrefix}/${stream.key}` };
  }
  return info;
}

/** Merge configured streams with what MediaMTX reports as live. */
async function withLiveState() {
  let live = [];
  try {
    live = await mediamtx.listIngest();
  } catch (_) {
    live = [];
  }
  const byKey = new Map(live.map((l) => [l.key, l]));
  const configured = list().map((s) => {
    const l = byKey.get(s.key);
    return {
      ...s,
      live: !!(l && l.ready),
      hasAudio: !!(l && l.tracks && l.tracks.audio),
      tracks: l ? l.tracks.all : [],
      bytesReceived: l ? l.bytesReceived : 0,
      readers: l ? l.readers : 0,
      since: l ? l.readyTime : null,
      source: l ? l.source : null,
      // Whether a browser could play this source directly. Only meaningful
      // while it is publishing; null means "not probed yet".
      playback: l && l.ready ? playability.status(s.key) : null,
      ingest: ingestInfo(s),
    };
  });

  // Anything publishing that we do not have on file (should not happen while
  // the auth hook is enabled, but it makes misconfiguration visible).
  const unknown = live
    .filter((l) => l.ready && !configured.some((s) => s.key === l.key))
    .map((l) => ({ id: null, key: l.key, name: l.key, enabled: true, live: true, unknown: true, tracks: l.tracks.all, hasAudio: !!l.tracks.audio }));

  return [...configured, ...unknown];
}

module.exports = {
  VISIBILITIES,
  generateKey,
  generatePlaybackId,
  isValidKey,
  cleanNickname,
  list,
  find,
  findByKey,
  create,
  update,
  rotateKey,
  remove,
  withLiveState,
  ingestInfo,
};
