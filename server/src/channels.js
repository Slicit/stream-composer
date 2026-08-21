'use strict';

/**
 * Channels: a named, sluggable, curated list of streams any logged-in user
 * may own. Always browser-composed — see docs/ARCHITECTURE.md, "Channels".
 * A channel is a viewing surface, not an encoder: the layout is computed by
 * the same layout.js every other browser-composed grid uses, and every
 * source is fetched by the viewer's own browser over WHEP. This is what
 * makes it safe for any user to create any number of them.
 *
 * Ownership and sharing follow the exact same shape as a stream's
 * (`visibility` + `sharedWith`), checked by the one shared rule in
 * access.js, plus `ownerId` (streams have no owner; channels do).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const config = require('./config');
const logger = require('./logger');
const auth = require('./auth');
const access = require('./access');

const log = logger.scope('channels');

const VISIBILITIES = ['private', 'public'];
const IMAGE_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// ------------------------------------------------------------------ slugs

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function isValidSlug(slug) {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(String(slug || ''));
}

/** The base slug with `-2`, `-3`, ... appended until it is free. */
function uniqueSlug(base, excludeId) {
  const root = slugify(base) || 'channel';
  let candidate = root;
  let n = 2;
  while (findBySlug(candidate, excludeId)) {
    const suffix = `-${n}`;
    candidate = `${root.slice(0, 64 - suffix.length)}${suffix}`;
    n += 1;
  }
  return candidate;
}

// ------------------------------------------------------------------- model

function list() {
  return store.get().channels.map((c) => ({ ...c }));
}

function find(id) {
  return store.get().channels.find((c) => c.id === id);
}

function findBySlug(slug, excludeId) {
  const needle = String(slug || '').toLowerCase();
  return store.get().channels.find((c) => c.slug === needle && c.id !== excludeId);
}

function cleanName(value) {
  const label = String(value === undefined || value === null ? '' : value).trim();
  if (!label || label.length > 48) throw fail('Give the channel a name of 1-48 characters.');
  return label;
}

function cleanStreamIds(value) {
  const ids = Array.isArray(value) ? value : [];
  const streams = store.get().streams;
  const unique = [...new Set(ids.map((v) => String(v)))].filter((id) => streams.some((s) => s.id === id));
  if (unique.length > 64) throw fail('That is as many sources as one channel will compose.');
  return unique;
}

function cleanSharedWith(value) {
  const ids = Array.isArray(value) ? value : [];
  const unique = [...new Set(ids.map((v) => String(v)))].filter((id) => auth.findById(id));
  if (unique.length > 200) throw fail('That is more people than one channel will track access for.');
  return unique;
}

function create({ name, slug, visibility = 'private', ownerId, streamIds = [], sharedWith = [] }) {
  if (!ownerId || !auth.findById(ownerId)) throw fail('A channel needs a valid owner.');
  const label = cleanName(name);
  if (!VISIBILITIES.includes(visibility)) throw fail('Visibility must be "private" or "public".');

  let finalSlug;
  if (slug !== undefined && slug !== null && String(slug).trim() !== '') {
    finalSlug = String(slug).trim().toLowerCase();
    if (!isValidSlug(finalSlug)) {
      throw fail('A slug may only contain lowercase letters, digits and dashes (2-64 characters), and cannot start or end with a dash.');
    }
    if (findBySlug(finalSlug)) throw fail('That slug is already in use.', 409);
  } else {
    finalSlug = uniqueSlug(label);
  }

  const channel = {
    id: crypto.randomUUID(),
    name: label,
    slug: finalSlug,
    visibility,
    ownerId,
    backgroundImage: '',
    streamIds: cleanStreamIds(streamIds),
    sharedWith: cleanSharedWith(sharedWith),
    createdAt: new Date().toISOString(),
  };
  store.update((d) => d.channels.push(channel));
  log.info('channel created', { name: label, slug: finalSlug, ownerId, visibility });
  return { ...channel };
}

function update(id, patch = {}) {
  const channel = find(id);
  if (!channel) throw fail('No such channel.', 404);

  const changes = {};
  if (patch.name !== undefined) changes.name = cleanName(patch.name);
  if (patch.visibility !== undefined) {
    if (!VISIBILITIES.includes(patch.visibility)) throw fail('Visibility must be "private" or "public".');
    changes.visibility = patch.visibility;
  }
  if (patch.streamIds !== undefined) changes.streamIds = cleanStreamIds(patch.streamIds);
  if (patch.sharedWith !== undefined) changes.sharedWith = cleanSharedWith(patch.sharedWith);
  if (patch.slug !== undefined) {
    const next = String(patch.slug).trim().toLowerCase();
    if (!isValidSlug(next)) {
      throw fail('A slug may only contain lowercase letters, digits and dashes (2-64 characters), and cannot start or end with a dash.');
    }
    if (findBySlug(next, id)) throw fail('That slug is already in use.', 409);
    changes.slug = next;
  }

  store.update(() => Object.assign(channel, changes));
  log.info('channel updated', { id, changes: Object.keys(changes) });
  return { ...channel };
}

/** The raw file on disk for a channel's background image, if it has one. */
function backgroundImagePath(channel) {
  if (!channel.backgroundImage) return null;
  return path.join(config.dataDir, channel.backgroundImage.replace(/^\/uploads\//, ''));
}

function removeBackgroundImageFile(channel) {
  const filePath = backgroundImagePath(channel);
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_) {
    /* already gone, or never existed */
  }
}

/**
 * Store an uploaded background image. Takes the raw bytes and the
 * `Content-Type` the client sent — no multipart parsing, no new dependency,
 * just express.raw() handing us a Buffer directly (see routes/channels.js).
 */
function setBackgroundImage(id, buffer, mimeType) {
  const channel = find(id);
  if (!channel) throw fail('No such channel.', 404);
  const ext = IMAGE_EXTENSIONS[mimeType];
  if (!ext) throw fail('Background images must be PNG, JPEG, WebP or GIF.');
  if (!buffer || buffer.length === 0) throw fail('The uploaded file was empty.');
  if (buffer.length > 5 * 1024 * 1024) throw fail('Background images must be 5MB or smaller.');

  removeBackgroundImageFile(channel);
  fs.mkdirSync(config.channelBackgroundsDir, { recursive: true });
  const fileName = `${channel.id}.${ext}`;
  fs.writeFileSync(path.join(config.channelBackgroundsDir, fileName), buffer, { mode: 0o600 });

  const url = `/uploads/channel-backgrounds/${fileName}`;
  store.update(() => {
    channel.backgroundImage = url;
  });
  log.info('channel background image set', { id, mimeType, bytes: buffer.length });
  return { ...channel };
}

function remove(id) {
  const channel = find(id);
  if (!channel) throw fail('No such channel.', 404);
  removeBackgroundImageFile(channel);
  store.update((d) => {
    d.channels = d.channels.filter((c) => c.id !== id);
    // A deleted homepage channel must not leave "/" redirecting nowhere.
    if (d.settings.homepageChannelId === id) d.settings.homepageChannelId = null;
  });
  log.info('channel deleted', { name: channel.name, slug: channel.slug });
}

// --------------------------------------------------------------- homepage

function setHomepage(id) {
  const channel = find(id);
  if (!channel) throw fail('No such channel.', 404);
  store.update((d) => {
    d.settings.homepageChannelId = id;
  });
  log.info('homepage channel set', { id, slug: channel.slug });
  return { ...channel };
}

function clearHomepage() {
  store.update((d) => {
    d.settings.homepageChannelId = null;
  });
  log.info('homepage channel cleared');
}

function homepageChannel() {
  const id = store.get().settings.homepageChannelId;
  return id ? find(id) || null : null;
}

// ------------------------------------------------------------------ access

/**
 * Gate for viewing a channel by slug (`GET /c/:slug` and the channel-state
 * API). 404, not 403, on denial — the same "do not confirm a private
 * channel exists" posture the media proxy already uses for stream playback
 * ids (see proxy.js).
 */
function requireChannelAccess(req, res, next) {
  const channel = findBySlug(req.params.slug);
  if (!channel || !access.canAccess(channel, req.user)) {
    if (req.accepts(['html', 'json']) === 'html') return res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    return res.status(404).json({ error: 'No such channel.' });
  }
  req.channel = channel;
  return next();
}

module.exports = {
  VISIBILITIES,
  slugify,
  isValidSlug,
  uniqueSlug,
  list,
  find,
  findBySlug,
  create,
  update,
  remove,
  setBackgroundImage,
  setHomepage,
  clearHomepage,
  homepageChannel,
  requireChannelAccess,
};
