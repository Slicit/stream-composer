'use strict';

/**
 * Users, password hashing (scrypt) and stateless signed-cookie sessions.
 * No external dependencies — everything comes from node:crypto.
 */

const crypto = require('crypto');
const store = require('./store');
const config = require('./config');
const logger = require('./logger');

const log = logger.scope('auth');

const COOKIE = 'sc_session';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ---------------------------------------------------------------- passwords

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  try {
    const { hash } = hashPassword(password, salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function passwordProblems(password) {
  const issues = [];
  if (typeof password !== 'string' || password.length < 8) issues.push('must be at least 8 characters');
  if (/^\s|\s$/.test(password || '')) issues.push('must not start or end with whitespace');
  return issues;
}

// ------------------------------------------------------------------- users

function listUsers() {
  return store.get().users.map(publicUser);
}

const ROLES = ['admin', 'viewer', 'streamer'];

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    // Meaningless outside role "streamer", but harmless to include — it is
    // only ever consulted (streamer.js) after the role check has already run.
    streamQuota: u.streamQuota || 0,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
  };
}

function findByUsername(username) {
  const needle = String(username || '').trim().toLowerCase();
  return store.get().users.find((u) => u.username.toLowerCase() === needle);
}

function findById(id) {
  return store.get().users.find((u) => u.id === id);
}

function cleanStreamQuota(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1000, Math.round(n));
}

function createUser({ username, password, role = 'viewer', streamQuota = 0 }) {
  const name = String(username || '').trim();
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(name)) {
    throw Object.assign(new Error('Username must be 2-32 characters: letters, digits, dot, dash or underscore.'), { status: 400 });
  }
  if (findByUsername(name)) {
    throw Object.assign(new Error('That username is already taken.'), { status: 409 });
  }
  const issues = passwordProblems(password);
  if (issues.length) {
    throw Object.assign(new Error(`Password ${issues.join(' and ')}.`), { status: 400 });
  }
  if (!ROLES.includes(role)) {
    throw Object.assign(new Error('Role must be admin, viewer or streamer.'), { status: 400 });
  }
  const { salt, hash } = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username: name,
    role,
    // How many streams this account may register through self-service
    // (routes/streamer.js). Zero by default — a streamer account is only
    // useful once an admin explicitly grants it a quota, not the moment
    // it is created.
    streamQuota: cleanStreamQuota(streamQuota),
    salt,
    hash,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  store.update((d) => d.users.push(user));
  log.info('user created', { username: name, role, streamQuota: user.streamQuota });
  return publicUser(user);
}

function setPassword(id, password) {
  const issues = passwordProblems(password);
  if (issues.length) throw Object.assign(new Error(`Password ${issues.join(' and ')}.`), { status: 400 });
  const user = findById(id);
  if (!user) throw Object.assign(new Error('No such user.'), { status: 404 });
  const { salt, hash } = hashPassword(password);
  store.update(() => {
    user.salt = salt;
    user.hash = hash;
    user.passwordChangedAt = new Date().toISOString();
  });
  log.info('password changed', { username: user.username });
  return publicUser(user);
}

function setRole(id, role) {
  if (!ROLES.includes(role)) throw Object.assign(new Error('Role must be admin, viewer or streamer.'), { status: 400 });
  const user = findById(id);
  if (!user) throw Object.assign(new Error('No such user.'), { status: 404 });
  const admins = store.get().users.filter((u) => u.role === 'admin');
  if (user.role === 'admin' && role !== 'admin' && admins.length <= 1) {
    throw Object.assign(new Error('This is the last administrator — promote someone else first.'), { status: 409 });
  }
  store.update(() => {
    user.role = role;
  });
  return publicUser(user);
}

/** How many streams a streamer account may register through self-service. */
function setStreamQuota(id, quota) {
  const user = findById(id);
  if (!user) throw Object.assign(new Error('No such user.'), { status: 404 });
  store.update(() => {
    user.streamQuota = cleanStreamQuota(quota);
  });
  return publicUser(user);
}

function deleteUser(id) {
  const user = findById(id);
  if (!user) throw Object.assign(new Error('No such user.'), { status: 404 });
  const admins = store.get().users.filter((u) => u.role === 'admin');
  if (user.role === 'admin' && admins.length <= 1) {
    throw Object.assign(new Error('This is the last administrator — create another one first.'), { status: 409 });
  }
  store.update((d) => {
    d.users = d.users.filter((u) => u.id !== id);
  });
  log.info('user deleted', { username: user.username });
}

function authenticate(username, password) {
  const user = findByUsername(username);
  if (!user) {
    // Constant-ish work so a missing user is not obviously faster than a wrong password.
    hashPassword(String(password || ''), 'decoy-salt');
    return null;
  }
  if (!verifyPassword(password, user.salt, user.hash)) return null;
  store.update(() => {
    user.lastLoginAt = new Date().toISOString();
  });
  return publicUser(user);
}

/** Create the bootstrap administrator on first boot. */
function ensureBootstrapAdmin() {
  const d = store.get();
  if (d.users.length > 0) return null;

  let password = config.adminPassword;
  let generated = false;
  if (!password || passwordProblems(password).length) {
    password = crypto.randomBytes(12).toString('base64url');
    generated = true;
  }
  let username = String(config.adminUser || 'admin').trim();
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(username)) {
    log.warn(`ADMIN_USER "${username}" is not a valid username — using "admin" instead`);
    username = 'admin';
  }
  const user = createUser({ username, password, role: 'admin' });
  if (generated) {
    const banner = [
      '',
      '  ┌────────────────────────────────────────────────────────────┐',
      '  │  Stream Composer — initial administrator account created   │',
      '  └────────────────────────────────────────────────────────────┘',
      `     username: ${user.username}`,
      `     password: ${password}`,
      '',
      '  Set ADMIN_PASSWORD in your .env to choose your own, or change',
      '  it from Admin → Users after signing in. This is shown once.',
      '',
    ].join('\n');
    process.stdout.write(`${banner}\n`);
    log.warn('generated a random administrator password — see stdout, it is not written to the log file');
  }
  return user;
}

// ---------------------------------------------------------------- sessions

function secret() {
  return store.get().secrets.sessionSecret;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function issueToken(userId) {
  const exp = Date.now() + config.sessionTtlHours * 3600 * 1000;
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.', 2);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!body.exp || body.exp < Date.now()) return null;
    return body;
  } catch (_) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch (_) {
      // A malformed cookie from anywhere on the domain must not 500 the site.
      out[name] = raw;
    }
  }
  return out;
}

function setSessionCookie(res, token) {
  const attrs = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${config.sessionTtlHours * 3600}`,
  ];
  if (config.secureCookies) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Populates req.user when a valid session cookie is present. */
function attachUser(req, _res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const body = readToken(cookies[COOKIE]);
  if (body) {
    const user = findById(body.uid);
    if (user) req.user = publicUser(user);
  }
  next();
}

function requireUser(req, res, next) {
  if (req.user) return next();
  if (req.accepts(['html', 'json']) === 'html') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  return res.status(401).json({ error: 'Sign in to continue.' });
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (!req.user) return requireUser(req, res, next);
  return res.status(403).json({ error: 'Administrator access is required.' });
}

/** routes/streamer.js: self-service stream/restream management. */
function requireStreamerOrAdmin(req, res, next) {
  if (req.user && (req.user.role === 'streamer' || req.user.role === 'admin')) return next();
  if (!req.user) return requireUser(req, res, next);
  return res.status(403).json({ error: 'Streamer access is required.' });
}

/** Viewers may be allowed through without a session when public viewing is on. */
function requireViewAccess(req, res, next) {
  if (store.get().settings.publicViewing) return next();
  return requireUser(req, res, next);
}

module.exports = {
  ROLES,
  COOKIE,
  hashPassword,
  verifyPassword,
  passwordProblems,
  listUsers,
  publicUser,
  findById,
  findByUsername,
  createUser,
  setPassword,
  setRole,
  setStreamQuota,
  deleteUser,
  authenticate,
  ensureBootstrapAdmin,
  issueToken,
  readToken,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireUser,
  requireAdmin,
  requireStreamerOrAdmin,
  requireViewAccess,
};
