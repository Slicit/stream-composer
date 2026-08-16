#!/usr/bin/env node
'use strict';

/**
 * Self-test: render one frame of the real grid, using the real code.
 *
 * Builds the actual ffmpeg command the compositor would run for N sources,
 * swaps the live RTSP inputs for synthetic test patterns, and renders a PNG.
 * If this produces a sane image, the layout maths, filtergraph, scaler, label
 * drawing and encoder settings on this machine are all sound.
 *
 *   node scripts/selftest.js                  # 4 sources -> selftest.png
 *   node scripts/selftest.js --count 9 --layout spotlight --out grid.png
 *   node scripts/selftest.js --count 3 --encode   # also encode 5s of video
 */

const { spawn } = require('child_process');
const path = require('path');

process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '.selftest-data');

const encoder = require('../server/src/encoder');
const compositor = require('../server/src/compositor');
const store = require('../server/src/store');

function parseArgs(argv) {
  const out = { count: 4, layout: null, out: 'selftest.png', encode: false, seconds: 5 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--count') out.count = parseInt(argv[++i], 10);
    else if (arg === '--layout') out.layout = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
    else if (arg === '--seconds') out.seconds = parseInt(argv[++i], 10);
    else if (arg === '--labels') out.labels = argv[++i];
    else if (arg === '--encode') out.encode = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*\*/, ''));
      process.exit(0);
    }
  }
  return out;
}

/** Replace every "-i rtsp://…" with a synthetic source of the same shape. */
function substituteInputs(args, count) {
  const out = [];
  let sourceIndex = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-i' && String(args[i + 1] || '').startsWith('rtsp://')) {
      out.push('-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30,format=yuv420p`);
      sourceIndex += 1;
      i += 1;
      continue;
    }
    // Input-only flags that lavfi does not accept.
    if (['-rtsp_transport', '-use_wallclock_as_timestamps', '-thread_queue_size', '-fflags'].includes(args[i])) {
      i += 1;
      continue;
    }
    out.push(args[i]);
  }
  if (sourceIndex !== count) {
    throw new Error(`expected ${count} inputs, rewrote ${sourceIndex}`);
  }
  return out;
}

/** Swap the RTSP output for a still image or a local file. */
function substituteOutput(args, { still, outFile, seconds }) {
  const idx = args.lastIndexOf('-f');
  const trimmed = args.slice(0, idx); // drop "-f rtsp -rtsp_transport tcp <url>"
  const cleaned = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '-progress' || trimmed[i] === '-muxdelay' || trimmed[i] === '-muxpreload') {
      i += 1;
      continue;
    }
    if (trimmed[i] === '-nostats') continue;
    cleaned.push(trimmed[i]);
  }
  if (still) {
    // Drop the encoder settings; we only want one PNG frame.
    const upto = cleaned.indexOf('-c:v');
    const head = upto >= 0 ? cleaned.slice(0, upto) : cleaned;
    return [...head, '-frames:v', '1', '-update', '1', '-y', outFile];
  }
  return [...cleaned, '-t', String(seconds), '-y', outFile];
}

function run(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('exit', (code) => resolve({ code, stderr }));
    child.on('error', (err) => resolve({ code: -1, stderr: err.message }));
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  store.load();
  if (opts.layout) {
    store.update((d) => {
      d.composition.layout = opts.layout;
    });
  }
  await encoder.probe();

  const comp = store.get().composition;
  // `label` is what gets burnt into the cell — the stream's nickname when it
  // has one, otherwise its name. Override with --labels "Alice,Bob,Studio C".
  const custom = opts.labels ? opts.labels.split(',') : [];
  const sources = Array.from({ length: opts.count }, (_, i) => ({
    key: `cam_${i + 1}`,
    name: `Camera ${i + 1}`,
    label: (custom[i] || '').trim() || `Camera ${i + 1}`,
    path: `live/cam_${i + 1}`,
    hasAudio: false,
  }));

  const kind = encoder.resolve(comp.encoder);
  const { args, layout } = compositor.buildArgs(sources, comp, kind);

  process.stdout.write(`\nStream Composer self-test\n`);
  process.stdout.write(`  sources   ${opts.count}\n`);
  process.stdout.write(`  layout    ${layout.layout} (${layout.cols}x${layout.rows})\n`);
  process.stdout.write(`  canvas    ${layout.width}x${layout.height} @ ${comp.fps} fps\n`);
  process.stdout.write(`  encoder   ${kind}\n`);
  process.stdout.write(`  cells     ${layout.cells.map((c) => `${c.w}x${c.h}+${c.x}+${c.y}`).join('  ')}\n\n`);

  const stillArgs = substituteOutput(substituteInputs(args, opts.count), { still: true, outFile: opts.out });
  const still = await run(process.env.FFMPEG_PATH || 'ffmpeg', stillArgs);
  if (still.code !== 0) {
    process.stderr.write(`Rendering the still failed (exit ${still.code}):\n${still.stderr}\n`);
    process.stderr.write(`\nCommand:\nffmpeg ${stillArgs.join(' ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`  wrote ${opts.out}\n`);

  if (opts.encode) {
    const videoFile = opts.out.replace(/\.png$/, '') + '.mp4';
    const videoArgs = substituteOutput(substituteInputs(args, opts.count), { still: false, outFile: videoFile, seconds: opts.seconds });
    const started = Date.now();
    const video = await run(process.env.FFMPEG_PATH || 'ffmpeg', videoArgs);
    if (video.code !== 0) {
      process.stderr.write(`Encoding failed (exit ${video.code}):\n${video.stderr}\n`);
      process.exit(1);
    }
    const wall = (Date.now() - started) / 1000;
    const speed = opts.seconds / wall;
    process.stdout.write(`  wrote ${videoFile}  (${wall.toFixed(1)}s wall for ${opts.seconds}s of video — ${speed.toFixed(2)}x real time)\n`);
    if (speed < 1) {
      process.stdout.write('  this machine cannot keep up with that many sources at these settings\n');
    }
  }
  process.stdout.write('\n');
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
