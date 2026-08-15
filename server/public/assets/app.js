/* Viewer application. */
/* eslint-env browser */

import { WhepClient } from './whep.js';
import { $, h, api, toast, icon, statusChip, formatBitrate, bitrateUnit, formatDuration, copyToClipboard } from './ui.js';

const WEBRTC = '/mtx/webrtc';
const HLS = '/mtx/hls';

const app = {
  state: null,
  program: null, // WhepClient for the composed programme
  audio: null, // WhepClient for the selected source's audio
  audioKey: null, // null = everything muted (the default)
  previews: new Map(), // streamKey -> WhepClient
  mode: 'webrtc',
  hls: null,
  stats: null,
  showStats: false,
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

function startProgram() {
  stopProgram();
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
    else if (state === 'error') setPlayerMessage('Playback problem', message, false);
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
  if (app.hls) {
    app.hls.destroy();
    app.hls = null;
  }
  const video = programVideo();
  video.srcObject = null;
  video.removeAttribute('src');
  app.stats = null;
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
      const client = new WhepClient(`${WEBRTC}/${stream.path}/whep`, { video: false, audio: true });
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
        statusChip(s.live ? 'live' : 'idle', s.live ? 'Live' : 'Off'),
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
  const stats = app.stats || {};
  const onAir = (s.onAir || []).length;
  const kbps = stats.kbps || s.program.liveBitrateKbps || 0;

  const tiles = [
    { label: 'Sources on air', value: String(onAir), sub: `${(s.streams || []).length} configured` },
    {
      label: 'Output',
      value: `${s.program.width}×${s.program.height}`,
      sub: `${s.program.fps} fps · ${s.program.encoder || '—'}`,
    },
    {
      label: 'Received',
      value: formatBitrate(kbps),
      unit: bitrateUnit(kbps),
      sub: stats.codec ? stats.codec.toUpperCase() : 'target ' + formatBitrate(s.program.bitrateKbps) + ' ' + bitrateUnit(s.program.bitrateKbps),
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
  const s = app.stats;
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
  $('#overlay-readout').textContent = `${s.width}×${s.height} · ${s.fps} fps · ${s.kbps} kb/s`;
}

function renderProgramInfo() {
  const s = app.state;
  const dl = $('#program-info');
  const rows = [
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

// --------------------------------------------------------------------- poll

let lastSignature = '';

async function refresh() {
  let next;
  try {
    next = await api('/api/state', { quiet: true });
  } catch (_) {
    return;
  }
  const first = !app.state;
  app.state = next;

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

  if (first) startProgram();
}

// --------------------------------------------------------------------- boot

function wireControls() {
  $('#brand-mark').appendChild(icon('logo'));
  $('#btn-play').appendChild(icon('play'));
  $('#btn-stats').appendChild(icon('stats'));
  $('#btn-fullscreen').appendChild(icon('expand'));

  $('#btn-play').addEventListener('click', () => {
    const video = programVideo();
    if (video.paused) {
      video.play().catch(() => {});
      $('#btn-play').replaceChildren(icon('pause'));
    } else {
      video.pause();
      $('#btn-play').replaceChildren(icon('play'));
    }
  });

  programVideo().addEventListener('play', () => $('#btn-play').replaceChildren(icon('pause')));
  programVideo().addEventListener('pause', () => $('#btn-play').replaceChildren(icon('play')));

  $('#btn-stats').addEventListener('click', () => {
    app.showStats = !app.showStats;
    $('#player-stats').classList.toggle('show', app.showStats);
  });

  $('#btn-fullscreen').addEventListener('click', () => {
    const shell = $('#player-shell');
    if (document.fullscreenElement) document.exitFullscreen();
    else shell.requestFullscreen().catch(() => toast('Full screen was refused by the browser.', 'error'));
  });

  $('#volume').addEventListener('input', (e) => {
    $('#audio-out').volume = Number(e.target.value) / 100;
  });

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

wireControls();
refresh().then(() => {
  setInterval(refresh, 3000);
});
