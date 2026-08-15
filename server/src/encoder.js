'use strict';

/**
 * Encoder and filter capability detection.
 *
 * The product targets CPU-only boxes, so libx264 is the default and the
 * reference for the sizing tables. Hardware encoders are used only when they
 * are actually present *and* the operator asked for them (or asked for 'auto',
 * in which case we prefer hardware because it frees the CPU for scaling).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const config = require('./config');
const logger = require('./logger');

const log = logger.scope('encoder');

const caps = {
  probed: false,
  ffmpegVersion: null,
  encoders: new Set(),
  filters: new Set(),
  drawtext: false,
  vaapiDevice: false,
  nvidia: false,
  cores: os.cpus().length,
  cpuModel: (os.cpus()[0] || {}).model || 'unknown',
  cpuSpeedMhz: (os.cpus()[0] || {}).speed || 0,
};

function run(bin, args, timeoutMs = 10000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function probe() {
  const version = await run(config.ffmpegPath, ['-hide_banner', '-version']);
  if (version.err) {
    log.error('ffmpeg is not usable', version.err.message);
    caps.probed = true;
    return caps;
  }
  caps.ffmpegVersion = (version.stdout.split('\n')[0] || '').trim();

  const enc = await run(config.ffmpegPath, ['-hide_banner', '-encoders']);
  for (const line of enc.stdout.split('\n')) {
    const m = /^\s*[A-Z.]{6}\s+(\S+)/.exec(line);
    if (m) caps.encoders.add(m[1]);
  }

  const filt = await run(config.ffmpegPath, ['-hide_banner', '-filters']);
  for (const line of filt.stdout.split('\n')) {
    const m = /^\s*[TSC.]{3}\s+(\S+)/.exec(line);
    if (m) caps.filters.add(m[1]);
  }
  caps.drawtext = caps.filters.has('drawtext');

  // drawtext needs an explicit font file unless fontconfig is available, and it
  // is not in every minimal image. Find one once, at boot.
  const fontCandidates = [
    process.env.LABEL_FONT_FILE,
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
    '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/noto/NotoSans-Regular.ttf',
  ].filter(Boolean);
  caps.fontFile = fontCandidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch (_) {
      return false;
    }
  }) || null;
  if (caps.drawtext && !caps.fontFile) {
    log.warn('no font file found — cell labels will fall back to the fontconfig default and may not render');
  }

  try {
    caps.vaapiDevice = fs.existsSync(config.vaapiDevice);
  } catch (_) {
    caps.vaapiDevice = false;
  }
  try {
    caps.nvidia = fs.existsSync('/dev/nvidia0') || fs.existsSync('/dev/nvidiactl');
  } catch (_) {
    caps.nvidia = false;
  }

  caps.probed = true;
  log.info('capabilities detected', {
    ffmpeg: caps.ffmpegVersion,
    cores: caps.cores,
    cpu: caps.cpuModel,
    drawtext: caps.drawtext,
    x264: caps.encoders.has('libx264'),
    vaapi: caps.encoders.has('h264_vaapi') && caps.vaapiDevice,
    nvenc: caps.encoders.has('h264_nvenc') && caps.nvidia,
    qsv: caps.encoders.has('h264_qsv'),
  });
  return caps;
}

/** Which encoders can actually be used on this machine right now. */
function available() {
  const list = [{ id: 'x264', label: 'libx264 (CPU)', usable: caps.encoders.has('libx264'), reason: caps.encoders.has('libx264') ? '' : 'not built into ffmpeg' }];
  list.push({
    id: 'vaapi',
    label: 'VA-API (Intel/AMD GPU)',
    usable: caps.encoders.has('h264_vaapi') && caps.vaapiDevice,
    reason: !caps.encoders.has('h264_vaapi') ? 'not built into ffmpeg' : !caps.vaapiDevice ? `${config.vaapiDevice} not present in the container` : '',
  });
  list.push({
    id: 'nvenc',
    label: 'NVENC (NVIDIA GPU)',
    usable: caps.encoders.has('h264_nvenc') && caps.nvidia,
    reason: !caps.encoders.has('h264_nvenc') ? 'not built into ffmpeg' : !caps.nvidia ? 'no NVIDIA device in the container' : '',
  });
  list.push({
    id: 'qsv',
    label: 'Quick Sync (Intel)',
    usable: caps.encoders.has('h264_qsv') && caps.vaapiDevice,
    reason: !caps.encoders.has('h264_qsv') ? 'not built into ffmpeg' : !caps.vaapiDevice ? `${config.vaapiDevice} not present in the container` : '',
  });
  return list;
}

/** Resolve the configured preference to something usable, CPU as the floor. */
function resolve(requested) {
  const want = String(config.encoderOverride || requested || 'auto').toLowerCase();
  const usable = new Set(available().filter((e) => e.usable).map((e) => e.id));

  if (want !== 'auto') {
    if (usable.has(want)) return want;
    log.warn(`requested encoder "${want}" is unavailable, falling back to libx264`);
    return 'x264';
  }
  for (const candidate of ['nvenc', 'vaapi', 'qsv']) {
    if (usable.has(candidate)) return candidate;
  }
  return 'x264';
}

/**
 * Output-stage ffmpeg arguments for the resolved encoder.
 * `comp` is the composition settings object from the store.
 */
function outputArgs(kind, comp) {
  const gop = Math.max(1, Math.round((comp.gopSeconds || 2) * (comp.fps || 30)));
  const common = [
    '-r', String(comp.fps || 30),
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-sc_threshold', '0',
    '-b:v', `${comp.bitrateKbps}k`,
    '-maxrate', `${comp.maxrateKbps || comp.bitrateKbps}k`,
    '-bufsize', `${comp.bufsizeKbps || comp.bitrateKbps * 2}k`,
  ];

  switch (kind) {
    case 'nvenc':
      return [
        '-c:v', 'h264_nvenc',
        '-preset', 'p1',
        '-tune', 'ull',
        '-rc', 'cbr',
        '-zerolatency', '1',
        ...common,
      ];
    case 'vaapi':
      return [
        '-c:v', 'h264_vaapi',
        '-rc_mode', 'CBR',
        '-compression_level', '1',
        ...common,
      ];
    case 'qsv':
      // No hwupload for this path: the filtergraph ends in software NV12 and
      // h264_qsv takes it directly. Uploading to a VAAPI frames context (which
      // is what -vaapi_device would give us) produces frames this encoder
      // cannot accept, and the graph fails to configure.
      return [
        '-c:v', 'h264_qsv',
        '-preset', 'veryfast',
        '-low_power', '1',
        ...common,
      ];
    case 'x264':
    default: {
      const args = [
        '-c:v', 'libx264',
        '-preset', comp.preset || 'ultrafast',
        '-tune', 'zerolatency',
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
        ...common,
        '-x264-params', `nal-hrd=cbr:keyint=${gop}:min-keyint=${gop}:scenecut=0`,
      ];
      if (comp.threads && comp.threads > 0) args.push('-threads', String(comp.threads));
      return args;
    }
  }
}

module.exports = { probe, caps, available, resolve, outputArgs };
