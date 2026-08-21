/* Viewer application. */
/* eslint-env browser */

import { WhepClient, canReceiveH264 } from './whep.js';
import { $, h, api, toast, icon, statusChip, formatBitrate, bitrateUnit, formatDuration, copyToClipboard } from './ui.js';

const WEBRTC = '/mtx/webrtc';
const HLS = '/mtx/hls';

const app = {
  state: null,
  program: null, // WhepClient for the composed programme
  audio: null, // WhepClient for the selected source's audio
  audioKey: null, // null = everything muted (the default)
  previews: new Map(), // streamKey -> WhepClient
  tiles: new Map(), // web composition: playbackId -> { client, video, wrap }
  tileSignature: '', // the grid we last built, so polling does not rebuild it
  mode: 'webrtc',
  hls: null,
  stats: null,
  showStats: false,
  viewMode: 'normal',
  levelRaf: null,
};

// ---------------------------------------------------------------- programme

function programVideo() {
  return $('#program-video');
}

function setPlayerMessage(title, detail, spinner = false) {
  const box = $('#player-message');
  if (!title) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'grid';
  // replaceChildren() coerces null into the text "null", so filter first.
  box.replaceChildren(
    ...[
      spinner ? h('div', { class: 'spinner' }) : null,
      h('div', { class: 'big', text: title }),
      detail ? h('div', { text: detail, style: 'font-size:.85rem' }) : null,
    ].filter(Boolean),
  );
}

/** Is the grid assembled here in the browser rather than by the server? */
function composingHere() {
  return !!(app.state && app.state.program && app.state.program.mode === 'web');
}

/** Whatever the play/pause button currently controls: one video, or one per tile. */
function playbackVideos() {
  return composingHere() ? [...app.tiles.values()].map((t) => t.video) : [programVideo()];
}

/**
 * Reflect the actual state of the video(s), rather than assuming a click's
 * effect. Web-composed tiles autoplay on their own the moment a source comes
 * on air — nothing routes their native `play`/`pause` events to this button
 * unless every tile's video is wired to call this too, which is why it is a
 * shared function rather than inlined at each call site.
 */
function syncPlayIcon() {
  const videos = playbackVideos();
  const playing = videos.some((v) => !v.paused);
  $('#btn-play').replaceChildren(icon(playing ? 'pause' : 'play'));
}

function startProgram() {
  stopProgram();
  if (composingHere()) return startWebGrid();
  if (app.mode === 'hls') return startHls();

  const client = new WhepClient(`${WEBRTC}/${app.state.program.path}/whep`, { video: true, audio: false });
  app.program = client;

  client.addEventListener('track', () => {
    const video = programVideo();
    video.srcObject = client.stream;
    video.play().catch(() => {
      /* autoplay policy — the overlay play button covers this */
    });
  });

  client.addEventListener('state', (e) => {
    const { state, message, inMs } = e.detail;
    if (state === 'playing') setPlayerMessage(null);
    else if (state === 'connecting') setPlayerMessage('Connecting to the programme feed', null, true);
    else if (state === 'offline') setPlayerMessage('Nothing on air', 'Start streaming from OBS and the grid appears here automatically.');
    else if (state === 'reconnecting') setPlayerMessage('Reconnecting', `Retrying in ${Math.round((inMs || 0) / 1000)}s…`, true);
    else if (state === 'error') setPlayerMessage(e.detail.fatal ? 'This browser cannot play the stream' : 'Playback problem', message, false);
    renderProgramStatus();
  });

  client.addEventListener('stats', (e) => {
    app.stats = e.detail;
    renderPlayerStats();
  });

  client.start();
}

function stopProgram() {
  if (app.program) {
    app.program.stop();
    app.program = null;
  }
  stopWebGrid();
  if (app.hls) {
    app.hls.destroy();
    app.hls = null;
  }
  const video = programVideo();
  video.srcObject = null;
  video.removeAttribute('src');
  app.stats = null;
}

// ------------------------------------------------- composition in the browser
//
// Web composition: there is no programme stream. The player subscribes to each
// source and positions it into the cell the *server* computed, so the picture
// matches what the encoder would have produced — same layout rules, same order,
// same captions — without anything being re-encoded.

function gridHost() {
  let host = $('#web-grid');
  if (!host) {
    host = h('div', { id: 'web-grid', class: 'web-grid' });
    // Behind the message and overlay, which are later siblings.
    $('#player-shell').insertBefore(host, $('#player-stats'));
  }
  return host;
}

/** The on-air set and the geometry, so polling only rebuilds on a real change. */
function gridSignature() {
  const layout = app.state.layout;
  const onAir = app.state.onAir || [];
  if (!layout || !layout.cells) return 'idle';
  return JSON.stringify([
    onAir.map((s) => [s.key, s.name]),
    (app.state.streams || []).map((s) => [s.key, s.problem ? s.problem.code : null]),
    layout.cells.map((c) => [c.x, c.y, c.w, c.h]),
    [layout.width, layout.height],
    app.state.program.labels,
    app.state.program.labelSize,
    app.state.program.fallback,
  ]);
}

/**
 * Play one source into one tile over HLS.
 *
 * Used for sources MediaMTX will not serve over WebRTC — H.264 with B-frames,
 * which is what OBS produces unless told otherwise. HLS carries them happily,
 * so the cell works with no change at the publisher and no encoding here; it
 * simply runs a couple of seconds behind the rest of the grid, which the badge
 * says out loud.
 */
async function startTileHls(video, playbackId) {
  const url = `${HLS}/s/${playbackId}/index.m3u8`;
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.play().catch(() => {});
    return null;
  }
  try {
    await loadScript('/vendor/hls.js');
  } catch (_) {
    return null;
  }
  const Hls = window.Hls;
  if (!Hls || !Hls.isSupported()) return null;
  const hls = new Hls({ lowLatencyMode: true, backBufferLength: 10, liveSyncDurationCount: 1 });
  hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
  hls.loadSource(url);
  hls.attachMedia(video);
  return hls;
}

function stopWebGrid() {
  $('#player-shell').classList.remove('is-web-composed');
  for (const tile of app.tiles.values()) {
    if (tile.client) tile.client.stop();
    if (tile.hls) tile.hls.destroy();
    tile.video.srcObject = null;
    tile.video.removeAttribute('src');
  }
  app.tiles.clear();
  app.tileSignature = '';
  const host = $('#web-grid');
  if (host) host.replaceChildren();
}

function startWebGrid() {
  const layout = app.state.layout;
  const onAir = (app.state.onAir || []).filter((s) => s.key);
  const host = gridHost();
  const program = app.state.program;

  host.style.background = program.background || '#000';
  $('#player-shell').classList.add('is-web-composed');

  if (!layout || !layout.cells || onAir.length === 0) {
    stopWebGrid();
    setPlayerMessage('Nothing on air', 'Start streaming from OBS and the grid appears here automatically.');
    renderProgramStatus();
    return;
  }

  // Keep the clients that are still on air in their existing cell; a source
  // that merely moved must not be torn down and reconnected.
  const wanted = new Set(onAir.map((s) => s.key));
  for (const [key, tile] of [...app.tiles]) {
    if (!wanted.has(key)) {
      if (tile.client) tile.client.stop();
      if (tile.hls) tile.hls.destroy();
      app.tiles.delete(key);
    }
  }

  const gap = Number(program.gapPx) || 0;
  const children = onAir.map((source, i) => {
    const cell = layout.cells[i];
    if (!cell) return null;

    const meta = (app.state.streams || []).find((x) => x.key === source.key);
    // A source the browser cannot take over WebRTC still plays over HLS, so
    // prefer that to an empty cell unless the operator asked to be told instead.
    const useHls = !!(meta && meta.problem) && program.fallback !== 'warn';

    let tile = app.tiles.get(source.key);
    if (!tile) {
      const video = h('video', { playsinline: true, autoplay: true, muted: true });
      // Tiles autoplay on their own the moment a source comes on air, so the
      // global play/pause button needs its own hook to notice — see syncPlayIcon().
      video.addEventListener('play', syncPlayIcon);
      video.addEventListener('pause', syncPlayIcon);
      tile = { client: null, hls: null, video, viaHls: useHls, wrap: h('div', { class: 'web-cell' }, [video]) };
      if (useHls) {
        startTileHls(video, source.key).then((hls) => {
          const current = app.tiles.get(source.key);
          if (current === tile) tile.hls = hls;
          else if (hls) hls.destroy();
        });
      } else {
        const client = new WhepClient(`${WEBRTC}/s/${source.key}/whep`, { video: true, audio: false });
        client.addEventListener('track', () => {
          video.srcObject = client.stream;
          video.play().catch(() => {
            /* autoplay policy — the overlay play button covers this */
          });
        });
        client.addEventListener('state', () => renderProgramStatus());
        client.addEventListener('stats', () => renderPlayerStats());
        client.start();
        tile.client = client;
      }
      app.tiles.set(source.key, tile);
    }

    // Percentages of the composed canvas, so the grid scales with the player
    // and stays identical to the encoded arrangement at any size.
    const pct = (v, total) => `${(v / total) * 100}%`;
    tile.wrap.style.left = pct(cell.x, layout.width);
    tile.wrap.style.top = pct(cell.y, layout.height);
    tile.wrap.style.width = pct(cell.w, layout.width);
    tile.wrap.style.height = pct(cell.h, layout.height);

    // A source the browser cannot decode would otherwise be a black rectangle
    // with nothing to explain it. Say what is wrong and how to fix it.
    const existingNote = tile.wrap.querySelector('.web-problem');
    if (existingNote) existingNote.remove();
    if (meta && meta.problem && !useHls) {
      tile.wrap.appendChild(
        h('div', { class: 'web-problem' }, [
          h('strong', { text: source.name }),
          h('span', { text: meta.problem.summary }),
          meta.problem.fix ? h('span', { class: 'fix', text: meta.problem.fix }) : null,
        ].filter(Boolean)),
      );
    }

    const existingBadge = tile.wrap.querySelector('.web-transport');
    if (existingBadge) existingBadge.remove();
    if (tile.viaHls) {
      tile.wrap.appendChild(h('span', {
        class: 'web-transport',
        title: 'This source cannot be carried over WebRTC, so it is playing over HLS and runs a few seconds behind the others.',
        text: 'HLS · delayed',
      }));
    }

    // The caption the encoder would have burnt in, drawn as text instead.
    const existingCaption = tile.wrap.querySelector('.web-caption');
    if (existingCaption) existingCaption.remove();
    if (program.labels && source.name) {
      tile.wrap.appendChild(
        h('span', {
          class: 'web-caption',
          text: source.name,
          // Scale the caption the way drawtext does: relative to the canvas,
          // so it looks the same whatever size the player is on screen. The
          // 1.3 factor is a deliberate departure from that parity — the
          // browser-drawn caption now runs 30% larger than the server's
          // drawtext would at the same "label size" setting.
          style: `font-size:${((program.labelSize || 22) / layout.height) * 100 * 1.3}cqh`,
        }),
      );
    }
    return tile.wrap;
  }).filter(Boolean);

  host.style.gap = `${gap}px`;
  host.replaceChildren(...children);
  setPlayerMessage(null);
  renderProgramStatus();
  renderPlayerStats();
}

/** Called on every poll; rebuilds only when the grid actually changed. */
function syncWebGrid() {
  const signature = gridSignature();
  if (signature === app.tileSignature) return;
  app.tileSignature = signature;
  startWebGrid();
}

/** Aggregate of every tile, so the stats read like one picture. */
function webGridStats() {
  const tiles = [...app.tiles.values()].map((t) => t.client && t.client.lastStats).filter(Boolean);
  if (tiles.length === 0) return null;
  const sum = (f) => tiles.reduce((a, s) => a + (Number(s[f]) || 0), 0);
  const rtts = tiles.map((s) => s.rttMs).filter((v) => v != null);
  return {
    width: app.state.layout ? app.state.layout.width : 0,
    height: app.state.layout ? app.state.layout.height : 0,
    fps: Math.round(sum('fps') / tiles.length),
    kbps: Math.round(sum('kbps')),
    codec: tiles[0].codec,
    rttMs: rtts.length ? Math.max(...rtts) : null,
    jitterMs: Math.round(sum('jitterMs') / tiles.length),
    packetsLost: sum('packetsLost'),
    sources: tiles.length,
  };
}

/** hls.js ships as a UMD bundle, so it goes in through a script tag, not import(). */
function loadScript(src) {
  if (window.Hls) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(el);
  });
}

async function startHls() {
  const video = programVideo();
  const url = `${HLS}/${app.state.program.path}/index.m3u8`;
  setPlayerMessage('Starting HLS playback', null, true);

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.play().catch(() => {});
    setPlayerMessage(null);
    return;
  }
  try {
    await loadScript('/vendor/hls.js');
  } catch (_) {
    setPlayerMessage('HLS is unavailable', 'This browser needs hls.js, which could not be loaded. Use WebRTC instead.');
    return;
  }
  const Hls = window.Hls;
  if (!Hls || !Hls.isSupported()) {
    setPlayerMessage('HLS is unsupported', 'This browser cannot play HLS. Use WebRTC instead.');
    return;
  }
  const hls = new Hls({ lowLatencyMode: true, backBufferLength: 10, liveSyncDurationCount: 1 });
  app.hls = hls;
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    setPlayerMessage(null);
    video.play().catch(() => {});
  });
  hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (data.fatal) setPlayerMessage('HLS playback stopped', data.details);
  });
  hls.loadSource(url);
  hls.attachMedia(video);
}

// -------------------------------------------------------------------- audio

/**
 * Exactly one source can be audible at a time and nothing is audible by
 * default: a wall of simultaneous room audio is unusable, and an unexpected
 * noise when a page loads is worse.
 */
function selectAudio(key) {
  if (app.audio) {
    app.audio.stop();
    app.audio = null;
  }
  stopLevelMeter();
  const out = $('#audio-out');
  out.srcObject = null;
  app.audioKey = key;

  if (key) {
    const stream = (app.state.streams || []).find((s) => s.key === key);
    if (stream) {
      const client = new WhepClient(`${WEBRTC}/${stream.audioPath}/whep`, { video: false, audio: true });
      app.audio = client;
      client.addEventListener('track', () => {
        out.srcObject = client.stream;
        out.volume = Number($('#volume').value) / 100;
        out.play().catch(() => toast('Click anywhere on the page to allow audio playback.', 'info'));
        startLevelMeter(client.stream, key);
      });
      client.addEventListener('state', (e) => {
        if (e.detail.state === 'error') toast(`Audio for “${stream.name}” failed: ${e.detail.message}`, 'error');
      });
      client.start();
    }
  }
  renderAudioList();
}

let audioCtx = null;
let analyser = null;

function startLevelMeter(stream, key) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const bar = document.querySelector(`.audio-option[data-key="${CSS.escape(key)}"] .level-bar > span`);
    const tick = () => {
      if (!analyser || app.audioKey !== key) return;
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i] - 128));
      const percent = Math.min(100, Math.round((peak / 128) * 140));
      if (bar) bar.style.width = `${percent}%`;
      app.levelRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch (_) {
    /* level metering is a nicety, never a blocker */
  }
}

function stopLevelMeter() {
  if (app.levelRaf) cancelAnimationFrame(app.levelRaf);
  app.levelRaf = null;
  analyser = null;
  document.querySelectorAll('.level-bar > span').forEach((el) => {
    el.style.width = '0';
  });
}

function renderAudioList() {
  const list = $('#audio-list');
  const streams = (app.state.streams || []).filter((s) => s.live);
  const options = [
    h('label', { class: `audio-option${app.audioKey === null ? ' is-active' : ''}`, dataset: { key: '' } }, [
      h('input', { type: 'radio', name: 'audio', checked: app.audioKey === null, onchange: () => selectAudio(null) }),
      h('span', { class: 'name', text: 'Muted' }),
      h('span', { class: 'meta', text: 'default' }),
    ]),
  ];

  for (const s of streams) {
    const active = app.audioKey === s.key;
    options.push(
      h('label', { class: `audio-option${active ? ' is-active' : ''}`, dataset: { key: s.key } }, [
        h('input', { type: 'radio', name: 'audio', checked: active, disabled: !s.hasAudio, onchange: () => selectAudio(s.key) }),
        h('span', { class: 'name', text: s.name }),
        s.hasAudio ? h('span', { class: 'level-bar' }, [h('span')]) : h('span', { class: 'meta', text: 'no audio' }),
      ]),
    );
  }

  if (streams.length === 0) {
    options.push(h('div', { class: 'empty', style: 'padding:1rem', text: 'No sources are live.' }));
  }
  list.replaceChildren(...options);
}

// ------------------------------------------------------------------ sources

function togglePreview(key, cardVideo, button) {
  const existing = app.previews.get(key);
  if (existing) {
    existing.stop();
    app.previews.delete(key);
    cardVideo.srcObject = null;
    button.textContent = 'Preview';
    return;
  }
  const stream = (app.state.streams || []).find((s) => s.key === key);
  if (!stream) return;
  const client = new WhepClient(`${WEBRTC}/${stream.path}/whep`, { video: true, audio: false });
  app.previews.set(key, client);
  client.addEventListener('track', () => {
    cardVideo.srcObject = client.stream;
    cardVideo.play().catch(() => {});
  });
  client.start();
  button.textContent = 'Stop';
}

function renderSources() {
  const container = $('#sources');
  const streams = app.state.streams || [];
  const onAir = (app.state.onAir || []).map((s) => s.key);

  if (!app.state.settings.showIndividualStreams) {
    $('#sources-card').style.display = 'none';
    return;
  }
  $('#sources-card').style.display = '';
  $('#sources-count').textContent = `${streams.filter((s) => s.live).length} live of ${streams.length}`;

  if (streams.length === 0) {
    container.replaceChildren(h('div', { class: 'empty', text: 'No stream keys have been created yet.' }));
    return;
  }

  const cards = streams.map((s) => {
    const cellIndex = onAir.indexOf(s.key);
    const video = h('video', { playsinline: true, muted: true, autoplay: true, style: s.live ? '' : 'display:none' });
    const previewBtn = h('button', {
      class: 'ghost',
      style: 'font-size:.75rem; padding:.25rem .5rem',
      disabled: !s.live,
      onclick: (e) => togglePreview(s.key, video, e.currentTarget),
      text: app.previews.has(s.key) ? 'Stop' : 'Preview',
    });

    // Re-attach a live preview after a re-render.
    const existing = app.previews.get(s.key);
    if (existing && existing.stream) video.srcObject = existing.stream;

    return h('article', { class: `source${app.audioKey === s.key ? ' is-selected' : ''}` }, [
      h('div', { class: 'thumb' }, [
        video,
        !app.previews.has(s.key) ? h('span', { class: 'placeholder', text: s.live ? 'Preview off' : 'Offline' }) : null,
        cellIndex >= 0 ? h('span', { class: 'cell-index', text: `cell ${cellIndex + 1}` }) : null,
      ]),
      h('div', { class: 'body' }, [
        h('span', { class: 'name', title: s.name, text: s.name }),
        s.problem
          ? h('span', { class: 'warn-chip', title: `${s.problem.summary} ${s.problem.fix || ''}`.trim(), text: 'not playable' })
          : statusChip(s.live ? 'live' : 'idle', s.live ? 'Live' : 'Off'),
        previewBtn,
      ]),
    ]);
  });

  container.replaceChildren(...cards);
}

// -------------------------------------------------------------------- chrome

function renderProgramStatus() {
  const el = $('#program-status');
  const p = app.state ? app.state.program : null;
  let kind = 'idle';
  let label = 'Connecting';

  if (!p) {
    kind = 'idle';
  } else if (!p.enabled) {
    kind = 'warn';
    label = 'Composition off';
  } else if (composingHere()) {
    const tiles = [...app.tiles.values()];
    const playing = tiles.filter((t) => (t.client ? t.client.state === 'playing' : t.video.readyState >= 2)).length;
    if (tiles.length === 0) {
      kind = 'idle';
      label = 'Nothing on air';
    } else if (playing === tiles.length) {
      kind = 'live';
      label = 'Live';
    } else {
      kind = 'warn';
      label = `${playing} of ${tiles.length} connected`;
    }
  } else if (app.program && app.program.state === 'playing') {
    kind = 'live';
    label = 'Live';
  } else if (p.encoding) {
    kind = 'warn';
    label = 'Encoding';
  } else if ((app.state.onAir || []).length === 0) {
    kind = 'idle';
    label = 'Standby';
  } else {
    kind = 'warn';
    label = 'Starting';
  }
  el.className = `status is-${kind === 'live' ? 'live' : kind === 'warn' ? 'warn' : 'idle'}`;
  el.replaceChildren(h('span', { class: 'dot' }), document.createTextNode(label));

  const badge = $('#live-badge');
  badge.replaceChildren(kind === 'live' ? statusChip('live', 'Live') : statusChip('idle', label));
}

function renderTiles() {
  const s = app.state;
  const web = composingHere();
  const stats = (web ? webGridStats() : app.stats) || {};
  const onAir = (s.onAir || []).length;
  const kbps = stats.kbps || (web ? 0 : s.program.liveBitrateKbps) || 0;

  const tiles = [
    { label: 'Sources on air', value: String(onAir), sub: `${(s.streams || []).length} configured` },
    {
      label: web ? 'Composed' : 'Output',
      value: web ? 'in your browser' : `${s.program.width}×${s.program.height}`,
      sub: web ? 'nothing re-encoded' : `${s.program.fps} fps · ${s.program.encoder || '—'}`,
    },
    {
      label: 'Received',
      value: formatBitrate(kbps),
      unit: bitrateUnit(kbps),
      sub: stats.codec
        ? `${stats.codec.toUpperCase()}${web ? ` · ${onAir} streams` : ''}`
        : web
          ? 'across every source'
          : 'target ' + formatBitrate(s.program.bitrateKbps) + ' ' + bitrateUnit(s.program.bitrateKbps),
    },
    {
      label: 'Round trip',
      value: stats.rttMs != null ? String(stats.rttMs) : '—',
      unit: stats.rttMs != null ? 'ms' : '',
      sub: stats.jitterMs != null ? `jitter ${stats.jitterMs} ms` : '',
    },
  ];

  $('#tiles').replaceChildren(
    ...tiles.map((t) =>
      h('div', { class: 'stat' }, [
        h('div', { class: 'label', text: t.label }),
        h('div', { class: 'value' }, [t.value, t.unit ? h('span', { class: 'unit', text: t.unit }) : null]),
        t.sub ? h('div', { class: 'sub', text: t.sub }) : null,
      ]),
    ),
  );
}

function renderPlayerStats() {
  const box = $('#player-stats');
  const s = composingHere() ? webGridStats() : app.stats;
  if (!s) {
    box.textContent = '';
    $('#overlay-readout').textContent = '';
    return;
  }
  box.replaceChildren(
    h('div', { html: `resolution <b>${s.width}×${s.height}</b>` }),
    h('div', { html: `frame rate <b>${s.fps}</b> fps` }),
    h('div', { html: `bitrate <b>${s.kbps}</b> kb/s` }),
    h('div', { html: `codec <b>${(s.codec || '—').toUpperCase()}</b>` }),
    h('div', { html: `round trip <b>${s.rttMs != null ? `${s.rttMs} ms` : '—'}</b>` }),
    h('div', { html: `jitter <b>${s.jitterMs} ms</b> · lost <b>${s.packetsLost}</b>` }),
  );
  $('#overlay-readout').textContent = s.sources
    ? `${s.sources} sources · ${s.fps} fps · ${s.kbps} kb/s`
    : `${s.width}×${s.height} · ${s.fps} fps · ${s.kbps} kb/s`;
}

function renderProgramInfo() {
  const s = app.state;
  const dl = $('#program-info');
  // HLS packages the programme; in web mode there is no programme to package.
  $('#playback-picker').style.display = composingHere() ? 'none' : '';
  $('#playback-web-note').style.display = composingHere() ? '' : 'none';
  const rows = composingHere()
    ? [
      ['Composed', 'in your browser'],
      ['Arrangement', `${s.program.width}×${s.program.height}`],
      ['Server encoding', 'none'],
      ['Streams to you', String((s.onAir || []).length)],
    ]
    : [
      ['Resolution', `${s.program.width}×${s.program.height}`],
      ['Frame rate', `${s.program.fps} fps`],
      ['Target bitrate', `${formatBitrate(s.program.bitrateKbps)} ${bitrateUnit(s.program.bitrateKbps)}`],
      ['Encoder', s.program.encoder || 'idle'],
      ['Viewers', String(s.program.readers ?? 0)],
    ];
  dl.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
}

function renderLayoutPreview() {
  const box = $('#layout-preview');
  const layout = app.state.layout;
  const card = $('#layout-card');
  if (!layout || !layout.cells || layout.cells.length === 0) {
    card.style.display = '';
    $('#layout-name').textContent = 'idle';
    box.replaceChildren(h('div', { class: 'empty', style: 'position:absolute; inset:0; display:grid; place-content:center;', text: 'Nothing on air' }));
    return;
  }
  $('#layout-name').textContent = `${layout.name} · ${layout.cols}×${layout.rows}`;
  const names = (app.state.onAir || []).map((s) => s.name);
  box.replaceChildren(
    ...layout.cells.map((c, i) =>
      h('div', {
        class: 'cell',
        style: `left:${(c.x / layout.width) * 100}%; top:${(c.y / layout.height) * 100}%; width:${(c.w / layout.width) * 100}%; height:${(c.h / layout.height) * 100}%;`,
        text: names[i] || String(i + 1),
      }),
    ),
  );
}

function renderUserArea() {
  const area = $('#user-area');
  const user = app.state.user;
  const children = [];
  if (user && user.role === 'admin') children.push(h('a', { class: 'btn', href: '/admin', text: 'Admin' }));
  if (user) {
    children.push(h('span', { style: 'font-size:.82rem; color:var(--ink-muted)', text: user.username }));
    children.push(
      h('button', {
        class: 'ghost',
        text: 'Sign out',
        onclick: async () => {
          await api('/api/auth/logout', { method: 'POST' });
          window.location.href = '/login';
        },
      }),
    );
  } else {
    children.push(h('a', { class: 'btn', href: '/login', text: 'Sign in' }));
  }
  area.replaceChildren(...children);
}

// ---------------------------------------------------------------- view mode
//
// Cinema mode: the picture takes nearly the whole window and everything that
// is not the picture either shrinks or goes away. The audio picker stays —
// the programme is silent by design, so removing it would leave a viewer with
// no way to hear anything.
//
// Remembered per user, because two people sharing a machine rarely want the
// same thing, and applied before the first paint so it does not flash.

const VIEW_KEY = 'streamComposer.viewMode';
// Cinema is what most people want most of the time: they came to watch. The
// detail panels are one click away, and the choice is remembered per user.
const DEFAULT_VIEW_MODE = 'cinema';

function viewModeKey(user) {
  return `${VIEW_KEY}.${(user && user.username) || 'guest'}`;
}

function readStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_) {
    return null; // private mode, or storage disabled — not worth failing over
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_) {
    /* the preference simply will not persist */
  }
}

function applyViewMode(mode) {
  app.viewMode = mode === 'cinema' ? 'cinema' : 'normal';
  document.body.classList.toggle('is-cinema', app.viewMode === 'cinema');
  const btn = $('#btn-cinema');
  if (btn) {
    btn.classList.toggle('primary', app.viewMode === 'cinema');
    btn.setAttribute('aria-pressed', String(app.viewMode === 'cinema'));
  }
}

/**
 * Before we know who is watching, use whatever was chosen last on this
 * browser. It is only a guess to avoid a flash of the wrong layout — the real
 * preference is applied as soon as the first poll says who this is.
 */
function applyRememberedViewMode() {
  applyViewMode(readStored(`${VIEW_KEY}.last`) || DEFAULT_VIEW_MODE);
}

/**
 * Once the user is known, their own choice wins — and someone who has never
 * chosen gets the default rather than inheriting the previous person's.
 */
function adoptUserViewMode(user) {
  applyViewMode(readStored(viewModeKey(user)) || DEFAULT_VIEW_MODE);
}

function toggleViewMode() {
  const next = app.viewMode === 'cinema' ? 'normal' : 'cinema';
  applyViewMode(next);
  writeStored(viewModeKey(app.state && app.state.user), next);
  writeStored(`${VIEW_KEY}.last`, next);
}

// --------------------------------------------------------------------- poll

let lastSignature = '';
let wasComposingHere = false;

async function refresh() {
  let next;
  try {
    next = await api('/api/state', { quiet: true });
  } catch (_) {
    return;
  }
  const first = !app.state;
  app.state = next;
  if (first) adoptUserViewMode(next.user);

  document.title = `${next.settings.siteName} — live`;
  $('#site-name').textContent = next.settings.siteName;

  renderUserArea();
  renderProgramStatus();
  renderTiles();
  renderProgramInfo();
  renderLayoutPreview();

  const signature = JSON.stringify(next.streams.map((s) => [s.key, s.name, s.live, s.hasAudio]));
  if (signature !== lastSignature) {
    lastSignature = signature;
    renderSources();
    renderAudioList();
    // If the source we were listening to went away, fall back to muted.
    if (app.audioKey && !next.streams.some((s) => s.key === app.audioKey && s.live)) selectAudio(null);
  }

  if (first) {
    startProgram();
  } else if (composingHere()) {
    syncWebGrid();
  } else if (wasComposingHere !== composingHere()) {
    // The operator switched modes while we were watching.
    startProgram();
  }
  wasComposingHere = composingHere();
}

// --------------------------------------------------------------------- boot

function wireControls() {
  $('#brand-mark').appendChild(icon('logo'));
  $('#btn-play').appendChild(icon('play'));
  $('#btn-stats').appendChild(icon('stats'));
  $('#btn-fullscreen').appendChild(icon('expand'));

  $('#btn-play').addEventListener('click', () => {
    // In web mode there are several videos, and they pause and resume together.
    const videos = playbackVideos();
    if (videos.length === 0) return;
    const paused = videos.every((v) => v.paused);
    for (const v of videos) {
      if (paused) v.play().catch(() => {});
      else v.pause();
    }
    syncPlayIcon();
  });

  programVideo().addEventListener('play', syncPlayIcon);
  programVideo().addEventListener('pause', syncPlayIcon);

  $('#btn-stats').addEventListener('click', () => {
    app.showStats = !app.showStats;
    $('#player-stats').classList.toggle('show', app.showStats);
  });

  $('#btn-cinema').addEventListener('click', toggleViewMode);

  $('#btn-fullscreen').addEventListener('click', () => {
    const shell = $('#player-shell');
    if (document.fullscreenElement) document.exitFullscreen();
    else shell.requestFullscreen().catch(() => toast('Full screen was refused by the browser.', 'error'));
  });

  $('#btn-mute').appendChild(icon('volume'));

  // Two sliders, one volume: the sidebar's and the one surfaced in the player
  // overlay so it stays reachable in full screen, where the sidebar is not
  // part of the fullscreen element and disappears from view.
  const volumeInputs = [$('#volume'), $('#volume-overlay')];
  let volumeBeforeMute = Number($('#volume').value) || 80;

  function applyVolume(value) {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    for (const input of volumeInputs) input.value = clamped;
    $('#audio-out').volume = clamped / 100;
    $('#btn-mute').replaceChildren(icon(clamped === 0 ? 'mute' : 'volume'));
    if (clamped > 0) volumeBeforeMute = clamped;
  }

  for (const input of volumeInputs) {
    input.addEventListener('input', (e) => applyVolume(e.target.value));
  }

  $('#btn-mute').addEventListener('click', () => {
    applyVolume(Number($('#volume').value) > 0 ? 0 : volumeBeforeMute);
  });

  // The <audio> element's own default (1.0) otherwise wins until the first
  // slider touch, ignoring what the sliders show from the very first paint.
  applyVolume(volumeBeforeMute);

  const setMode = (mode) => {
    if (app.mode === mode) return;
    app.mode = mode;
    $('#btn-mode-webrtc').classList.toggle('primary', mode === 'webrtc');
    $('#btn-mode-hls').classList.toggle('primary', mode === 'hls');
    startProgram();
  };
  $('#btn-mode-webrtc').addEventListener('click', () => setMode('webrtc'));
  $('#btn-mode-hls').addEventListener('click', () => setMode('hls'));

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'f') $('#btn-fullscreen').click();
    if (e.key === ' ') {
      e.preventDefault();
      $('#btn-play').click();
    }
    if (e.key === 'm') selectAudio(null);
    if (e.key === 'i') $('#btn-stats').click();
  });

  window.addEventListener('beforeunload', () => {
    stopProgram();
    if (app.audio) app.audio.stop();
    app.previews.forEach((c) => c.stop());
  });

  document.addEventListener('visibilitychange', () => {
    // Pause previews when the tab is hidden; the programme keeps running so
    // coming back is instant.
    if (document.hidden) app.previews.forEach((c) => c.stop());
  });
}

applyRememberedViewMode();
wireControls();
refresh().then(() => {
  setInterval(refresh, 3000);
});
