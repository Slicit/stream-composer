'use strict';

/**
 * Reverse proxy for the MediaMTX media endpoints.
 *
 * MediaMTX itself is never exposed to the internet: only its RTMP/SRT ingest
 * ports and the WebRTC ICE UDP range are published. Playback signalling
 * (WHEP) and HLS go through here, which means:
 *   - one hostname and one TLS certificate for the whole product,
 *   - viewer authentication is enforced before any media is handed out,
 *   - only known stream paths are reachable.
 *
 * Written against node:http directly so the server keeps a single dependency.
 */

const http = require('http');
const { URL } = require('url');
const config = require('./config');
const store = require('./store');
const logger = require('./logger');

const log = logger.scope('proxy');

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'cookie',
]);

const WEBRTC_MOUNT = '/mtx/webrtc';
const HLS_MOUNT = '/mtx/hls';

/** Only the composed program and configured ingest keys may be played. */
function isAllowedPath(mediaPath) {
  if (!mediaPath) return false;
  const clean = mediaPath.replace(/^\/+/, '');
  if (clean === config.programPath) return true;
  const prefix = `${config.ingestPrefix}/`;
  if (!clean.startsWith(prefix)) return false;
  const key = clean.slice(prefix.length).split('/')[0];
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(key)) return false;
  const d = store.get();
  if (!d.settings.showIndividualStreams) return false;
  const stream = d.streams.find((s) => s.key === key);
  return !!stream && stream.enabled !== false;
}

/** Split "/live/cam1/whep/abc" into the media path and the trailing action. */
function splitTarget(rest) {
  const clean = rest.replace(/^\/+/, '');
  const segments = clean.split('/');
  // Actions we recognise at the end of a MediaMTX media URL.
  const actionIdx = segments.findIndex((s) => s === 'whep' || s === 'whip' || s.endsWith('.m3u8') || s.endsWith('.mp4') || s.endsWith('.ts'));
  if (actionIdx <= 0) return { mediaPath: segments.slice(0, -1).join('/'), ok: false };
  return { mediaPath: segments.slice(0, actionIdx).join('/'), ok: true };
}

function forward({ base, mount, req, res, rest }) {
  let target;
  try {
    target = new URL(`${base}${rest.startsWith('/') ? '' : '/'}${rest}`);
  } catch (_) {
    res.status(400).json({ error: 'Bad media path.' });
    return;
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
  }
  headers.host = target.host;
  // MediaMTX trusts the stack-internal network; strip any inbound forwarding
  // headers so a client cannot spoof its own address to the media server.
  delete headers['x-forwarded-for'];
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto'];

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
        if (HOP_BY_HOP.has(k.toLowerCase())) continue;
        out[k] = v;
      }
      // Rewrite the WHEP session URL so the browser keeps talking to us.
      if (out.location) {
        try {
          const loc = out.location.startsWith('http') ? new URL(out.location).pathname : out.location;
          out.location = `${mount}${loc.startsWith('/') ? '' : '/'}${loc}`;
        } catch (_) {
          /* leave as-is */
        }
      }
      res.status(up.statusCode || 502);
      for (const [k, v] of Object.entries(out)) res.setHeader(k, v);
      up.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    log.warn('upstream media request failed', { url: target.href, error: err.message });
    if (!res.headersSent) res.status(502).json({ error: 'The media server is not responding.' });
    else res.end();
  });

  req.pipe(upstream);
  req.on('aborted', () => upstream.destroy());
}

function mount(app, guard) {
  // ---- WebRTC / WHEP ----
  app.use(WEBRTC_MOUNT, guard, (req, res) => {
    const rest = req.url.split('?')[0];
    const { mediaPath, ok } = splitTarget(rest);
    if (!ok || !isAllowedPath(mediaPath)) {
      return res.status(404).json({ error: 'Unknown stream.' });
    }
    return forward({ base: config.mediamtx.webrtc, mount: WEBRTC_MOUNT, req, res, rest: req.url });
  });

  // ---- Low-latency HLS (fallback for browsers or networks where WebRTC fails) ----
  app.use(HLS_MOUNT, guard, (req, res) => {
    const rest = req.url.split('?')[0];
    const segments = rest.replace(/^\/+/, '').split('/');
    const mediaPath = segments.slice(0, -1).join('/');
    if (!isAllowedPath(mediaPath)) {
      return res.status(404).json({ error: 'Unknown stream.' });
    }
    return forward({ base: config.mediamtx.hls, mount: HLS_MOUNT, req, res, rest: req.url });
  });

  log.info('media proxy mounted', { webrtc: WEBRTC_MOUNT, hls: HLS_MOUNT });
}

module.exports = { mount, WEBRTC_MOUNT, HLS_MOUNT, isAllowedPath };
