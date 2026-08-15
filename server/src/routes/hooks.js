'use strict';

/**
 * MediaMTX external authentication hook.
 *
 * MediaMTX is configured with `authMethod: http` pointing here, so every
 * publish/read decision is made against the live configuration — new stream
 * keys work immediately with no media-server restart.
 *
 * Contract: 200 = allow, 401 = deny.
 *
 * Reads require the stack-internal credential
 * -------------------------------------------
 * An earlier version allowed any read of a known path, on the assumption that
 * playback could only arrive through the authenticated proxy. That assumption
 * was wrong: the RTMP and SRT listeners are published to the internet and serve
 * *reads* as well as publishes, so `ffmpeg -i rtmp://host/program` bypassed
 * viewer authentication completely. Reads are now allowed only for the
 * compositor and the proxy, both of which present the internal credential.
 */

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const store = require('../store');
const streams = require('../streams');
const logger = require('../logger');

const log = logger.scope('auth-hook');

const router = express.Router();

// Rate-limit noisy denials so a scanner cannot fill the disk with log lines.
const denyLog = new Map();
function logDenial(reason, body) {
  const key = `${body.action}:${body.path}:${reason}`;
  const now = Date.now();
  const last = denyLog.get(key) || 0;
  if (now - last < 10000) return;
  denyLog.set(key, now);
  if (denyLog.size > 500) denyLog.clear();
  log.warn('denied', { reason, action: body.action, path: body.path, ip: body.ip, protocol: body.protocol });
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isInternal(body) {
  if (!config.mediamtx.internalPassword) return false;
  return safeEqual(body.user, config.mediamtx.internalUser) && safeEqual(body.password, config.mediamtx.internalPassword);
}

function decide(body) {
  const action = String(body.action || '');
  const path = String(body.path || '').replace(/^\/+/, '');
  const prefix = `${config.ingestPrefix}/`;
  const internal = isInternal(body);

  if (action === 'publish') {
    // Only the compositor may write the programme, and it authenticates.
    if (path === config.programPath) {
      return internal
        ? { allow: true, reason: 'compositor' }
        : { allow: false, reason: 'the program path is written by the compositor only' };
    }
    if (!path.startsWith(prefix)) return { allow: false, reason: `publish to "${config.ingestPrefix}/<stream key>"` };
    const key = path.slice(prefix.length);
    if (key.includes('/')) return { allow: false, reason: 'nested paths are not allowed' };
    const stream = streams.findByKey(key);
    if (!stream) return { allow: false, reason: 'unknown stream key' };
    if (stream.enabled === false) return { allow: false, reason: 'stream is disabled' };
    return { allow: true, reason: 'valid stream key' };
  }

  if (action === 'read') {
    // Playback is authorised by the composer, which then reads on the viewer's
    // behalf holding the internal credential. A read presented without it is
    // someone talking to the ingest ports directly.
    if (!internal) return { allow: false, reason: 'reads require the internal credential' };
    if (path === config.programPath) return { allow: true, reason: 'programme' };
    if (path.startsWith(prefix)) {
      const key = path.slice(prefix.length).split('/')[0];
      const stream = streams.findByKey(key);
      if (stream && stream.enabled !== false) return { allow: true, reason: 'ingest preview' };
      return { allow: false, reason: 'unknown or disabled stream key' };
    }
    return { allow: false, reason: 'unknown path' };
  }

  if (internal) return { allow: true, reason: 'internal' };
  return { allow: false, reason: `action "${action}" is not permitted` };
}

/**
 * The hook path carries a shared secret.
 *
 * `privateNetworkOnly` alone is not enough: behind Traefik every request
 * arrives from the container network, so a source-address check passes for
 * traffic from the internet too. MediaMTX cannot send custom headers to the
 * auth backend, so the secret travels in the URL — which is only ever seen on
 * the internal container network, never by a browser.
 */
function verifyHookToken(req, res, next) {
  const expected = config.mediamtx.internalPassword;
  if (!expected) {
    log.error('MEDIAMTX_INTERNAL_PASSWORD is not set — refusing every authentication request');
    return res.status(401).json({ error: 'not configured' });
  }
  if (!safeEqual(req.params.token, expected)) {
    log.warn('rejected an authentication call with a bad token', { ip: req.ip });
    return res.status(404).json({ error: 'Not found.' });
  }
  return next();
}

function handle(req, res) {
  const body = req.body || {};
  let verdict;
  try {
    verdict = decide(body);
  } catch (err) {
    log.error('hook failed', err.message);
    return res.status(401).json({ error: 'internal error' });
  }
  if (verdict.allow) {
    if (body.action === 'publish' && verdict.reason !== 'compositor') {
      log.info('publisher accepted', { path: body.path, ip: body.ip, protocol: body.protocol });
    } else {
      log.debug('allowed', { action: body.action, path: body.path });
    }
    return res.status(200).end();
  }
  logDenial(verdict.reason, body);
  return res.status(401).json({ error: verdict.reason });
}

router.post('/:token/mediamtx/auth', verifyHookToken, express.json({ limit: '16kb' }), handle);

module.exports = { router, decide };
module.exports.store = store;
