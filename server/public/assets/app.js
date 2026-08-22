/* Viewer application. */
/* eslint-env browser */

import { WhepClient, canReceiveH264 } from './whep.js';
import { $, h, api, toast, icon, statusChip, pluralize } from './ui.js';

const WEBRTC = '/mtx/webrtc';
const HLS = '/mtx/hls';

// `/c/<slug>` views a channel instead of the default global grid — same
// page, same app.js, just a different state endpoint. See routes/channels.js.
const CHANNEL_SLUG = location.pathname.startsWith('/c/') ? location.pathname.slice(3).split('/')[0] || null : null;
const HIDE_RESTRICTED_KEY = CHANNEL_SLUG ? `sc-hide-restricted:${CHANNEL_SLUG}` : null;

function stateUrl() {
  if (!CHANNEL_SLUG) return '/api/state';
  const hide = app.hideRestricted ? '?hideRestricted=1' : '';
  return `/api/channels/${encodeURIComponent(CHANNEL_SLUG)}/state${hide}`;
}

const app = {
  state: null,
  program: null, // WhepClient for the composed programme
  audio: null, // WhepClient for the selected source's audio
  audioKey: null, // null = everything muted (the default)
  tiles: new Map(), // web composition: playbackId -> { client, video, wrap }
  tileSignature: '', // the grid we last built, so polling does not rebuild it
  stats: null,
  showStats: false,
  levelRaf: null,
  // Whether restricted (private, inaccessible) tiles are excluded from a
  // channel's grid entirely, rather than shown as a placeholder. Per channel,
  // remembered across visits.
  hideRestricted: !!(HIDE_RESTRICTED_KEY && localStorage.getItem(HIDE_RESTRICTED_KEY) === '1'),
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

let lastBackgroundUrl = undefined;

/**
 * The grid host (#web-grid), not the player shell — .web-grid is what
 * program.background's colour already targets (see startWebGrid()), and it
 * sits opaque on top of the shell, so anything painted on the shell itself
 * would never show through.
 */
function applyChannelBackground(channel) {
  if (!CHANNEL_SLUG) return; // never creates #web-grid outside channel mode
  const host = gridHost();
  const url = channel && channel.backgroundImage ? channel.backgroundImage : null;
  if (url === lastBackgroundUrl) return;
  lastBackgroundUrl = url;
  host.style.backgroundImage = url ? `url("${url}")` : '';
  host.classList.toggle('has-channel-background', !!url);
}

function renderHiddenPill(channel) {
  const host = $('#player-shell');
  let pill = $('.hidden-pill', host);
  const count = channel && channel.hiddenCount ? channel.hiddenCount : 0;
  if (!CHANNEL_SLUG || count === 0) {
    if (pill) pill.remove();
    return;
  }
  if (!pill) {
    pill = h('button', { class: 'hidden-pill', type: 'button' });
    pill.addEventListener('click', () => {
      app.hideRestricted = !app.hideRestricted;
      if (HIDE_RESTRICTED_KEY) localStorage.setItem(HIDE_RESTRICTED_KEY, app.hideRestricted ? '1' : '0');
      // The next state fetch carries a different onAir/layout (server-side
      // hideRestricted), which naturally changes gridSignature() and makes
      // syncWebGrid() rebuild — no manual invalidation needed.
      refresh();
    });
    host.appendChild(pill);
  }
  pill.textContent = app.hideRestricted
    ? `${count} hidden — show`
    : `${count} private — hide`;
}

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
    // A private stream this viewer cannot access: the API never sent a path
    // for it at all, so there is nothing to subscribe to — a placeholder
    // fills the cell instead. See routes/channels.js.
    const restricted = !!(meta && meta.restricted);

    let tile = app.tiles.get(source.key);
    // Access can change between polls (a grant lands, a channel toggles
    // visibility) — rebuild rather than leave a stale placeholder or a
    // stale live subscription in place.
    if (tile && tile.restricted !== restricted) {
      if (tile.client) tile.client.stop();
      if (tile.hls) tile.hls.destroy();
      app.tiles.delete(source.key);
      tile = null;
    }
    if (!tile) {
      const video = h('video', { playsinline: true, autoplay: true, muted: true });
      // Tiles autoplay on their own the moment a source comes on air, so the
      // global play/pause button needs its own hook to notice — see syncPlayIcon().
      video.addEventListener('play', syncPlayIcon);
      video.addEventListener('pause', syncPlayIcon);
      tile = { client: null, hls: null, video, viaHls: useHls, restricted, wrap: h('div', { class: 'web-cell' }, [video]) };
      if (restricted) {
        tile.wrap.appendChild(
          h('div', { class: 'web-restricted' }, [
            h('strong', { text: 'This stream is private' }),
            h('span', { text: 'Please ask for access.' }),
          ]),
        );
      } else if (useHls) {
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

    // None of this applies to a restricted placeholder — there is no video
    // to explain, fall back for, or caption.
    if (!restricted) {
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
        // Sizing lives entirely in the .web-caption CSS rule now (font-size:
        // 2vw), not here — an inline style would override it.
        tile.wrap.appendChild(h('span', { class: 'web-caption', text: source.name }));
      }
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
        out.volume = Number($('#volume-overlay').value) / 100;
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
    // Two places show this meter: the sidebar list (horizontal, fills by
    // width) and the overlay's compact chip (vertical, fills by height).
    // Setting both properties on every match is harmless — each one's CSS
    // fixes the axis that does not apply, so only the relevant one moves.
    const bars = document.querySelectorAll(`[data-key="${CSS.escape(key)}"] .level-bar-v > span`);
    const tick = () => {
      if (!analyser || app.audioKey !== key) return;
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i] - 128));
      const percent = Math.min(100, Math.round((peak / 128) * 140));
      bars.forEach((bar) => {
        bar.style.height = `${percent}%`;
      });
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
  document.querySelectorAll('.level-bar-v > span').forEach((el) => {
    el.style.height = '0';
  });
}

function renderAudioList() {
  const streams = (app.state.streams || []).filter((s) => s.live);
  renderAudioChips(streams);
}

/** The audio-source picker, lives in the player overlay so it stays reachable in full screen. */
function renderAudioChips(streams) {
  const box = $('#audio-chips');
  if (!box) return;
  const mutedChip = h('button', {
    class: `audio-chip${app.audioKey === null ? ' is-active' : ''}`,
    type: 'button',
    dataset: { key: '' },
    title: 'Mute the audio monitor',
    onclick: () => selectAudio(null),
  }, [
    h('span', { class: 'name', text: 'Muted' }),
    h('span', { class: 'meta', text: 'default' }),
  ]);

  box.replaceChildren(
    mutedChip,
    ...streams.map((s) => {
      const active = app.audioKey === s.key;
      return h('button', {
        class: `audio-chip${active ? ' is-active' : ''}`,
        type: 'button',
        dataset: { key: s.key },
        disabled: !s.hasAudio,
        title: s.hasAudio ? `Listen to ${s.name}` : `${s.name} has no audio`,
        onclick: () => selectAudio(s.key),
      }, [
        h('span', { class: 'level-bar-v' }, [h('span')]),
        h('span', { class: 'name', text: s.name }),
      ]);
    }),
  );
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

/**
 * Server mode has exactly one video, so the single top-left overlay is the
 * whole story. Web/channel mode has one video per tile — showing only one
 * combined reading there hid which specific source was struggling, so each
 * tile gets its own reading instead (renderTileStats(), below), and the
 * single overlay is hidden rather than duplicating the aggregate.
 * `#overlay-readout` (bottom-right, in the control bar) is unaffected either
 * way — it already is, and stays, the aggregate reading.
 */
function renderPlayerStats() {
  const box = $('#player-stats');
  const s = composingHere() ? webGridStats() : app.stats;
  if (composingHere()) {
    box.classList.remove('show');
    box.replaceChildren();
    renderTileStats();
  } else if (!s) {
    box.replaceChildren();
  } else {
    box.replaceChildren(
      h('div', { html: `resolution <b>${s.width}×${s.height}</b>` }),
      h('div', { html: `frame rate <b>${s.fps}</b> fps` }),
      h('div', { html: `bitrate <b>${s.kbps}</b> kb/s` }),
      h('div', { html: `codec <b>${(s.codec || '—').toUpperCase()}</b>` }),
      h('div', { html: `round trip <b>${s.rttMs != null ? `${s.rttMs} ms` : '—'}</b>` }),
      h('div', { html: `jitter <b>${s.jitterMs} ms</b> · lost <b>${s.packetsLost}</b>` }),
    );
  }
  $('#overlay-readout').textContent = !s
    ? ''
    : s.sources
      ? `${pluralize(s.sources, 'source')} · ${s.fps} fps · ${s.kbps} kb/s`
      : `${s.width}×${s.height} · ${s.fps} fps · ${s.kbps} kb/s`;
}

/** One small readout per tile, top-left, toggled by the same #btn-stats. */
function renderTileStats() {
  for (const tile of app.tiles.values()) {
    const existing = tile.wrap.querySelector('.tile-stats');
    const s = tile.client && tile.client.lastStats;
    if (!app.showStats || !composingHere() || !s) {
      if (existing) existing.remove();
      continue;
    }
    const box = existing || h('div', { class: 'tile-stats' });
    box.replaceChildren(
      h('div', { html: `<b>${s.width}×${s.height}</b>` }),
      h('div', { text: `${s.fps} fps · ${s.kbps} kb/s` }),
      h('div', { text: `${(s.codec || '—').toUpperCase()}${s.rttMs != null ? ` · ${s.rttMs} ms` : ''}` }),
    );
    if (!existing) tile.wrap.appendChild(box);
  }
}

function renderUserArea() {
  const area = $('#user-area');
  const user = app.state.user;
  const children = [];
  if (user && user.role === 'admin') children.push(h('a', { class: 'btn', href: '/admin', text: 'Admin' }));
  if (user && (user.role === 'streamer' || user.role === 'admin')) children.push(h('a', { class: 'btn', href: '/streamer', text: 'My streams' }));
  if (user) {
    children.push(h('a', { class: 'btn', href: '/channels', text: 'My channels' }));
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
let wasComposingHere = false;

async function refresh() {
  let next;
  try {
    next = await api(stateUrl(), { quiet: true });
  } catch (_) {
    return;
  }
  const first = !app.state;
  app.state = next;

  document.title = `${next.settings.siteName} — live`;
  $('#site-name').textContent = next.settings.siteName;
  applyChannelBackground(next.channel);
  renderHiddenPill(next.channel);

  renderUserArea();
  renderProgramStatus();

  const signature = JSON.stringify(next.streams.map((s) => [s.key, s.name, s.live, s.hasAudio]));
  if (signature !== lastSignature) {
    lastSignature = signature;
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
    $('#player-stats').classList.toggle('show', app.showStats && !composingHere());
    renderTileStats();
  });

  $('#btn-fullscreen').addEventListener('click', () => {
    const shell = $('#player-shell');
    if (document.fullscreenElement) document.exitFullscreen();
    else shell.requestFullscreen().catch(() => toast('Full screen was refused by the browser.', 'error'));
  });

  $('#btn-mute').appendChild(icon('volume'));

  const volumeInput = $('#volume-overlay');
  let volumeBeforeMute = Number(volumeInput.value) || 80;

  function applyVolume(value) {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    volumeInput.value = clamped;
    $('#audio-out').volume = clamped / 100;
    $('#btn-mute').replaceChildren(icon(clamped === 0 ? 'mute' : 'volume'));
    if (clamped > 0) volumeBeforeMute = clamped;
  }

  volumeInput.addEventListener('input', (e) => applyVolume(e.target.value));

  $('#btn-mute').addEventListener('click', () => {
    applyVolume(Number(volumeInput.value) > 0 ? 0 : volumeBeforeMute);
  });

  // The <audio> element's own default (1.0) otherwise wins until the first
  // slider touch, ignoring what the sliders show from the very first paint.
  applyVolume(volumeBeforeMute);

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
  });
}

wireControls();
refresh().then(() => {
  setInterval(refresh, 3000);
});
