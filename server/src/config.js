'use strict';

const path = require('path');

function bool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function stripTrailingSlash(s) {
  return String(s || '').replace(/\/+$/, '');
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', '.data');

const config = {
  // --- HTTP ---
  port: int(process.env.PORT, 3000),
  bindAddress: process.env.BIND_ADDRESS || '0.0.0.0',
  // Trusting forwarded headers by default would let any client dictate its own
  // address and walk straight past the sign-in throttle. Opt in, with a hop
  // count, only when there really is a proxy in front (the TLS overlay sets it).
  trustProxy: process.env.TRUST_PROXY === undefined || process.env.TRUST_PROXY === ''
    ? false
    : /^\d+$/.test(process.env.TRUST_PROXY)
      ? parseInt(process.env.TRUST_PROXY, 10)
      : bool(process.env.TRUST_PROXY, false),

  // --- Storage ---
  dataDir,
  configFile: path.join(dataDir, 'config.json'),
  logDir: process.env.LOG_DIR || path.join(dataDir, 'logs'),

  // --- Logging (defaults; runtime values live in the store) ---
  logLevel: process.env.LOG_LEVEL || 'info',
  logMaxSizeMb: int(process.env.LOG_MAX_SIZE_MB, 20),
  logMaxFiles: int(process.env.LOG_MAX_FILES, 5),
  logConsole: bool(process.env.LOG_CONSOLE, true),
  logFfmpeg: bool(process.env.LOG_FFMPEG, true),

  // --- MediaMTX ---
  mediamtx: {
    api: stripTrailingSlash(process.env.MEDIAMTX_API || 'http://mediamtx:9997'),
    rtmp: stripTrailingSlash(process.env.MEDIAMTX_RTMP || 'rtmp://mediamtx:1935'),
    webrtc: stripTrailingSlash(process.env.MEDIAMTX_WEBRTC || 'http://mediamtx:8889'),
    hls: stripTrailingSlash(process.env.MEDIAMTX_HLS || 'http://mediamtx:8888'),
    // RTSP is the stack's internal transport: the compositor reads its sources
    // and publishes the programme over it. It shares a host with the RTMP
    // endpoint above, so only the port is configurable — and only needs
    // changing when MediaMTX is not on its default port.
    rtspPort: int(process.env.MEDIAMTX_RTSP_PORT, 8554),
    // Internal credentials the compositor uses to read/publish inside the stack.
    internalUser: process.env.MEDIAMTX_INTERNAL_USER || 'composer',
    internalPassword: process.env.MEDIAMTX_INTERNAL_PASSWORD || '',
  },

  // --- Public endpoints advertised to operators (OBS setup screens) ---
  publicUrl: stripTrailingSlash(process.env.PUBLIC_URL || ''),
  rtmpHost: process.env.RTMP_PUBLIC_HOST || '',
  rtmpPort: int(process.env.RTMP_PUBLIC_PORT, 1935),
  rtmpsPort: int(process.env.RTMPS_PUBLIC_PORT, 1936),
  rtmpsEnabled: bool(process.env.RTMPS_ENABLED, false),
  srtPort: int(process.env.SRT_PUBLIC_PORT, 8890),
  srtEnabled: bool(process.env.SRT_ENABLED, true),

  // Path prefix used for ingest, e.g. rtmp://host/live/<key>
  ingestPrefix: process.env.INGEST_PREFIX || 'live',
  // Path the composed program is published to.
  programPath: process.env.PROGRAM_PATH || 'program',

  // --- Bootstrap admin ---
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',

  // --- Sessions ---
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionTtlHours: int(process.env.SESSION_TTL_HOURS, 24 * 14),
  secureCookies: bool(process.env.SECURE_COOKIES, false),

  // --- Encoding ---
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  encoderOverride: process.env.ENCODER || '', // auto|x264|vaapi|nvenc|qsv
  vaapiDevice: process.env.VAAPI_DEVICE || '/dev/dri/renderD128',

  // --- Compositor behaviour ---
  pollIntervalMs: int(process.env.POLL_INTERVAL_MS, 2000),
  version: process.env.APP_VERSION || 'dev',
};

module.exports = config;
