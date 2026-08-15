'use strict';

/**
 * Host and process statistics, read straight from /proc where available so we
 * can report what the encoder is actually costing on a CPU-only box.
 */

const fs = require('fs');
const os = require('os');

let lastCpu = null;

function readTotalCpu() {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch (_) {
    return null;
  }
}

/** System-wide CPU usage since the previous call, as a percentage. */
function cpuPercent() {
  const now = readTotalCpu();
  if (!now) {
    // Fall back to load average scaled by core count.
    return Math.min(100, Math.round((os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100));
  }
  if (!lastCpu) {
    lastCpu = now;
    return null;
  }
  const idleDelta = now.idle - lastCpu.idle;
  const totalDelta = now.total - lastCpu.total;
  lastCpu = now;
  if (totalDelta <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10));
}

function memory() {
  let total = os.totalmem();
  let available = os.freemem();
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => {
      const m = new RegExp(`^${k}:\\s+(\\d+) kB`, 'm').exec(info);
      return m ? parseInt(m[1], 10) * 1024 : null;
    };
    total = get('MemTotal') || total;
    available = get('MemAvailable') || available;
  } catch (_) {
    /* not linux */
  }
  return {
    totalMb: Math.round(total / 1048576),
    usedMb: Math.round((total - available) / 1048576),
    percent: Math.round(((total - available) / total) * 1000) / 10,
  };
}

function cpuInfo() {
  const cpus = os.cpus();
  return {
    cores: cpus.length,
    model: (cpus[0] || {}).model || 'unknown',
    speedMhz: (cpus[0] || {}).speed || 0,
    load: os.loadavg().map((n) => Math.round(n * 100) / 100),
  };
}

function snapshot() {
  return {
    cpuPercent: cpuPercent(),
    cpu: cpuInfo(),
    memory: memory(),
    uptimeSec: Math.round(os.uptime()),
    processUptimeSec: Math.round(process.uptime()),
    platform: `${os.platform()} ${os.arch()}`,
    hostname: os.hostname(),
  };
}

module.exports = { snapshot, cpuPercent, cpuInfo, memory };
