'use strict';

/**
 * MediaMTX external authentication hook.
 *
 * MediaMTX is configured with `authMethod: http` pointing here, so every
 * publish/read decision is made against the live configuration — new stream
 * keys work immediately with no media-server restart.
 *
 * Contract: 200 = allow, 401 = deny.
 */

const express = require('express');
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

function isInternal(body) {
  if (!config.mediamtx.internalPassword) return false;
  return body.user === config.mediamtx.internalUser && body.password === config.mediamtx.internalPassword;
}

function decide(body) {
  const action = String(body.action || '');
  const path = String(body.path || '').replace(/^\/+/, '');
  const prefix = `${config.ingestPrefix}/`;

  if (isInternal(body)) return { allow: true, reason: 'internal' };

  if (action === 'publish') {
    if (path === config.programPath) return { allow: false, reason: 'the program path is written by the compositor only' };
    if (!path.startsWith(prefix)) return { allow: false, reason: `publish to "${config.ingestPrefix}/<stream key>"` };
    const key = path.slice(prefix.length);
    if (key.includes('/')) return { allow: false, reason: 'nested paths are not allowed' };
    const stream = streams.findByKey(key);
    if (!stream) return { allow: false, reason: 'unknown stream key' };
    if (stream.enabled === false) return { allow: false, reason: 'stream is disabled' };
    return { allow: true, reason: 'valid stream key' };
  }

  if (action === 'read') {
    // Playback ports are not published to the internet; the browser reaches
    // them through the authenticated proxy in this same process. So a read
    // request here has already passed viewer authentication.
    if (path === config.programPath) return { allow: true, reason: 'program' };
    if (path.startsWith(prefix)) {
      const key = path.slice(prefix.length).split('/')[0];
      const stream = streams.findByKey(key);
      if (stream && stream.enabled !== false) return { allow: true, reason: 'ingest preview' };
      return { allow: false, reason: 'unknown or disabled stream key' };
    }
    return { allow: false, reason: 'unknown path' };
  }

  return { allow: false, reason: `action "${action}" is not permitted` };
}

router.post('/mediamtx/auth', express.json({ limit: '16kb' }), (req, res) => {
  const body = req.body || {};
  let verdict;
  try {
    verdict = decide(body);
  } catch (err) {
    log.error('hook failed', err.message);
    return res.status(401).json({ error: 'internal error' });
  }
  if (verdict.allow) {
    if (body.action === 'publish') {
      log.info('publisher accepted', { path: body.path, ip: body.ip, protocol: body.protocol });
    } else {
      log.debug('allowed', { action: body.action, path: body.path });
    }
    return res.status(200).end();
  }
  logDenial(verdict.reason, body);
  return res.status(401).json({ error: verdict.reason });
});

module.exports = { router, decide };

// Keep the store reachable for tests that stub it.
module.exports.store = store;
