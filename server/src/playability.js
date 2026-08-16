'use strict';

/**
 * Can a source be played straight to a browser?
 *
 * Browsers freeze when presentation timestamps stop increasing, so MediaMTX
 * refuses to serve H.264 containing B-frames over WebRTC — it accepts the
 * publish, then closes every playback session with "WebRTC doesn't support
 * H264 streams with B-frames". The viewer sees a black rectangle and nothing
 * explains why.
 *
 * It never mattered while every viewer watched the composed programme: ffmpeg
 * re-encodes, and the compositor's own settings emit no B-frames. It matters
 * the moment a browser reads a source directly — web composition, and the
 * per-source preview buttons in either mode.
 *
 * B-frames are not visible in MediaMTX's track list, so this probes the stream
 * once per publishing session with ffprobe and remembers the answer.
 */

const { execFile } = require('child_process');
const config = require('./config');
const logger = require('./logger');

const log = logger.scope('playability');

// key -> { since, checking, result }
// `since` is the path's readyTime, so a republish re-probes rather than
// reporting a stale verdict about a stream the operator has just fixed.
const cache = new Map();

const PROBE_TIMEOUT_MS = 8000;

function reasonFor(info) {
  if (!info) return null;
  if (info.bFrames > 0) {
    return {
      code: 'b-frames',
      summary: 'This encoder is producing B-frames, which browsers cannot play over WebRTC.',
      fix: 'In OBS: set Tune to "zerolatency", or add bframes=0 to the x264 options — on NVENC or QuickSync set B-frames to 0. Then restart streaming.',
    };
  }
  return null;
}

function ffprobeArgs(url) {
  return [
    '-v', 'error',
    '-rtsp_transport', 'tcp',
    // Give up rather than hang if the source stalls mid-probe.
    '-rw_timeout', String(PROBE_TIMEOUT_MS * 1000),
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,profile,has_b_frames',
    '-of', 'json',
    url,
  ];
}

function runProbe(url) {
  return new Promise((resolve) => {
    const child = execFile(
      config.ffprobePath,
      ffprobeArgs(url),
      { timeout: PROBE_TIMEOUT_MS },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const stream = (JSON.parse(stdout).streams || [])[0];
          if (!stream) return resolve(null);
          resolve({
            codec: stream.codec_name || null,
            profile: stream.profile || null,
            // ffprobe reports the number of frames a decoder must hold back,
            // which is non-zero exactly when the stream carries B-frames.
            bFrames: Number(stream.has_b_frames) || 0,
          });
        } catch (_) {
          resolve(null);
        }
      },
    );
    child.on('error', () => resolve(null));
  });
}

/**
 * Probe a source unless it has already been checked for this publishing
 * session. Never throws and never blocks the caller: the verdict lands in the
 * cache and shows up on the next poll.
 */
function inspect(key, url, since) {
  const entry = cache.get(key);
  if (entry && entry.since === since) return;
  if (entry && entry.checking && entry.since === since) return;

  cache.set(key, { since, checking: true, result: null });
  runProbe(url).then((info) => {
    const current = cache.get(key);
    // A republish while we were probing invalidates this answer.
    if (!current || current.since !== since) return;
    cache.set(key, { since, checking: false, result: info });
    const problem = reasonFor(info);
    if (problem) {
      log.warn('a source cannot be played directly by a browser', {
        key, reason: problem.code, codec: info.codec, profile: info.profile,
      });
    }
  });
}

/** What we know about a source, or null when it has not been probed yet. */
function status(key) {
  const entry = cache.get(key);
  if (!entry || entry.checking || !entry.result) return null;
  const problem = reasonFor(entry.result);
  return {
    codec: entry.result.codec,
    profile: entry.result.profile,
    directPlayback: !problem,
    problem,
  };
}

/** Drop everything we know about a source — used when it stops publishing. */
function forget(key) {
  cache.delete(key);
}

function keep(liveKeys) {
  for (const key of [...cache.keys()]) {
    if (!liveKeys.has(key)) cache.delete(key);
  }
}

module.exports = { inspect, status, forget, keep, reasonFor };
