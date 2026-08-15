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
  // Writes are synchronous on purpose. A WriteStream opens its descriptor
  // asynchronously, so a burst (an ffmpeg error storm is exactly that) could
  // trigger a second rotation before the first open landed — the rename was
  // then skipped and the file grew without limit, which defeats the point.
  const ch = { name, file, size };
  channels.set(name, ch);
  return ch;
}

function channel(name) {
  return channels.get(name) || openChannel(name);
}

function rotate(ch) {
  try {
    if (state.maxFiles <= 1) {
      // Only one generation is kept, so there is nowhere to rotate to:
      // truncate. Reopening in append mode here would have let the file grow
      // for ever while the size counter believed it had reset.
      fs.writeFileSync(ch.file, '');
      ch.size = 0;
      return;
    }
    for (let i = state.maxFiles - 1; i >= 1; i--) {
      const src = i === 1 ? ch.file : `${ch.file}.${i - 1}`;
      const dst = `${ch.file}.${i}`;
      try {
        fs.renameSync(src, dst);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    // Drop anything beyond the retention window (for instance after maxFiles
    // was lowered at runtime).
    for (let i = state.maxFiles; i < state.maxFiles + 20; i++) {
      try {
        fs.unlinkSync(`${ch.file}.${i}`);
      } catch (_) {
        break;
      }
    }
  } catch (_) {
    /* logging must never take the process down */
  }
  ch.size = 0;
}

function writeRaw(name, line) {
  const ch = channel(name);
  const buf = Buffer.byteLength(line);
  if (ch.size + buf > state.maxSize) rotate(ch);
  try {
    fs.appendFileSync(ch.file, line);
    ch.size += buf;
  } catch (_) {
    /* disk full or permissions: drop the line rather than crash */
  }
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
