'use strict';

/**
 * Dependency-free logger with size-based rotation.
 *
 * Files:  <logDir>/<name>.log, <name>.log.1 ... <name>.log.<maxFiles-1>
 * When <name>.log exceeds maxSizeMb it is rotated; the oldest file is dropped,
 * so total disk usage is bounded by maxSizeMb * maxFiles per channel.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const state = {
  level: LEVELS[config.logLevel] ?? LEVELS.info,
  maxSize: config.logMaxSizeMb * 1024 * 1024,
  maxFiles: Math.max(1, config.logMaxFiles),
  console: config.logConsole,
  dir: config.logDir,
};

const channels = new Map();

function ensureDir() {
  try {
    fs.mkdirSync(state.dir, { recursive: true });
  } catch (_) {
    /* best effort */
  }
}

function openChannel(name) {
  ensureDir();
  const file = path.join(state.dir, `${name}.log`);
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch (_) {
    size = 0;
  }
  const ch = { name, file, size, stream: fs.createWriteStream(file, { flags: 'a' }) };
  ch.stream.on('error', () => {
    /* never crash the process because of logging */
  });
  channels.set(name, ch);
  return ch;
}

function channel(name) {
  return channels.get(name) || openChannel(name);
}

function rotate(ch) {
  try {
    ch.stream.end();
    for (let i = state.maxFiles - 1; i >= 1; i--) {
      const src = i === 1 ? ch.file : `${ch.file}.${i - 1}`;
      const dst = `${ch.file}.${i}`;
      if (fs.existsSync(src)) {
        if (i === state.maxFiles - 1 && fs.existsSync(dst)) fs.unlinkSync(dst);
        fs.renameSync(src, dst);
      }
    }
  } catch (_) {
    /* ignore */
  }
  ch.size = 0;
  ch.stream = fs.createWriteStream(ch.file, { flags: 'a' });
  ch.stream.on('error', () => {});
}

function writeRaw(name, line) {
  const ch = channel(name);
  const buf = Buffer.byteLength(line);
  if (ch.size + buf > state.maxSize) rotate(ch);
  ch.size += buf;
  ch.stream.write(line);
}

function fmt(level, scope, msg, extra) {
  const ts = new Date().toISOString();
  let line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (extra !== undefined) {
    try {
      line += ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
    } catch (_) {
      line += ' [unserialisable]';
    }
  }
  return `${line}\n`;
}

function log(level, scope, msg, extra) {
  if ((LEVELS[level] ?? 2) > state.level) return;
  const line = fmt(level, scope, msg, extra);
  writeRaw('server', line);
  if (state.console) process.stdout.write(line);
}

function makeScoped(scope) {
  return {
    error: (m, e) => log('error', scope, m, e),
    warn: (m, e) => log('warn', scope, m, e),
    info: (m, e) => log('info', scope, m, e),
    debug: (m, e) => log('debug', scope, m, e),
  };
}

/** Raw pass-through channel used for ffmpeg stderr. */
function ffmpeg(line) {
  if (!config.logFfmpeg) return;
  writeRaw('ffmpeg', line.endsWith('\n') ? line : `${line}\n`);
}

function configure({ level, maxSizeMb, maxFiles, console: useConsole } = {}) {
  if (level && LEVELS[level] !== undefined) state.level = LEVELS[level];
  if (Number.isFinite(maxSizeMb) && maxSizeMb > 0) state.maxSize = maxSizeMb * 1024 * 1024;
  if (Number.isFinite(maxFiles) && maxFiles >= 1) state.maxFiles = Math.floor(maxFiles);
  if (useConsole !== undefined) state.console = !!useConsole;
}

/** Tail the last N lines of a channel, newest last. */
function tail(name, lines = 200) {
  const file = path.join(state.dir, `${name}.log`);
  try {
    const stat = fs.statSync(file);
    const readBytes = Math.min(stat.size, 512 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, stat.size - readBytes);
    fs.closeSync(fd);
    const all = buf.toString('utf8').split('\n').filter(Boolean);
    return all.slice(-lines);
  } catch (_) {
    return [];
  }
}

function stats() {
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(state.dir);
  } catch (_) {
    return out;
  }
  for (const f of files) {
    try {
      const s = fs.statSync(path.join(state.dir, f));
      out.push({ file: f, bytes: s.size, modified: s.mtime.toISOString() });
    } catch (_) {
      /* ignore */
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

module.exports = {
  scope: makeScoped,
  configure,
  ffmpeg,
  tail,
  stats,
  LEVELS,
};
