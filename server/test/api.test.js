'use strict';

/**
 * End-to-end tests over real HTTP: authentication, access control, the stream
 * key lifecycle and the MediaMTX auth hook. MediaMTX itself is not running, so
 * anything that reaches out to it degrades gracefully — which is also worth
 * asserting.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-test-'));
process.env.DATA_DIR = dataDir;
process.env.LOG_DIR = path.join(dataDir, 'logs');
process.env.LOG_CONSOLE = 'false';
process.env.ADMIN_USER = 'tester';
process.env.ADMIN_PASSWORD = 'super-secret-1';
process.env.MEDIAMTX_API = 'http://127.0.0.1:59997'; // deliberately dead
process.env.MEDIAMTX_INTERNAL_USER = 'composer';
process.env.MEDIAMTX_INTERNAL_PASSWORD = 'internal-test-secret';

const { app } = require('../src/index');
const store = require('../src/store');
const auth = require('../src/auth');
const hooks = require('../src/routes/hooks');

store.load();
auth.ensureBootstrapAdmin();

const INTERNAL = { user: 'composer', password: 'internal-test-secret' };

let server;
let base;
let cookie = '';
let playbackId = null;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function call(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (options.body) headers['content-type'] = 'application/json';
  return fetch(`${base}${pathname}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });
}

// ------------------------------------------------------------------- health

test('the health endpoint is open and reports the service state', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.onAir, 0);
});

// ------------------------------------------------------- access control

test('the viewer page redirects anonymous visitors to sign in', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual', headers: { accept: 'text/html' } });
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.get('location') || '', /^\/login/);
});

test('the API refuses anonymous callers', async () => {
  const res = await fetch(`${base}/api/state`, { headers: { accept: 'application/json' } });
  assert.strictEqual(res.status, 401);
});

test('the admin API refuses anonymous callers', async () => {
  const res = await fetch(`${base}/api/admin/users`, { headers: { accept: 'application/json' } });
  assert.strictEqual(res.status, 401);
});

test('a wrong password is rejected', async () => {
  const res = await call('/api/auth/login', { method: 'POST', body: { username: 'tester', password: 'nope' } });
  assert.strictEqual(res.status, 401);
});

test('the bootstrap administrator can sign in', async () => {
  const res = await call('/api/auth/login', { method: 'POST', body: { username: 'tester', password: 'super-secret-1' } });
  assert.strictEqual(res.status, 200);
  const setCookie = res.headers.get('set-cookie') || '';
  assert.match(setCookie, /sc_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  cookie = setCookie.split(';')[0];

  const body = await res.json();
  assert.strictEqual(body.user.username, 'tester');
  assert.strictEqual(body.user.role, 'admin');
});

test('a signed-in administrator can read the viewer state', async () => {
  const res = await call('/api/state');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.user.username, 'tester');
  assert.ok(Array.isArray(body.streams));
  assert.strictEqual(body.program.path, 'program');
});

test('a tampered session cookie is not accepted', async () => {
  const res = await fetch(`${base}/api/state`, {
    headers: { cookie: 'sc_session=eyJ1aWQiOiJ4In0.forged', accept: 'application/json' },
  });
  assert.strictEqual(res.status, 401);
});

// -------------------------------------------------------------- stream keys

let streamId = null;
let streamKey = null;

test('creating a stream generates a key and OBS settings', async () => {
  const res = await call('/api/admin/streams', { method: 'POST', body: { name: 'Camera 1' } });
  assert.strictEqual(res.status, 201);
  const { stream } = await res.json();
  assert.strictEqual(stream.name, 'Camera 1');
  assert.match(stream.key, /^[a-z0-9]{20}$/);
  assert.match(stream.playbackId, /^[0-9a-f]{24}$/, 'a stream gets an opaque playback id');
  assert.notStrictEqual(stream.playbackId, stream.key, 'the playback id is not the ingest key');
  playbackId = stream.playbackId;
  assert.ok(stream.ingest.rtmp.server.startsWith('rtmp://'));
  assert.strictEqual(stream.ingest.rtmp.key, stream.key);
  streamId = stream.id;
  streamKey = stream.key;
});

test('duplicate stream keys are refused', async () => {
  const res = await call('/api/admin/streams', { method: 'POST', body: { name: 'Clash', key: streamKey } });
  assert.strictEqual(res.status, 409);
});

test('a nameless stream is refused', async () => {
  const res = await call('/api/admin/streams', { method: 'POST', body: { name: '   ' } });
  assert.strictEqual(res.status, 400);
});

test('rotating a key changes it', async () => {
  const res = await call(`/api/admin/streams/${streamId}/rotate-key`, { method: 'POST' });
  assert.strictEqual(res.status, 200);
  const { stream } = await res.json();
  assert.notStrictEqual(stream.key, streamKey);
  streamKey = stream.key;
});

// ---------------------------------------------------------- MediaMTX hook

test('the auth hook admits a publisher holding a valid key', () => {
  const verdict = hooks.decide({ action: 'publish', path: `live/${streamKey}`, user: '', password: '', ip: '10.0.0.5' });
  assert.strictEqual(verdict.allow, true);
});

test('SECURITY: an anonymous read is refused, so the public ingest ports cannot serve playback', () => {
  // Regression: MediaMTX's RTMP and SRT listeners serve reads as well as
  // publishes and are internet-facing, so `ffmpeg -i rtmp://host/program`
  // previously bypassed viewer authentication entirely.
  assert.strictEqual(hooks.decide({ action: 'read', path: 'program', user: '', password: '' }).allow, false);
  assert.strictEqual(hooks.decide({ action: 'read', path: `live/${streamKey}`, user: '', password: '' }).allow, false);
  assert.strictEqual(hooks.decide({ action: 'read', path: 'program', user: 'composer', password: 'wrong' }).allow, false);
});

test('the auth hook admits reads that carry the internal credential', () => {
  assert.strictEqual(hooks.decide({ action: 'read', path: 'program', ...INTERNAL }).allow, true);
  assert.strictEqual(hooks.decide({ action: 'read', path: `live/${streamKey}`, ...INTERNAL }).allow, true);
});

test('SECURITY: only the compositor may publish the programme', () => {
  assert.strictEqual(hooks.decide({ action: 'publish', path: 'program', ...INTERNAL }).allow, true);
  assert.strictEqual(hooks.decide({ action: 'publish', path: 'program', user: 'composer', password: 'guess' }).allow, false);
});

test('the auth hook rejects an unknown key', () => {
  const verdict = hooks.decide({ action: 'publish', path: 'live/not-a-real-key', user: '', password: '' });
  assert.strictEqual(verdict.allow, false);
});

test('the auth hook rejects publishing straight to the programme path', () => {
  const verdict = hooks.decide({ action: 'publish', path: 'program', user: '', password: '' });
  assert.strictEqual(verdict.allow, false);
});

test('the auth hook rejects a disabled stream', async () => {
  await call(`/api/admin/streams/${streamId}`, { method: 'PATCH', body: { enabled: false } });
  const verdict = hooks.decide({ action: 'publish', path: `live/${streamKey}`, user: '', password: '' });
  assert.strictEqual(verdict.allow, false);
  await call(`/api/admin/streams/${streamId}`, { method: 'PATCH', body: { enabled: true } });
});

test('the auth hook rejects nested paths and unknown actions', () => {
  assert.strictEqual(hooks.decide({ action: 'publish', path: `live/${streamKey}/extra` }).allow, false);
  assert.strictEqual(hooks.decide({ action: 'playback', path: 'program' }).allow, false);
  assert.strictEqual(hooks.decide({ action: 'read', path: 'something/else', ...INTERNAL }).allow, false);
});

test('the hook endpoint answers only when the shared secret matches', async () => {
  const good = await call(`/internal/${INTERNAL.password}/mediamtx/auth`, {
    method: 'POST',
    body: { action: 'publish', path: `live/${streamKey}` },
  });
  assert.strictEqual(good.status, 200, 'the right token is accepted');

  // Regression: behind a reverse proxy every request arrives from the container
  // network, so the source-address check alone left this endpoint reachable
  // from the internet as a stream-key oracle.
  const bad = await call('/internal/not-the-secret/mediamtx/auth', {
    method: 'POST',
    body: { action: 'publish', path: `live/${streamKey}` },
  });
  assert.strictEqual(bad.status, 404, 'a wrong token gives nothing away');
});

// -------------------------------------------------------------- composition

test('composition settings round-trip and are validated', async () => {
  const res = await call('/api/admin/composition', { method: 'PUT', body: { width: 1281, height: 721, fps: 30, layout: '3x3', bitrateKbps: 3000 } });
  assert.strictEqual(res.status, 200);
  const { composition } = await res.json();
  assert.strictEqual(composition.width, 1280, 'odd widths are rounded down to even');
  assert.strictEqual(composition.height, 720);
  assert.strictEqual(composition.layout, '3x3');
  assert.ok(composition.maxrateKbps >= composition.bitrateKbps);
});

test('an unknown layout is refused', async () => {
  const res = await call('/api/admin/composition', { method: 'PUT', body: { layout: 'hexagon' } });
  assert.strictEqual(res.status, 400);
});

test('an out-of-range frame rate is clamped, not accepted blindly', async () => {
  const res = await call('/api/admin/composition', { method: 'PUT', body: { fps: 500 } });
  const { composition } = await res.json();
  assert.strictEqual(composition.fps, 60);
});

test('the layout preview reflects the requested source count', async () => {
  const res = await call('/api/admin/layout-preview?count=7&layout=auto');
  const { layout } = await res.json();
  assert.strictEqual(layout.cells.length, 7);
});

test('the generated ffmpeg command is complete and video-only', async () => {
  const res = await call('/api/admin/ffmpeg-command');
  const body = await res.json();
  assert.match(body.command, /filter_complex/);
  assert.match(body.command, /-an(\s|$)/, 'the programme carries no audio by design');
  assert.ok(!/amix/.test(body.command), 'audio is never mixed into the programme');
});

// -------------------------------------------------------------------- users

test('a viewer cannot reach the admin API', async () => {
  await call('/api/admin/users', { method: 'POST', body: { username: 'watcher', password: 'watch-me-1234', role: 'viewer' } });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'watcher', password: 'watch-me-1234' }),
  });
  const viewerCookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const state = await fetch(`${base}/api/state`, { headers: { cookie: viewerCookie } });
  assert.strictEqual(state.status, 200, 'viewers can watch');

  const admin = await fetch(`${base}/api/admin/users`, { headers: { cookie: viewerCookie, accept: 'application/json' } });
  assert.strictEqual(admin.status, 403, 'viewers cannot administer');
});

test('short passwords are refused', async () => {
  const res = await call('/api/admin/users', { method: 'POST', body: { username: 'shorty', password: 'abc', role: 'viewer' } });
  assert.strictEqual(res.status, 400);
});

test('the last administrator cannot be demoted', async () => {
  const users = await (await call('/api/admin/users')).json();
  const me = users.users.find((u) => u.username === 'tester');
  const res = await call(`/api/admin/users/${me.id}`, { method: 'PATCH', body: { role: 'viewer' } });
  assert.strictEqual(res.status, 409);
});

// ------------------------------------------------------------- media proxy

test('the media proxy refuses paths that are not configured streams', async () => {
  const res = await call('/mtx/webrtc/live/made-up-key/whep', { method: 'POST', headers: { 'content-type': 'application/sdp' } });
  assert.strictEqual(res.status, 404);
});

test('SECURITY: the media proxy addresses streams by playback id, never by ingest key', () => {
  const proxy = require('../src/proxy');
  assert.strictEqual(proxy.resolvePlayback(`s/${playbackId}`), `live/${streamKey}`);
  // The ingest key must not be a usable playback reference.
  assert.strictEqual(proxy.resolvePlayback(`live/${streamKey}`), null);
  assert.strictEqual(proxy.resolvePlayback(`s/${streamKey}`), null);
});

test('SECURITY: the viewer API never discloses an ingest stream key', async () => {
  const res = await call('/api/state');
  const body = await res.json();
  const serialised = JSON.stringify(body);
  assert.ok(!serialised.includes(streamKey), 'the publishing credential is absent from the viewer API');
  assert.ok(body.streams.some((s) => s.path === `s/${playbackId}`), 'streams are addressed by playback id');
});

test('SECURITY: percent-encoded traversal cannot reach another MediaMTX path', () => {
  const proxy = require('../src/proxy');
  // Regression: validation ran on the raw path while the forwarded URL was
  // built by new URL(), which decodes %2e and resolves "..", so the checked
  // path and the forwarded path were not the same path.
  const attacks = [
    `/s/${playbackId}/%2e%2e/%2e%2e/secretpath/whep`,
    `/s/${playbackId}/whep/../../../../etc/passwd/whep`,
    `/program/whep/../../live/${streamKey}/whep`,
    `/s/${playbackId}/..%2f..%2fadmin/whep`,
    '/..%2f..%2fetc/whep',
  ];
  for (const url of attacks) {
    assert.strictEqual(proxy.parseRequest(url, 'webrtc'), null, `refused: ${url}`);
  }
  for (const url of [`/s/${playbackId}/../../anything/index.m3u8`, '/%2e%2e/secret/index.m3u8']) {
    assert.strictEqual(proxy.parseRequest(url, 'hls'), null, `refused: ${url}`);
  }
});

test('SECURITY: the media proxy never routes WHIP, which is a publish verb', async () => {
  const proxy = require('../src/proxy');
  assert.strictEqual(proxy.parseRequest(`/s/${playbackId}/whip`, 'webrtc'), null);

  // GET is refused too: it would otherwise reach MediaMTX's built-in publish page.
  const res = await call(`/mtx/webrtc/s/${playbackId}/whep`, { method: 'GET' });
  assert.strictEqual(res.status, 405);
});

test('the proxy accepts a well-formed WHEP request and its session URL', () => {
  const proxy = require('../src/proxy');
  const create = proxy.parseRequest(`/s/${playbackId}/whep`, 'webrtc');
  assert.strictEqual(create.upstreamPath, `/live/${streamKey}/whep`);
  const session = proxy.parseRequest(`/s/${playbackId}/whep/abc-123`, 'webrtc');
  assert.strictEqual(session.upstreamPath, `/live/${streamKey}/whep/abc-123`);
  const hls = proxy.parseRequest('/program/index.m3u8', 'hls');
  assert.strictEqual(hls.upstreamPath, '/program/index.m3u8');
});

test('SECURITY: a client-supplied Authorization header is not forwarded upstream', async () => {
  // Regression: forwarding it made the stack-internal MediaMTX credential an
  // internet-facing password, and a correct guess authorised publishing.
  const src = fs.readFileSync(require.resolve('../src/proxy'), 'utf8');
  assert.match(src, /'authorization'/, 'authorization is in the strip list');
  const stripped = /const STRIP_REQUEST = new Set\(\[([\s\S]*?)\]\)/.exec(src)[1];
  assert.ok(stripped.includes("'authorization'"), 'the client Authorization header is stripped');
});

// ----------------------------------------------------------------- settings

test('settings round-trip, including the log rotation budget', async () => {
  const res = await call('/api/admin/settings', { method: 'PUT', body: { siteName: 'Studio A', logMaxSizeMb: 5, logMaxFiles: 3, logLevel: 'debug' } });
  assert.strictEqual(res.status, 200);
  const { settings } = await res.json();
  assert.strictEqual(settings.siteName, 'Studio A');
  assert.strictEqual(settings.logMaxSizeMb, 5);
  assert.strictEqual(settings.logLevel, 'debug');
});

test('public viewing opens the viewer API to anonymous visitors', async () => {
  await call('/api/admin/settings', { method: 'PUT', body: { publicViewing: true } });
  const res = await fetch(`${base}/api/state`, { headers: { accept: 'application/json' } });
  assert.strictEqual(res.status, 200);

  const admin = await fetch(`${base}/api/admin/users`, { headers: { accept: 'application/json' } });
  assert.strictEqual(admin.status, 401, 'administration stays locked even in public mode');

  await call('/api/admin/settings', { method: 'PUT', body: { publicViewing: false } });
});

test('signing out clears the session', async () => {
  const res = await call('/api/auth/logout', { method: 'POST' });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('set-cookie') || '', /Max-Age=0/);
});

// --------------------------------------------------------------------- logs

test('the log endpoint returns lines and file sizes', async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'super-secret-1' }),
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const res = await call('/api/admin/logs?channel=server&lines=50');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.lines));
  assert.ok(Array.isArray(body.files));
});

test('the status endpoint survives MediaMTX being unreachable', async () => {
  const res = await call('/api/admin/status');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.compositor.running, false);
  assert.ok(body.host.cpu.cores >= 1);
});
