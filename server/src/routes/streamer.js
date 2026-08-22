'use strict';

/**
 * Self-service for the "streamer" role: registering and managing their own
 * streams (up to a quota an admin sets per account) and restream
 * destinations for those streams — the same underlying streams.js/relays.js
 * functions the admin API uses, scoped to what the caller owns.
 *
 * Both sub-routers below carry their own auth.requireStreamerOrAdmin guard
 * and are mounted at their own specific prefix (/streams/mine, /relays/mine)
 * rather than applied as a blanket router.use() on the whole /api mount —
 * a blanket guard here would intercept every /api/* request that reaches
 * this file, including /api/state and /api/admin/*, before they ever reach
 * their real handlers. See routes/channels.js's "mine" sub-router for the
 * established precedent this mirrors.
 *
 * An admin hitting these sees only streams/relays *they personally created*
 * through this same self-service path, not everything — exactly like
 * routes/channels.js's "/channels/mine", which never became "show
 * everything when the caller is an admin" either. Admins already have the
 * unrestricted view at /api/admin/*.
 */

const express = require('express');
const auth = require('../auth');
const streams = require('../streams');
const relays = require('../relays');
const access = require('../access');
const config = require('../config');

const router = express.Router();

function fail(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Something went wrong.' });
}

/** The caller's own stream, or throws 404/403 — never reveals whether an id exists otherwise. */
function ownStream(id, user) {
  return access.requireOwner(streams.find(id), user);
}

/** Same, for a relay — ownership follows the stream it forwards, not the relay itself. */
function ownRelay(id, user) {
  const relay = relays.find(id);
  if (!relay) throw Object.assign(new Error('No such destination.'), { status: 404 });
  access.requireOwner(streams.find(relay.streamId), user);
  return relay;
}

// ------------------------------------------------------------------ streams

const streamsMine = express.Router();
streamsMine.use(auth.requireStreamerOrAdmin);
streamsMine.use(express.json({ limit: '64kb' }));

streamsMine.get('/', async (req, res) => {
  try {
    const all = await streams.withLiveState();
    const mine = all.filter((s) => s.ownerId === req.user.id);
    res.json({ streams: mine, quota: req.user.streamQuota });
  } catch (err) {
    fail(res, err);
  }
});

streamsMine.post('/', (req, res) => {
  try {
    // Admins get the same unlimited allowance here as at /api/admin/streams —
    // a quota is a constraint an admin places on *other* accounts, not a
    // ceiling that would apply to themselves through a side door.
    if (req.user.role !== 'admin') {
      const owned = streams.list().filter((s) => s.ownerId === req.user.id).length;
      if (owned >= req.user.streamQuota) {
        throw Object.assign(new Error(`You have reached your limit of ${req.user.streamQuota} stream(s). Ask an admin to raise it.`), { status: 403 });
      }
    }
    const body = req.body || {};
    const stream = streams.create({ name: body.name, key: body.key, nickname: body.nickname, visibility: body.visibility, ownerId: req.user.id });
    res.status(201).json({ stream: { ...stream, ingest: streams.ingestInfo(stream) } });
  } catch (err) {
    fail(res, err);
  }
});

streamsMine.patch('/:id', (req, res) => {
  try {
    ownStream(req.params.id, req.user);
    const body = req.body || {};
    // Deliberately not forwarded wholesale: sharedWith (needs a user picker
    // a streamer has no access to) and ownerId/key stay admin- or
    // rotate-key-only. This is the same allowlist-not-blocklist shape
    // routes/channels.js already uses for its own owner-facing PATCH.
    const patch = {};
    for (const field of ['name', 'nickname', 'visibility', 'enabled', 'note']) {
      if (body[field] !== undefined) patch[field] = body[field];
    }
    const stream = streams.update(req.params.id, patch);
    res.json({ stream: { ...stream, ingest: streams.ingestInfo(stream) } });
  } catch (err) {
    fail(res, err);
  }
});

streamsMine.post('/:id/rotate-key', (req, res) => {
  try {
    ownStream(req.params.id, req.user);
    const stream = streams.rotateKey(req.params.id);
    res.json({ stream: { ...stream, ingest: streams.ingestInfo(stream) } });
  } catch (err) {
    fail(res, err);
  }
});

streamsMine.delete('/:id', (req, res) => {
  try {
    ownStream(req.params.id, req.user);
    streams.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.use('/streams/mine', streamsMine);

// ------------------------------------------------------------------- relays

const relaysMine = express.Router();
relaysMine.use(auth.requireStreamerOrAdmin);
relaysMine.use(express.json({ limit: '64kb' }));

relaysMine.get('/', (req, res) => {
  const mineStreamIds = new Set(streams.list().filter((s) => s.ownerId === req.user.id).map((s) => s.id));
  res.json({
    relays: relays.withState().filter((r) => mineStreamIds.has(r.streamId)),
    providers: relays.PROVIDERS,
    sources: streams.list().filter((s) => s.ownerId === req.user.id).map((s) => ({ id: s.id, name: s.name, enabled: s.enabled })),
  });
});

relaysMine.post('/', (req, res) => {
  try {
    const body = req.body || {};
    ownStream(body.streamId, req.user); // the destination's source must already be one of the caller's own streams
    const relay = relays.create(body);
    res.status(201).json({ relay: relays.withState().find((r) => r.id === relay.id) });
  } catch (err) {
    fail(res, err);
  }
});

relaysMine.patch('/:id', (req, res) => {
  try {
    ownRelay(req.params.id, req.user);
    const body = req.body || {};
    if (body.streamId !== undefined) ownStream(body.streamId, req.user); // no reassigning a destination onto someone else's stream
    const relay = relays.update(req.params.id, body);
    res.json({ relay: relays.withState().find((r) => r.id === relay.id) });
  } catch (err) {
    fail(res, err);
  }
});

relaysMine.delete('/:id', (req, res) => {
  try {
    ownRelay(req.params.id, req.user);
    relays.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

relaysMine.get('/:id/key', (req, res) => {
  try {
    ownRelay(req.params.id, req.user);
    res.json({ key: relays.revealKey(req.params.id) });
  } catch (err) {
    fail(res, err);
  }
});

relaysMine.get('/:id/command', (req, res) => {
  try {
    const relay = ownRelay(req.params.id, req.user);
    const stream = streams.find(relay.streamId);
    const sourcePath = `${config.ingestPrefix}/${stream ? stream.key : 'SOURCE-KEY'}`;
    res.json({ command: relays.previewCommand(relay, sourcePath) });
  } catch (err) {
    fail(res, err);
  }
});

router.use('/relays/mine', relaysMine);

module.exports = router;
