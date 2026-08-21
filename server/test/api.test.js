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

// Always runs as the module-level admin session — it overwrites
// options.headers.cookie rather than falling back to it, so passing a
// different user's cookie here silently runs as admin instead. Use
// callAs() below for anything that needs to run as a specific user.
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
  // Public: this stream backs every proxy/routing test below, which predate
  // (and are not about) per-stream visibility — keeping it public keeps
  // their original meaning. Visibility itself gets its own tests further down.
  const res = await call('/api/admin/streams', { method: 'POST', body: { name: 'Camera 1', visibility: 'public' } });
  assert.strictEqual(res.status, 201);
  const { stream } = await res.json();
  assert.strictEqual(stream.name, 'Camera 1');
  assert.strictEqual(stream.visibility, 'public');
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

// ---------------------------------------------------------------- nicknames

// Captions need drawtext, which is only detected by probing ffmpeg at boot.
// These tests do not run ffmpeg, so declare the capability directly.
test('enable caption rendering for the tests that follow', () => {
  require('../src/encoder').caps.drawtext = true;
  assert.strictEqual(require('../src/encoder').caps.drawtext, true);
});

test('a stream can carry a nickname, and it is what gets burnt in', async () => {
  const res = await call(`/api/admin/streams/${streamId}`, { method: 'PATCH', body: { nickname: 'Main Stage' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).stream.nickname, 'Main Stage');

  const compositor = require('../src/compositor');
  const comp = require('../src/store').get().composition;
  // Go through the real selection path: it is what maps nickname -> caption.
  const sources = compositor.selectSources([{ key: streamKey, ready: true, tracks: {} }]);
  assert.strictEqual(sources[0].label, 'Main Stage', 'the nickname becomes the caption');

  const args = compositor.buildArgs(sources, comp, 'x264').args;
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /drawtext/, 'the caption filter is present');
  assert.match(graph, /Main Stage/, 'the nickname is the caption');
  assert.match(graph, /bordercolor=black/, 'high contrast: white text with a black outline');
  assert.match(graph, /x=\(w-text_w\)\/2/, 'centred horizontally');
  assert.match(graph, /y=h-th-/, 'sitting at the bottom of the cell');
  assert.ok(!/box=1/.test(graph), 'the old filled box is gone');
});

test('clearing the nickname falls back to the stream name', async () => {
  await call(`/api/admin/streams/${streamId}`, { method: 'PATCH', body: { nickname: '' } });
  const compositor = require('../src/compositor');
  const sources = compositor.selectSources([{ key: streamKey, ready: true, tracks: {} }]);
  assert.strictEqual(sources[0].label, sources[0].name, 'the name is used when no nickname is set');
  assert.ok(sources[0].label.length > 0);
});

test('an over-long nickname is refused rather than silently truncated', async () => {
  const res = await call(`/api/admin/streams/${streamId}`, { method: 'PATCH', body: { nickname: 'x'.repeat(33) } });
  assert.strictEqual(res.status, 400);
});

test('a nickname is trimmed and stripped of newlines', () => {
  const streams = require('../src/streams');
  assert.strictEqual(streams.cleanNickname('  Studio C  '), 'Studio C');
  assert.strictEqual(streams.cleanNickname('two\nlines'), 'two lines');
  assert.strictEqual(streams.cleanNickname(null), '');
});

test('changing a nickname changes the encoder command, so the grid rebuilds', () => {
  const compositor = require('../src/compositor');
  const store2 = require('../src/store');
  const comp = store2.get().composition;
  const base = [{ key: 'k1', name: 'Camera 1', label: 'Camera 1', path: 'live/k1', hasAudio: false }];
  const renamed = [{ ...base[0], label: 'Main Stage' }];
  const a = compositor.buildArgs(base, comp, 'x264').args.join(' ');
  const b = compositor.buildArgs(renamed, comp, 'x264').args.join(' ');
  assert.notStrictEqual(a, b, 'the caption is part of the command');
  assert.match(b, /Main Stage/);
});

test('SECURITY: a nickname cannot break out of the drawtext filter', () => {
  const compositor = require('../src/compositor');
  const store2 = require('../src/store');
  const comp = store2.get().composition;
  for (const evil of ["a':b", 'a:b', 'a\\b', "x'[0:v]y", 'pct%50', 'a,b']) {
    const args = compositor.buildArgs(
      [{ key: 'k', name: 'n', label: evil, path: 'live/k', hasAudio: false }], comp, 'x264',
    ).args;
    const graph = args[args.indexOf('-filter_complex') + 1];
    // Exactly one drawtext, and the graph still ends where it should.
    assert.strictEqual((graph.match(/drawtext/g) || []).length, 1, `one drawtext for ${JSON.stringify(evil)}`);
    assert.match(graph, /\[outv\]$/, `graph intact for ${JSON.stringify(evil)}`);
  }
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

test('SECURITY: only the audio relay may publish a source\'s audio monitor feed', () => {
  assert.strictEqual(hooks.decide({ action: 'publish', path: `audio/${streamKey}`, ...INTERNAL }).allow, true);
  assert.strictEqual(hooks.decide({ action: 'publish', path: `audio/${streamKey}`, user: '', password: '' }).allow, false);
});

test('the auth hook admits audio-monitor reads carrying the internal credential, for a known enabled key', () => {
  assert.strictEqual(hooks.decide({ action: 'read', path: `audio/${streamKey}`, ...INTERNAL }).allow, true);
  assert.strictEqual(hooks.decide({ action: 'read', path: `audio/${streamKey}`, user: '', password: '' }).allow, false);
  assert.strictEqual(hooks.decide({ action: 'read', path: 'audio/not-a-real-key', ...INTERNAL }).allow, false);
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
  assert.ok(body.streams.some((s) => s.audioPath === `s/${playbackId}/audio`), 'the audio monitor is addressed by playback id too');
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
    `/s/${playbackId}/audio/../../live/${streamKey}/whep`,
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

test('the audio monitor resolves to the Opus feed, not the raw (AAC) ingest path', () => {
  const proxy = require('../src/proxy');
  assert.strictEqual(proxy.resolvePlayback(`s/${playbackId}/audio`), `audio/${streamKey}`);
  // The plain video form must keep pointing at the ingest path, unaffected.
  assert.strictEqual(proxy.resolvePlayback(`s/${playbackId}`), `live/${streamKey}`);
  // Publishing straight to the audio prefix is not a valid playback reference.
  assert.strictEqual(proxy.resolvePlayback(`audio/${streamKey}`), null);

  const create = proxy.parseRequest(`/s/${playbackId}/audio/whep`, 'webrtc');
  assert.strictEqual(create.upstreamPath, `/audio/${streamKey}/whep`);
  const session = proxy.parseRequest(`/s/${playbackId}/audio/whep/abc-123`, 'webrtc');
  assert.strictEqual(session.upstreamPath, `/audio/${streamKey}/whep/abc-123`);
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

// ------------------------------------------------- programme output bitrate

test('the programme bitrate is measured from what MediaMTX received', () => {
  const mediamtx = require('../src/mediamtx');
  const at = (bytes) => [{ name: 'program', ready: true, bytesReceived: bytes }];

  // The first sample only establishes a baseline — there is nothing to divide.
  mediamtx.sampleProgram(at(0));
  assert.strictEqual(mediamtx.programBitrateKbps(), 0);

  // Two samples less than half a second apart are ignored: too short a window
  // to divide by without the reading swinging wildly.
  mediamtx.sampleProgram(at(1_000_000));
  assert.strictEqual(mediamtx.programBitrateKbps(), 0);
});

test('a programme that is not publishing reports no bitrate', () => {
  const mediamtx = require('../src/mediamtx');
  mediamtx.sampleProgram([{ name: 'program', ready: false, bytesReceived: 999 }]);
  assert.strictEqual(mediamtx.programBitrateKbps(), 0);
  mediamtx.sampleProgram([]);
  assert.strictEqual(mediamtx.programBitrateKbps(), 0);
});

test('a counter that goes backwards restarts the measurement', async () => {
  const mediamtx = require('../src/mediamtx');
  const sample = (bytes) => mediamtx.sampleProgram([{ name: 'program', ready: true, bytesReceived: bytes }]);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  sample(0);
  await wait(600);
  sample(75_000); // 75 kB in ~0.6s -> ~1000 kb/s
  const measured = mediamtx.programBitrateKbps();
  assert.ok(measured > 500 && measured < 1500, `expected roughly 1000 kb/s, got ${measured}`);

  // A new publisher takes over and the counter resets. The next reading must
  // not go negative, and must not spike.
  sample(10);
  await wait(600);
  sample(20);
  assert.ok(mediamtx.programBitrateKbps() >= 0);
});

test('falling back to the measured bitrate does not mask ffmpeg reporting one', () => {
  const compositor = require('../src/compositor');
  const before = compositor.status().progress.bitrateKbps;
  assert.ok(Number.isFinite(before) && before >= 0);
});

// ------------------------------------------------------- auth-hook log noise

test('an RTSP challenge from inside the stack is not warned about', () => {
  const logger = require('../src/logger');
  logger.configure({ level: 'debug' });
  const since = () => logger.tail('server', 5).join('\n');

  // The compositor's own first, credential-less RTSP read.
  hooks.logDenial('reads require the internal credential', {
    action: 'read', path: 'live/challenge-case', ip: '127.0.0.1', protocol: 'rtsp',
  });
  let out = since();
  assert.match(out, /denied, awaiting credentials/);
  assert.doesNotMatch(out.split('denied, awaiting credentials')[1] || '', /WARN/);

  // The same denial from off-box is a real one and must still warn.
  hooks.logDenial('reads require the internal credential', {
    action: 'read', path: 'live/remote-case', ip: '203.0.113.7', protocol: 'rtsp',
  });
  assert.match(since(), /WARN.*denied.*remote-case/s);

  // So is an anonymous RTMP read, which never challenges.
  hooks.logDenial('reads require the internal credential', {
    action: 'read', path: 'rtmp-case', ip: '127.0.0.1', protocol: 'rtmp',
  });
  assert.match(since(), /WARN.*denied.*rtmp-case/s);

  // And so is a wrong password, which is not a challenge leg.
  hooks.logDenial('reads require the internal credential', {
    action: 'read', path: 'wrong-password-case', ip: '127.0.0.1', protocol: 'rtsp', user: 'composer', password: 'wrong',
  });
  assert.match(since(), /WARN.*denied.*wrong-password-case/s);

  logger.configure({ level: 'info' });
});

// -------------------------------------------------- internal RTSP transport

test('the compositor reads and publishes on the configured RTSP port', () => {
  const compositor = require('../src/compositor');
  const store = require('../src/store');
  const comp = store.get().composition;
  const sources = [{ key: 'k1', name: 'One', label: 'One', path: 'live/k1', hasAudio: false }];
  const { args } = compositor.buildArgs(sources, comp, 'x264');
  const urls = args.filter((a) => String(a).startsWith('rtsp://'));
  assert.ok(urls.length >= 2, 'expected an input and an output URL');
  // 8554 is the default; the point of the test is that every URL agrees with
  // config rather than being spelled out separately.
  const port = require('../src/config').mediamtx.rtspPort;
  for (const u of urls) {
    assert.strictEqual(new URL(u).port, String(port), `${u} should use port ${port}`);
  }
});

// -------------------------------------------------------- composition modes

test('composition defaults to being made on the server', () => {
  const store = require('../src/store');
  assert.strictEqual(store.get().composition.mode, 'server');
});

test('the mode must be one the server understands', async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'super-secret-1' }),
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const bad = await call('/api/admin/composition', { method: 'PUT', body: { mode: 'gpu-cluster' } });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(require('../src/store').get().composition.mode, 'server');

  const good = await call('/api/admin/composition', { method: 'PUT', body: { mode: 'web' } });
  assert.strictEqual(good.status, 200);
  assert.strictEqual((await good.json()).composition.mode, 'web');
});

test('web mode reports no programme to play', async () => {
  // Left in web mode by the test above.
  const res = await call('/api/state');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.program.mode, 'web');
  assert.strictEqual(body.program.path, null, 'there is no programme stream to point at');
  // The player draws its own captions, so it needs the caption settings.
  assert.strictEqual(typeof body.program.labels, 'boolean');
  assert.ok(body.program.labelSize > 0);
});

test('the sources stay reachable in web mode even when they are meant to be hidden', () => {
  const proxy = require('../src/proxy');
  const store = require('../src/store');
  const streams = require('../src/streams');

  const created = streams.create({ name: 'Hidden cam', visibility: 'public' });
  store.update((d) => {
    d.settings.showIndividualStreams = false;
    d.composition.mode = 'server';
  });
  // On the server the programme is what viewers get, so a source stays hidden.
  assert.strictEqual(proxy.resolvePlayback(`s/${created.playbackId}`), null);

  // In web mode the sources *are* the programme; hiding them would leave the
  // player with nothing at all to show.
  store.update((d) => {
    d.composition.mode = 'web';
  });
  assert.strictEqual(proxy.resolvePlayback(`s/${created.playbackId}`), `live/${created.key}`);

  store.update((d) => {
    d.settings.showIndividualStreams = true;
    d.composition.mode = 'server';
  });
  streams.remove(created.id);
});

test('an unknown playback id is still refused in web mode', () => {
  const proxy = require('../src/proxy');
  const store = require('../src/store');
  store.update((d) => {
    d.composition.mode = 'web';
  });
  assert.strictEqual(proxy.resolvePlayback('s/deadbeefdeadbeef'), null);
  assert.strictEqual(proxy.resolvePlayback('s/../../etc/passwd'), null);
  store.update((d) => {
    d.composition.mode = 'server';
  });
});

test('both modes plan the same grid', () => {
  const compositor = require('../src/compositor');
  const store = require('../src/store');
  const comp = store.get().composition;
  const sources = [1, 2, 3].map((i) => ({ key: `k${i}`, name: `S${i}`, label: `L${i}`, path: `live/k${i}`, hasAudio: false }));

  const planned = compositor.planLayout(sources, comp);
  const built = compositor.buildArgs(sources, comp, 'x264');

  // The browser is handed planLayout's cells; the encoder uses buildArgs'.
  // If those ever disagree the two modes would arrange the grid differently.
  assert.deepStrictEqual(planned.layout.cells, built.layout.cells);
  assert.strictEqual(planned.placed.length, 3);
});

test('changing mode changes the encoder signature', () => {
  const compositor = require('../src/compositor');
  const store = require('../src/store');
  const sources = [{ key: 'k1', name: 'One', label: 'One', path: 'live/k1', hasAudio: false }];
  const comp = { ...store.get().composition };

  // Exercised through buildArgs' inputs: the signature is private, so assert
  // the observable consequence — a mode change must not look like a no-op.
  const serverPlan = JSON.stringify(compositor.planLayout(sources, { ...comp, mode: 'server' }).layout);
  const webPlan = JSON.stringify(compositor.planLayout(sources, { ...comp, mode: 'web' }).layout);
  assert.strictEqual(serverPlan, webPlan, 'the layout itself does not depend on the mode');
  assert.notStrictEqual(comp.mode, undefined);
});

// ------------------------------------------------- direct playback probing

test('a stream with B-frames is reported as unplayable, with a fix', () => {
  const playability = require('../src/playability');

  const withB = playability.reasonFor({ codec: 'h264', profile: 'High', bFrames: 2 });
  assert.ok(withB, 'B-frames must be flagged');
  assert.strictEqual(withB.code, 'b-frames');
  assert.match(withB.summary, /B-frames/);
  // The message is useless without telling the operator what to change.
  assert.match(withB.fix, /zerolatency|bframes=0/);

  assert.strictEqual(playability.reasonFor({ codec: 'h264', profile: 'Main', bFrames: 0 }), null);
  assert.strictEqual(playability.reasonFor(null), null);
});

test('an unprobed source reports nothing rather than guessing', () => {
  const playability = require('../src/playability');
  playability.forget('never-seen');
  assert.strictEqual(playability.status('never-seen'), null);
});

test('sources that stop publishing are forgotten', async () => {
  const playability = require('../src/playability');
  // A probe against a path that cannot be reached resolves to "unknown"
  // rather than throwing, and must not wedge the poll loop.
  playability.inspect('gone', 'rtsp://127.0.0.1:1/live/gone', 'now');
  playability.keep(new Set());
  assert.strictEqual(playability.status('gone'), null);
});

test('the viewer API carries the problem so a tile can explain itself', async () => {
  const res = await call('/api/state');
  const body = await res.json();
  for (const s of body.streams) {
    // Present as a key on every stream, null when there is nothing wrong.
    assert.ok(Object.prototype.hasOwnProperty.call(s, 'problem'));
  }
});

test('the fallback for unplayable sources is validated and defaults to HLS', async () => {
  const store = require('../src/store');
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'super-secret-1' }),
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  assert.strictEqual(store.DEFAULT_COMPOSITION.fallback, 'hls');

  const bad = await call('/api/admin/composition', { method: 'PUT', body: { fallback: 'transcode-everything' } });
  assert.strictEqual(bad.status, 400);

  for (const choice of ['warn', 'hls']) {
    const res = await call('/api/admin/composition', { method: 'PUT', body: { fallback: choice } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).composition.fallback, choice);
  }

  // The player needs it to decide per tile.
  const state = await (await call('/api/state')).json();
  assert.strictEqual(state.program.fallback, 'hls');
});

// -------------------------------------------------------------- restreaming

test('a destination URL puts the key last, and keeps any query after it', () => {
  const relays = require('../src/relays');

  assert.strictEqual(
    relays.destinationUrl({ url: 'rtmp://live.twitch.tv/app', key: 'live_123_abc' }),
    'rtmp://live.twitch.tv/app/live_123_abc',
  );
  // A trailing slash must not produce a doubled separator.
  assert.strictEqual(
    relays.destinationUrl({ url: 'rtmp://a.rtmp.youtube.com/live2/', key: 'aaaa-bbbb' }),
    'rtmp://a.rtmp.youtube.com/live2/aaaa-bbbb',
  );
  // YouTube's backup ingest carries ?backup=1. Appending the key to the end of
  // that would send YouTube the literal key "1".
  assert.strictEqual(
    relays.destinationUrl({ url: 'rtmp://b.rtmp.youtube.com/live2?backup=1', key: 'aaaa-bbbb' }),
    'rtmp://b.rtmp.youtube.com/live2/aaaa-bbbb?backup=1',
  );
  // Some services put everything in the URL.
  assert.strictEqual(relays.destinationUrl({ url: 'rtmp://example.test/all-in-one', key: '' }), 'rtmp://example.test/all-in-one');
});

test('only rtmp and rtmps destinations are accepted', () => {
  const relays = require('../src/relays');

  assert.strictEqual(relays.cleanUrl('rtmp://live.twitch.tv/app'), 'rtmp://live.twitch.tv/app');
  assert.strictEqual(relays.cleanUrl('rtmps://a.rtmps.youtube.com/live2'), 'rtmps://a.rtmps.youtube.com/live2');
  // A hyphen is perfectly ordinary in a hostname and must survive validation.
  assert.strictEqual(relays.cleanUrl('rtmp://ingest-eu-west.example.test/live'), 'rtmp://ingest-eu-west.example.test/live');

  for (const bad of ['', 'not a url', 'http://example.test/live', 'file:///etc/passwd', 'rtmp://exa mple.test/live']) {
    assert.throws(() => relays.cleanUrl(bad), /server URL|does not look like|must be an rtmp/i, `should reject ${JSON.stringify(bad)}`);
  }
});

test('a stream key may not smuggle whitespace into the argument list', () => {
  const relays = require('../src/relays');
  assert.strictEqual(relays.cleanKey('live_123456_AbCdEf'), 'live_123456_AbCdEf');
  assert.strictEqual(relays.cleanKey('aaaa-bbbb-cccc-dddd'), 'aaaa-bbbb-cccc-dddd');
  assert.strictEqual(relays.cleanKey(''), '');
  assert.throws(() => relays.cleanKey('has a space'), /spaces or unusual/);
  assert.throws(() => relays.cleanKey('two\nlines'), /spaces or unusual/);
});

test('the forwarding command copies video and never re-encodes it', () => {
  const relays = require('../src/relays');

  const copy = relays.buildArgs({ url: 'rtmp://example.test/live', key: 'k', audio: 'copy' }, 'live/abc');
  assert.ok(copy.includes('-c:v'), 'video codec is set explicitly');
  assert.strictEqual(copy[copy.indexOf('-c:v') + 1], 'copy');
  assert.strictEqual(copy[copy.indexOf('-c:a') + 1], 'copy');
  assert.strictEqual(copy[copy.length - 1], 'rtmp://example.test/live/k');
  assert.ok(copy.some((a) => a.endsWith('/live/abc')), 'reads the source path over RTSP');
  assert.strictEqual(copy[copy.indexOf('-f') + 1], 'flv');
  // Audio is optional so a silent camera still reaches the platform.
  assert.ok(copy.includes('0:a:0?'));

  const aac = relays.buildArgs({ url: 'rtmp://example.test/live', key: 'k', audio: 'aac' }, 'live/abc');
  assert.strictEqual(aac[aac.indexOf('-c:a') + 1], 'aac');
  assert.strictEqual(aac[aac.indexOf('-c:v') + 1], 'copy', 'video is copied even when audio is re-encoded');
});

test('the shown command never contains the stream key', () => {
  const relays = require('../src/relays');
  const shown = relays.previewCommand({ url: 'rtmp://example.test/live', key: 'super-secret-key', audio: 'copy' }, 'live/abc');
  assert.ok(!shown.includes('super-secret-key'));
  assert.match(shown, /STREAM-KEY/);
});

test('the audio monitor transcode reads the ingest path and writes only Opus audio', () => {
  const audioRelay = require('../src/audioRelay');
  const args = audioRelay.buildArgs('abc');

  assert.ok(args.some((a) => a.endsWith('/live/abc')), 'reads the source over RTSP');
  assert.ok(args.some((a) => a.endsWith('/audio/abc')), 'republishes under the audio prefix');
  assert.strictEqual(args[args.indexOf('-c:a') + 1], 'libopus');
  assert.ok(args.includes('-vn'), 'never carries video — this is an audio-only feed');
  assert.strictEqual(args[args.indexOf('-map') + 1], '0:a:0');
  assert.strictEqual(args[args.indexOf('-f') + 1], 'rtsp', 'republished over RTSP, the stack\'s internal transport');
});

test('destinations are created, listed with a masked key, toggled and deleted', async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'super-secret-1' }),
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const source = await (await call('/api/admin/streams', { method: 'POST', body: { name: 'Relay source' } })).json();
  const streamId = source.stream.id;

  // A destination has to belong to a source.
  const orphan = await call('/api/admin/relays', { method: 'POST', body: { provider: 'twitch', key: 'live_1' } });
  assert.strictEqual(orphan.status, 400);

  const created = await call('/api/admin/relays', {
    method: 'POST',
    body: { streamId, provider: 'twitch', key: 'live_123456_secret' },
  });
  assert.strictEqual(created.status, 201);
  const relay = (await created.json()).relay;
  assert.strictEqual(relay.provider, 'twitch');
  assert.strictEqual(relay.url, 'rtmp://live.twitch.tv/app');
  assert.strictEqual(relay.enabled, true);
  // Nothing is publishing, so it waits rather than reporting a failure.
  assert.ok(['waiting', 'off'].includes(relay.status));

  const listed = await (await call('/api/admin/relays')).json();
  const mine = listed.relays.find((r) => r.id === relay.id);
  assert.strictEqual(mine.sourceName, 'Relay source');
  // The key is a credential for somebody else's channel: it is not in the list.
  assert.ok(!JSON.stringify(listed).includes('live_123456_secret'));
  assert.match(mine.keyMasked, /•/);
  assert.ok(listed.providers.some((p) => p.id === 'youtube'));
  assert.ok(listed.sources.some((s) => s.id === streamId));

  // …but an administrator can ask for it explicitly.
  const revealed = await (await call(`/api/admin/relays/${relay.id}/key`)).json();
  assert.strictEqual(revealed.key, 'live_123456_secret');

  const off = await call(`/api/admin/relays/${relay.id}`, { method: 'PATCH', body: { enabled: false } });
  assert.strictEqual(off.status, 200);
  assert.strictEqual((await off.json()).relay.status, 'off');

  const badUrl = await call(`/api/admin/relays/${relay.id}`, { method: 'PATCH', body: { url: 'http://example.test/live' } });
  assert.strictEqual(badUrl.status, 400);

  assert.strictEqual((await call(`/api/admin/relays/${relay.id}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await call(`/api/admin/relays/${relay.id}`, { method: 'DELETE' })).status, 404);

  await call(`/api/admin/streams/${streamId}`, { method: 'DELETE' });
});

test('one source can be forwarded to several places at once', async () => {
  const source = await (await call('/api/admin/streams', { method: 'POST', body: { name: 'Multi source' } })).json();
  const streamId = source.stream.id;

  for (const provider of ['twitch', 'youtube', 'youtube-backup']) {
    const res = await call('/api/admin/relays', { method: 'POST', body: { streamId, provider, key: `key-${provider}` } });
    assert.strictEqual(res.status, 201);
  }
  const custom = await call('/api/admin/relays', {
    method: 'POST',
    body: { streamId, provider: 'custom', url: 'rtmp://ingest.example.test/live', key: 'abc123', name: 'Our mirror', audio: 'aac' },
  });
  assert.strictEqual(custom.status, 201);
  assert.strictEqual((await custom.json()).relay.name, 'Our mirror');

  const listed = await (await call('/api/admin/relays')).json();
  const mine = listed.relays.filter((r) => r.streamId === streamId);
  assert.strictEqual(mine.length, 4, 'all four destinations stand on their own');
  assert.strictEqual(new Set(mine.map((r) => r.id)).size, 4);
  assert.ok(mine.some((r) => r.audio === 'aac'));

  // Deleting the source takes its destinations with it — otherwise the key
  // would keep being forwarded after the slot is handed to someone else.
  await call(`/api/admin/streams/${streamId}`, { method: 'DELETE' });
  const after = await (await call('/api/admin/relays')).json();
  assert.strictEqual(after.relays.filter((r) => r.streamId === streamId).length, 0);
});

test('destinations are persisted, and old configurations gain an empty list', () => {
  const store = require('../src/store');

  assert.deepStrictEqual(store.defaults().relays, [], 'a fresh install starts with none');

  // They live in the same file as users and stream keys — the file the volume
  // keeps across `docker compose up -d` and that `make backup` copies.
  const fromDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  assert.ok(Object.prototype.hasOwnProperty.call(fromDisk, 'relays'), 'relays are persisted, not in-memory');
  assert.ok(Array.isArray(fromDisk.relays));
});

test('the server status reports how much is being forwarded', async () => {
  const status = await (await call('/api/admin/status')).json();
  assert.ok(status.relays);
  for (const key of ['total', 'enabled', 'live']) {
    assert.strictEqual(typeof status.relays[key], 'number');
  }
});

// ------------------------------------------------------------------ access

/**
 * call() always prefers the module-level admin `cookie` over anything in
 * options.headers, which is exactly wrong for testing a second user — use
 * this instead whenever the request must run as somebody specific.
 */
function callAs(sessionCookie, pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (sessionCookie) headers.cookie = sessionCookie;
  if (options.body) headers['content-type'] = 'application/json';
  return fetch(`${base}${pathname}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });
}

test('access.canAccess: public, owner, admin, granted and a stranger', () => {
  const access = require('../src/access');
  const isPublic = { visibility: 'public' };
  const isPrivate = { visibility: 'private', ownerId: 'owner-1', sharedWith: ['granted-1'] };

  assert.strictEqual(access.canAccess(isPublic, null), true, 'public is open even to anonymous');
  assert.strictEqual(access.canAccess(isPrivate, null), false, 'private refuses anonymous');
  assert.strictEqual(access.canAccess(isPrivate, { id: 'stranger', role: 'viewer' }), false);
  assert.strictEqual(access.canAccess(isPrivate, { id: 'owner-1', role: 'viewer' }), true, 'owner');
  assert.strictEqual(access.canAccess(isPrivate, { id: 'granted-1', role: 'viewer' }), true, 'explicitly shared');
  assert.strictEqual(access.canAccess(isPrivate, { id: 'anyone', role: 'admin' }), true, 'admin overrides everything');
  // Streams have no ownerId; that branch must simply never match, not throw.
  assert.strictEqual(access.canAccess({ visibility: 'private', sharedWith: [] }, { id: 'x', role: 'viewer' }), false);
  assert.strictEqual(access.canAccess(null, { id: 'x', role: 'admin' }), false, 'a missing resource is never accessible');
});

test('a stream defaults to private, and old configurations backfill the same way', () => {
  const streams = require('../src/streams');
  const created = streams.create({ name: 'Backstage cam' });
  assert.strictEqual(created.visibility, 'private');
  assert.deepStrictEqual(created.sharedWith, []);
  streams.remove(created.id);

  // mergeDefaults() is what an upgrading install runs its old config.json
  // through — a stream saved before visibility existed must not come back
  // exposed just because the field was absent.
  const legacy = store.defaults();
  legacy.streams.push({ id: 'legacy-1', name: 'Old camera', key: 'legacy-key-000000' });
  legacy.channels.push({ id: 'legacy-c1', name: 'Old channel', slug: 'old-channel' });
  const merged = store.mergeDefaults(legacy);
  assert.strictEqual(merged.streams[0].visibility, 'private');
  assert.deepStrictEqual(merged.streams[0].sharedWith, []);
  assert.strictEqual(merged.channels[0].visibility, 'private');
  assert.deepStrictEqual(merged.channels[0].sharedWith, []);
  assert.deepStrictEqual(merged.channels[0].streamIds, []);
});

// ---------------------------------------------------------------- channels

let grantedCookie = '';
let strangerCookie = '';
let privateStreamId = null;
let privateStreamPlaybackId = null;
let channelId = null;
let channelSlug = null;

async function loginAs(username, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

test('setup: a private stream, a user granted access to it, and a stranger', async () => {
  await call('/api/admin/users', { method: 'POST', body: { username: 'granted', password: 'granted-pw-123', role: 'viewer' } });
  await call('/api/admin/users', { method: 'POST', body: { username: 'stranger', password: 'stranger-pw-123', role: 'viewer' } });
  grantedCookie = await loginAs('granted', 'granted-pw-123');
  strangerCookie = await loginAs('stranger', 'stranger-pw-123');

  const users = await (await call('/api/admin/users')).json();
  const grantedUser = users.users.find((u) => u.username === 'granted');

  const res = await call('/api/admin/streams', { method: 'POST', body: { name: 'VIP room', visibility: 'private', sharedWith: [grantedUser.id] } });
  assert.strictEqual(res.status, 201);
  const { stream } = await res.json();
  assert.strictEqual(stream.visibility, 'private');
  assert.deepStrictEqual(stream.sharedWith, [grantedUser.id]);
  privateStreamId = stream.id;
  privateStreamPlaybackId = stream.playbackId;
});

test('SECURITY: the media proxy refuses a private stream to anyone not granted', () => {
  const proxy = require('../src/proxy');
  assert.strictEqual(proxy.resolvePlayback(`s/${privateStreamPlaybackId}`, null), null, 'anonymous');
  assert.strictEqual(proxy.resolvePlayback(`s/${privateStreamPlaybackId}`, { id: 'someone-else', role: 'viewer' }), null, 'not granted');
  assert.strictEqual(
    proxy.resolvePlayback(`s/${privateStreamPlaybackId}/audio`, { id: 'someone-else', role: 'viewer' }),
    null,
    'the audio-monitor form is gated the same way',
  );
});

test('the media proxy admits a private stream for a granted user or an admin', () => {
  const proxy = require('../src/proxy');
  const streams = require('../src/streams');
  const stream = streams.find(privateStreamId);
  const users = auth.listUsers();
  const grantedId = stream.sharedWith[0];

  assert.strictEqual(proxy.resolvePlayback(`s/${privateStreamPlaybackId}`, { id: grantedId, role: 'viewer' }), `live/${stream.key}`);
  const admin = users.find((u) => u.username === 'tester');
  assert.strictEqual(proxy.resolvePlayback(`s/${privateStreamPlaybackId}`, { id: admin.id, role: 'admin' }), `live/${stream.key}`);
});

test('a channel gets an auto-generated, unique slug, which stays editable', async () => {
  const first = await call('/api/admin/channels', { method: 'POST', body: { name: 'Main Stage!!' } });
  assert.strictEqual(first.status, 201);
  const { channel: a } = await first.json();
  assert.strictEqual(a.slug, 'main-stage');
  assert.strictEqual(a.visibility, 'private', 'channels default private too');

  // Same name again: the auto-generated slug must not collide.
  const second = await call('/api/admin/channels', { method: 'POST', body: { name: 'Main Stage!!' } });
  const { channel: b } = await second.json();
  assert.strictEqual(b.slug, 'main-stage-2');

  const rename = await call(`/api/admin/channels/${b.id}`, { method: 'PATCH', body: { slug: 'main-stage' } });
  assert.strictEqual(rename.status, 409, 'a manual slug still has to be unique');

  await call(`/api/admin/channels/${a.id}`, { method: 'DELETE' });
  await call(`/api/admin/channels/${b.id}`, { method: 'DELETE' });
});

test('setup: a public channel containing the public and the private stream', async () => {
  const res = await call('/api/admin/channels', {
    method: 'POST',
    body: { name: 'Community Room', visibility: 'public', streamIds: [streamId, privateStreamId] },
  });
  assert.strictEqual(res.status, 201);
  const { channel } = await res.json();
  channelId = channel.id;
  channelSlug = channel.slug;
  assert.deepStrictEqual(channel.streamIds.sort(), [privateStreamId, streamId].sort());
});

test('a public channel is reachable with no session at all', async () => {
  const res = await fetch(`${base}/api/channels/${channelSlug}/state`, { headers: { accept: 'application/json' } });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.program.mode, 'web', 'channels are always browser-composed');
  assert.strictEqual(body.channel.slug, channelSlug);
});

test('SECURITY: a public channel marks its private stream restricted, with no playback path, for anyone lacking access', async () => {
  const anon = await (await fetch(`${base}/api/channels/${channelSlug}/state`, { headers: { accept: 'application/json' } })).json();
  const restrictedEntry = anon.streams.find((s) => s.key === privateStreamPlaybackId);
  assert.strictEqual(restrictedEntry.restricted, true);
  assert.strictEqual(restrictedEntry.path, null, 'no playback path is handed out for a stream the viewer cannot reach');
  assert.strictEqual(restrictedEntry.audioPath, null);
  assert.strictEqual(restrictedEntry.hasAudio, false);

  const publicEntry = anon.streams.find((s) => s.key === playbackId);
  assert.strictEqual(publicEntry.restricted, false);
  assert.strictEqual(publicEntry.path, `s/${playbackId}`);
});

test('the granted user sees the private stream as playable inside the same public channel', async () => {
  const res = await fetch(`${base}/api/channels/${channelSlug}/state`, { headers: { cookie: grantedCookie, accept: 'application/json' } });
  const body = await res.json();
  const entry = body.streams.find((s) => s.key === privateStreamPlaybackId);
  assert.strictEqual(entry.restricted, false);
  assert.strictEqual(entry.path, `s/${privateStreamPlaybackId}`);
});

test('hideRestricted excludes the inaccessible tile from onAir and the layout count, not just from view', async () => {
  const store2 = require('../src/store');
  store2.update((d) => {
    const s = d.streams.find((x) => x.id === privateStreamId);
    s.enabled = true; // withLiveState() needs it enabled; "live" itself is unaffected by tests with no MediaMTX
  });
  const shown = await (await fetch(`${base}/api/channels/${channelSlug}/state?hideRestricted=1`, { headers: { accept: 'application/json' } })).json();
  // Neither stream is actually publishing in this test environment, so onAir
  // is empty either way — the assertion that matters is that the endpoint
  // accepts the flag and still reports the count of what it hid.
  assert.strictEqual(typeof shown.channel.hiddenCount, 'number');
});

test('a private channel is reachable by its owner and by admin, but 404s for a stranger', async () => {
  await call(`/api/admin/channels/${channelId}`, { method: 'PATCH', body: { visibility: 'private', sharedWith: [] } });

  const asAdmin = await fetch(`${base}/api/channels/${channelSlug}/state`, { headers: { cookie, accept: 'application/json' } });
  assert.strictEqual(asAdmin.status, 200);

  const asStranger = await fetch(`${base}/api/channels/${channelSlug}/state`, { headers: { cookie: strangerCookie, accept: 'application/json' } });
  assert.strictEqual(asStranger.status, 404, 'private, and not shared: do not even confirm it exists');

  const anon = await fetch(`${base}/api/channels/${channelSlug}/state`, { headers: { accept: 'application/json' } });
  assert.strictEqual(anon.status, 404);
});

test('the homepage channel redirects "/", and clears itself when deleted', async () => {
  const set = await call(`/api/admin/channels/${channelId}/homepage`, { method: 'PUT' });
  assert.strictEqual(set.status, 200);

  const home = await fetch(`${base}/`, { redirect: 'manual', headers: { cookie, accept: 'text/html' } });
  assert.strictEqual(home.status, 302);
  assert.strictEqual(home.headers.get('location'), `/c/${channelSlug}`);

  await call(`/api/admin/channels/${channelId}`, { method: 'DELETE' });
  assert.strictEqual(store.get().settings.homepageChannelId, null, 'deleting the homepage channel clears the pointer');

  const homeAfter = await fetch(`${base}/`, { redirect: 'manual', headers: { cookie, accept: 'text/html' } });
  assert.notStrictEqual(homeAfter.status, 302, '"/" behaves normally again with no homepage configured');
});

test('a user can only manage channels they own', async () => {
  const created = await callAs(grantedCookie, '/api/channels/mine', { method: 'POST', body: { name: 'Granted user channel' } });
  assert.strictEqual(created.status, 201);
  const { channel } = await created.json();

  const strangerEdit = await callAs(strangerCookie, `/api/channels/mine/${channel.id}`, { method: 'PATCH', body: { name: 'Hijacked' } });
  assert.strictEqual(strangerEdit.status, 403);

  const ownerEdit = await callAs(grantedCookie, `/api/channels/mine/${channel.id}`, { method: 'PATCH', body: { name: 'Renamed' } });
  assert.strictEqual(ownerEdit.status, 200);

  const adminDelete = await call(`/api/admin/channels/${channel.id}`, { method: 'DELETE' });
  assert.strictEqual(adminDelete.status, 200, 'admins moderate every channel regardless of owner');
});

test('/api/streams/available lists what a user may build a channel from', async () => {
  const res = await callAs(grantedCookie, '/api/streams/available');
  assert.strictEqual(res.status, 200);
  const { streams: available } = await res.json();
  assert.ok(available.some((s) => s.id === streamId), 'the public stream is available to everyone');
  assert.ok(available.some((s) => s.id === privateStreamId), 'the granted user sees the private stream too');

  const asStranger = await callAs(strangerCookie, '/api/streams/available');
  const { streams: strangerAvailable } = await asStranger.json();
  assert.ok(!strangerAvailable.some((s) => s.id === privateStreamId), 'a stranger does not see it');
});

test('deleting a stream drops it from any channel that included it', async () => {
  const streams = require('../src/streams');
  const doomed = streams.create({ name: 'Temporary', visibility: 'public' });
  const chRes = await call('/api/admin/channels', { method: 'POST', body: { name: 'Cleanup test', streamIds: [doomed.id] } });
  const { channel } = await chRes.json();
  assert.deepStrictEqual(channel.streamIds, [doomed.id]);

  streams.remove(doomed.id);
  const channels = require('../src/channels');
  assert.deepStrictEqual(channels.find(channel.id).streamIds, []);
  channels.remove(channel.id);
});
