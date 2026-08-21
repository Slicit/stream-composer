'use strict';

/**
 * Reverse proxy for the MediaMTX media endpoints.
 *
 * MediaMTX itself is never exposed to the internet: only its RTMP/SRT ingest
 * ports and the WebRTC ICE UDP range are published. Playback signalling
 * (WHEP) and HLS go through here.
 *
 * Security rules this file enforces — every one of them exists because the
 * naive version was exploitable:
 *
 *  1. Viewers address streams by an opaque *playback id*, never by the ingest
 *     stream key. The key is a publishing credential and must not reach a
 *     browser, not even in a `Location` header.
 *  2. The forwarded URL is rebuilt from validated components. Nothing from the
 *     client's raw path is passed upstream, so percent-encoded traversal
 *     (`%2e%2e`) cannot make the validated path and the forwarded path differ.
 *  3. Only playback actions are routed. WHIP is a *publish* verb and is
 *     rejected outright, as is anything that would reach MediaMTX's built-in
 *     publish page.
 *  4. The client's `Authorization` header is stripped and replaced with the
 *     stack-internal credential. Forwarding it would expose that credential to
 *     unlimited guessing from the internet.
 *
 * Written against node:http directly so the server keeps a single dependency.
 */

const http = require('http');
const { URL } = require('url');
const config = require('./config');
const store = require('./store');
const logger = require('./logger');

const log = logger.scope('proxy');

// Headers that must never be relayed in either direction. `authorization` and
// `cookie` are ours to control, not the client's.
const STRIP_REQUEST = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'cookie',
  'authorization', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
  'forwarded',
]);

const STRIP_RESPONSE = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'transfer-encoding',
  'upgrade', 'www-authenticate',
]);

// Our own session cookie is never something upstream gets to set.
const PROTECTED_COOKIE = 'sc_session';

const WEBRTC_MOUNT = '/mtx/webrtc';
const HLS_MOUNT = '/mtx/hls';

/** The public alias for the composed programme, independent of its internal path. */
const PUBLIC_PROGRAM = 'program';

const PLAYBACK_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SESSION_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const HLS_FILE = /^[A-Za-z0-9_.-]{1,128}\.(m3u8|mp4|m4s|ts|mps)$/;
const SAFE_QUERY = /^[A-Za-z0-9_.\-=&%~+/]*$/;

/**
 * A playback id resolves to a stream only when it is both known and, per the
 * same visibility rule as the video path, allowed to be addressed at all.
 * Shared by the video and the audio-monitor forms of resolvePlayback below.
 */
function resolveStream(playbackId) {
  const d = store.get();
  // "Show individual sources to viewers" hides the sources *behind* the
  // programme. In web mode there is no programme — the sources are what the
  // player composes — so the setting cannot apply without hiding everything.
  if (!d.settings.showIndividualStreams && d.composition.mode !== 'web') return null;
  const stream = d.streams.find((s) => s.playbackId === playbackId);
  if (!stream || stream.enabled === false) return null;
  return stream;
}

/**
 * Map a public playback reference onto the real MediaMTX path.
 * Returns null when the reference is unknown or not currently playable.
 */
function resolvePlayback(publicPath) {
  if (publicPath === PUBLIC_PROGRAM) return config.programPath;

  const parts = publicPath.split('/');

  // The Opus audio monitor: `s/<playbackId>/audio`, distinct from the raw
  // (AAC) ingest path a browser cannot decode over WebRTC. See audioRelay.js.
  if (parts.length === 3 && parts[0] === 's' && parts[2] === 'audio' && PLAYBACK_ID.test(parts[1])) {
    const stream = resolveStream(parts[1]);
    return stream ? `${config.audioPrefix}/${stream.key}` : null;
  }

  if (parts.length !== 2 || parts[0] !== 's' || !PLAYBACK_ID.test(parts[1])) return null;
  const stream = resolveStream(parts[1]);
  return stream ? `${config.ingestPrefix}/${stream.key}` : null;
}

/**
 * Strictly parse a proxied request into validated components.
 * Anything unexpected returns null — there is no lenient path here.
 */
function parseRequest(rawUrl, kind) {
  const queryAt = rawUrl.indexOf('?');
  const pathPart = queryAt >= 0 ? rawUrl.slice(0, queryAt) : rawUrl;
  const query = queryAt >= 0 ? rawUrl.slice(queryAt + 1) : '';

  // Reject percent-encoding wholesale. Every path this proxy serves is built
  // from an unreserved character set, so an encoded byte can only be an
  // attempt to smuggle a separator past validation.
  if (pathPart.includes('%') || pathPart.includes('\\')) return null;
  if (!SAFE_QUERY.test(query)) return null;

  const segments = pathPart.split('/').filter((s) => s !== '');
  // Up to 5: `s/<playbackId>/audio/whep/<sessionId>` for the audio monitor.
  if (segments.length < 2 || segments.length > 5) return null;
  if (segments.some((s) => s === '.' || s === '..')) return null;

  if (kind === 'webrtc') {
    const idx = segments.indexOf('whep');
    // `whep` must be the last segment, or the one before a session id.
    if (idx < 1 || idx < segments.length - 2) return null;
    const sessionId = segments[idx + 1];
    if (sessionId !== undefined && !SESSION_ID.test(sessionId)) return null;

    const publicPath = segments.slice(0, idx).join('/');
    const mediaPath = resolvePlayback(publicPath);
    if (!mediaPath) return null;

    return {
      publicPath,
      mediaPath,
      upstreamPath: `/${mediaPath}/whep${sessionId ? `/${sessionId}` : ''}`,
      query,
      sessionId,
    };
  }

  // HLS: the last segment is a playlist or a segment file.
  const file = segments[segments.length - 1];
  if (!HLS_FILE.test(file)) return null;
  const publicPath = segments.slice(0, -1).join('/');
  const mediaPath = resolvePlayback(publicPath);
  if (!mediaPath) return null;

  return { publicPath, mediaPath, upstreamPath: `/${mediaPath}/${file}`, query };
}

/**
 * Map an upstream redirect back into our address space.
 * `/live/<key>/index.m3u8?x=1` becomes `/mtx/hls/s/<playbackId>/index.m3u8?x=1`.
 */
function rewriteLocation(location, mount, parsed) {
  let pathname = location;
  let search = '';
  try {
    if (/^https?:\/\//i.test(location)) {
      const u = new URL(location);
      pathname = u.pathname;
      search = u.search;
    } else {
      const q = location.indexOf('?');
      if (q >= 0) {
        pathname = location.slice(0, q);
        search = location.slice(q);
      }
    }
  } catch (_) {
    return `${mount}/${parsed.publicPath}`;
  }

  const prefix = `/${parsed.mediaPath}`;
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
    const suffix = pathname.slice(prefix.length);
    return `${mount}/${parsed.publicPath}${suffix}${search}`;
  }
  // Anything unexpected goes back to the public entry point rather than
  // exposing wherever upstream was pointing.
  return `${mount}/${parsed.publicPath}${search}`;
}

function internalAuthHeader() {
  if (!config.mediamtx.internalPassword) return null;
  const raw = `${config.mediamtx.internalUser}:${config.mediamtx.internalPassword}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

function forward({ base, mount, req, res, parsed }) {
  let target;
  try {
    target = new URL(`${base}${parsed.upstreamPath}${parsed.query ? `?${parsed.query}` : ''}`);
  } catch (_) {
    res.status(400).json({ error: 'Bad media path.' });
    return;
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!STRIP_REQUEST.has(k.toLowerCase())) headers[k] = v;
  }
  headers.host = target.host;

  // The stack-internal credential is added here and only here.
  const auth = internalAuthHeader();
  if (auth) headers.authorization = auth;

  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (up) => {
      const out = {};
      for (const [k, v] of Object.entries(up.headers)) {
        if (STRIP_RESPONSE.has(k.toLowerCase())) continue;
        out[k] = v;
      }

      // Rewrite redirects so the browser keeps talking to us, and so the
      // internal path — which contains the ingest key — never leaks. This
      // covers both the WHEP session URL and MediaMTX's HLS `cookieCheck`
      // bounce; a WHEP-specific rewrite mangled the latter into a dead end.
      if (out.location) {
        out.location = rewriteLocation(String(out.location), mount, parsed);
      }

      // MediaMTX sets a `cookieCheck` cookie as part of that bounce, so its
      // cookies have to survive — but never one that could shadow our session.
      if (out['set-cookie']) {
        const cookies = [].concat(out['set-cookie']).filter((c) => !String(c).trim().toLowerCase().startsWith(`${PROTECTED_COOKIE}=`));
        if (cookies.length) out['set-cookie'] = cookies;
        else delete out['set-cookie'];
      }

      res.status(up.statusCode || 502);
      for (const [k, v] of Object.entries(out)) res.setHeader(k, v);
      up.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    log.warn('upstream media request failed', { path: parsed.upstreamPath, error: err.message });
    if (!res.headersSent) res.status(502).json({ error: 'The media server is not responding.' });
    else res.end();
  });

  req.pipe(upstream);
  req.on('aborted', () => upstream.destroy());
}

function mount(app, guard) {
  // ---- WebRTC / WHEP (playback only) ----
  //
  // GET is deliberately absent: MediaMTX serves its built-in publish and read
  // pages over GET, and WHIP (publishing) is never routed from here at all.
  app.use(WEBRTC_MOUNT, guard, (req, res) => {
    if (!['POST', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) {
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    const parsed = parseRequest(req.url, 'webrtc');
    if (!parsed) return res.status(404).json({ error: 'Unknown stream.' });
    return forward({ base: config.mediamtx.webrtc, mount: WEBRTC_MOUNT, req, res, parsed });
  });

  // ---- Low-latency HLS (fallback where WebRTC cannot get through) ----
  app.use(HLS_MOUNT, guard, (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    const parsed = parseRequest(req.url, 'hls');
    if (!parsed) return res.status(404).json({ error: 'Unknown stream.' });
    return forward({ base: config.mediamtx.hls, mount: HLS_MOUNT, req, res, parsed });
  });

  log.info('media proxy mounted', { webrtc: WEBRTC_MOUNT, hls: HLS_MOUNT });
}

module.exports = { mount, WEBRTC_MOUNT, HLS_MOUNT, resolvePlayback, parseRequest, PUBLIC_PROGRAM };
