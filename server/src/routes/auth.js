'use strict';

const express = require('express');
const auth = require('../auth');
const logger = require('../logger');

const log = logger.scope('login');
const router = express.Router();

// Simple in-memory throttle: slows down credential stuffing without adding a
// dependency or persisting anything.
const attempts = new Map();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function clientKey(req) {
  return req.ip || req.connection.remoteAddress || 'unknown';
}

function tooManyAttempts(req) {
  const now = Date.now();
  const entry = attempts.get(clientKey(req));
  if (!entry) return false;
  if (now - entry.first > WINDOW_MS) {
    attempts.delete(clientKey(req));
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(req) {
  const key = clientKey(req);
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) attempts.set(key, { first: now, count: 1 });
  else entry.count += 1;
  if (attempts.size > 5000) attempts.clear();
}

router.post('/login', express.json(), express.urlencoded({ extended: false }), (req, res) => {
  if (tooManyAttempts(req)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
  }
  const { username, password } = req.body || {};
  const user = auth.authenticate(username, password);
  if (!user) {
    recordFailure(req);
    log.warn('failed sign-in', { username: String(username || '').slice(0, 40), ip: clientKey(req) });
    return res.status(401).json({ error: 'That username and password do not match.' });
  }
  attempts.delete(clientKey(req));
  auth.setSessionCookie(res, auth.issueToken(user.id));
  log.info('signed in', { username: user.username, role: user.role });
  return res.json({ user });
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

router.post('/me/password', express.json(), (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  const { currentPassword, newPassword } = req.body || {};
  const full = auth.findById(req.user.id);
  if (!full || !auth.verifyPassword(currentPassword, full.salt, full.hash)) {
    return res.status(403).json({ error: 'Your current password is not correct.' });
  }
  try {
    auth.setPassword(req.user.id, newPassword);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
