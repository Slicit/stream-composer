'use strict';

/**
 * Thin client for the MediaMTX control API (v3) plus a few helpers for
 * turning API state into something the UI can render.
 */

const config = require('./config');
const logger = require('./logger');

const log = logger.scope('mediamtx');

let lastError = null;
let reachable = false;

async function api(pathname, { method = 'GET', body, timeoutMs = 4000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.mediamtx.api}${pathname}`, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${pathname} -> ${res.status} ${text.slice(0, 200)}`);
    }
    if (res.status === 204) {
      reachable = true;
      lastError = null;
      return null;
    }
    // Read the body *before* clearing the timeout, otherwise a half-open
    // response leaves the caller hanging with the abort no longer armed.
    const ct = res.headers.get('content-type') || '';
    const parsed = ct.includes('json') ? await res.json() : await res.text();
    reachable = true;
    lastError = null;
    return parsed;
  } catch (err) {
    reachable = false;
    lastError = err.message;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** All paths known to MediaMTX, whether or not they are publishing. */
async function listPaths() {
  const out = [];
  let page = 0;
  for (;;) {
    const data = await api(`/v3/paths/list?page=${page}&itemsPerPage=200`);
    const items = (data && data.items) || [];
    out.push(...items);
    const pages = (data && data.pageCount) || 1;
    if (page >= pages - 1) break;
    page += 1;
  }
  return out;
}

function trackSummary(item) {
  const tracks = item.tracks || [];
  return {
    video: tracks.find((t) => /h264|h265|av1|vp8|vp9|video/i.test(t)) || null,
    audio: tracks.find((t) => /aac|opus|mpeg4-audio|audio|pcm/i.test(t)) || null,
    all: tracks,
  };
}

/**
 * Live ingest streams, i.e. ready paths under the ingest prefix, excluding the
 * composed program itself (which we publish back into MediaMTX).
 */
async function listIngest() {
  const prefix = `${config.ingestPrefix}/`;
  const paths = await listPaths();
  return paths
    .filter((p) => typeof p.name === 'string' && p.name.startsWith(prefix))
    .map((p) => {
      const key = p.name.slice(prefix.length);
      return {
        path: p.name,
        key,
        ready: !!p.ready,
        readyTime: p.readyTime || null,
        bytesReceived: p.bytesReceived || 0,
        bytesSent: p.bytesSent || 0,
        readers: Array.isArray(p.readers) ? p.readers.length : 0,
        source: p.source ? p.source.type : null,
        tracks: trackSummary(p),
      };
    })
    .filter((p) => p.key && !p.key.includes('/'));
}

async function programState() {
  const paths = await listPaths().catch(() => []);
  const p = paths.find((x) => x.name === config.programPath);
  if (!p) return { ready: false, readers: 0, bytesSent: 0 };
  return {
    ready: !!p.ready,
    readers: Array.isArray(p.readers) ? p.readers.length : 0,
    bytesSent: p.bytesSent || 0,
    tracks: trackSummary(p).all,
  };
}

/** Kick a publisher off a path (used when a stream key is revoked). */
async function kickPublisher(pathName) {
  const kinds = ['rtmpconns', 'srtconns', 'rtspconns', 'webrtcsessions', 'rtspsessions'];
  for (const kind of kinds) {
    try {
      const data = await api(`/v3/${kind}/list?itemsPerPage=200`);
      for (const item of (data && data.items) || []) {
        if (item.path === pathName && (item.state === 'publish' || item.state === 'read' || !item.state)) {
          await api(`/v3/${kind}/kick/${item.id}`, { method: 'POST' }).catch(() => {});
          log.info('kicked connection', { kind, id: item.id, path: pathName });
        }
      }
    } catch (_) {
      /* endpoint may not exist depending on enabled protocols */
    }
  }
}

async function waitUntilReachable({ attempts = 60, delayMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      await api('/v3/paths/list?itemsPerPage=1', { timeoutMs: 2000 });
      log.info('control API reachable', { url: config.mediamtx.api });
      return true;
    } catch (err) {
      if (i === 0) log.info('waiting for the MediaMTX control API…', { url: config.mediamtx.api });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  log.error('gave up waiting for the MediaMTX control API', lastError);
  return false;
}

function health() {
  return { reachable, lastError, api: config.mediamtx.api };
}

module.exports = { api, listPaths, listIngest, programState, kickPublisher, waitUntilReachable, health };
