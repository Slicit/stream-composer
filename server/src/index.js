'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const logger = require('./logger');
const store = require('./store');
const auth = require('./auth');
const encoder = require('./encoder');
const mediamtx = require('./mediamtx');
const compositor = require('./compositor');
const relays = require('./relays');
const proxy = require('./proxy');

const log = logger.scope('server');

const app = express();
app.disable('x-powered-by');
// `trust proxy` decides whether req.ip comes from X-Forwarded-For. Trusting it
// unconditionally lets any client forge its own address and slip past the
// sign-in throttle, so this is off unless TRUST_PROXY says how many hops to
// trust (the TLS overlay sets 1 for Traefik).
if (config.trustProxy) app.set('trust proxy', config.trustProxy === true ? 1 : config.trustProxy);

// --------------------------------------------------------------- middleware

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(auth.attachUser);

// ------------------------------------------------------------------- health

app.get('/healthz', (_req, res) => {
  const status = compositor.status();
  res.json({
    ok: true,
    version: config.version,
    mediamtx: mediamtx.health().reachable,
    encoding: status.running,
    onAir: status.sources.length,
  });
});

// --------------------------------------------------- MediaMTX auth hook

/**
 * Defence in depth for the hook. The shared secret in the URL (checked in the
 * route) is the real control, because behind Traefik every request arrives from
 * the container network and a source-address test would pass for internet
 * traffic too. This still blocks the obvious case of a directly exposed port.
 */
function privateNetworkOnly(req, res, next) {
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const isPrivate =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^f[cd]/i.test(ip);
  if (isPrivate) return next();
  log.warn('rejected an external call to an internal endpoint', { ip, path: req.originalUrl });
  return res.status(403).json({ error: 'Not available.' });
}

app.use('/internal', privateNetworkOnly, require('./routes/hooks').router);

// Nothing else lives under /internal.
app.use('/internal', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// -------------------------------------------------------------------- auth

app.use('/api/auth', require('./routes/auth'));

// ------------------------------------------------------------ media proxy

proxy.mount(app, auth.requireViewAccessApi);

// ----------------------------------------------------------------- admin API
// Mounted before the viewer API so administration never inherits the
// "public viewing" relaxation.

app.use('/api/admin', auth.requireAdmin, require('./routes/admin'));

// ---------------------------------------------------------------- viewer API

app.use('/api', auth.requireViewAccess, require('./routes/api'));

// ------------------------------------------------------------------- pages

const publicDir = path.join(__dirname, '..', 'public');

// hls.js is vendored from node_modules rather than a CDN so installations work
// on networks with no outbound internet access.
app.get('/vendor/hls.js', (_req, res) => {
  try {
    res.type('application/javascript').sendFile(require.resolve('hls.js/dist/hls.light.min.js'));
  } catch (_) {
    res.status(404).type('text/plain').send('// hls.js is not installed');
  }
});

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  return res.sendFile(path.join(publicDir, 'login.html'));
});

app.get('/admin', auth.requireUser, (req, res) => {
  if (req.user.role !== 'admin') return res.redirect('/');
  return res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get('/', auth.requireViewAccess, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use(
  express.static(publicDir, {
    index: false,
    maxAge: config.version === 'dev' ? 0 : '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

app.use((req, res) => {
  if (req.accepts(['html', 'json']) === 'html') return res.status(404).sendFile(path.join(publicDir, 'index.html'));
  return res.status(404).json({ error: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  log.error('unhandled request error', err.stack || err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: 'Something went wrong on the server.' });
});

// ------------------------------------------------------------------- boot

async function main() {
  store.load();
  const s = store.get().settings;
  logger.configure({ level: s.logLevel, maxSizeMb: s.logMaxSizeMb, maxFiles: s.logMaxFiles });

  log.info('Stream Composer starting', { version: config.version, node: process.version, dataDir: config.dataDir });

  auth.ensureBootstrapAdmin();
  await encoder.probe();

  const server = app.listen(config.port, config.bindAddress, () => {
    log.info('listening', { address: `${config.bindAddress}:${config.port}`, publicUrl: config.publicUrl || '(not set)' });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;

  // The compositor can start polling before MediaMTX is up; it simply reports
  // "waiting" until the control API answers.
  mediamtx.waitUntilReachable().then(() => {
    compositor.startLoop();
    // Restreaming is independent of composition: it forwards the individual
    // sources whether or not an encoder is running.
    relays.startLoop();
  });

  const shutdown = (signal) => {
    log.info('shutting down', { signal });
    compositor.stop();
    relays.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error('unhandled promise rejection', (err && err.stack) || String(err)));
  process.on('uncaughtException', (err) => log.error('uncaught exception', err.stack || err.message));
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start:', err);
    process.exit(1);
  });
}

module.exports = { app, main };
