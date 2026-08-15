/* Administration console. */
/* eslint-env browser */

import { $, $$, h, api, toast, icon, statusChip, formatBitrate, bitrateUnit, formatBytes, formatDuration, sinceLabel, copyToClipboard, meterClass } from './ui.js';

const admin = {
  streams: [],
  users: [],
  composition: null,
  layouts: [],
  encoders: [],
  settings: null,
  ingest: null,
  status: null,
  bitrateHistory: [],
  logTimer: null,
};

// ------------------------------------------------------------------- tabs

function showPanel(name) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.panel === name));
  $$('.panel').forEach((p) => p.classList.toggle('is-active', p.id === `panel-${name}`));
  window.location.hash = name;
  if (name === 'logs') loadLogs();
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => showPanel(tab.dataset.panel)));

// ---------------------------------------------------------------- streams

function maskKey(key) {
  if (key.length <= 10) return key;
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(10, key.length - 8))}${key.slice(-4)}`;
}

function obsDialog(stream) {
  const dialog = $('#obs-dialog');
  $('#obs-title').textContent = `OBS setup — ${stream.name}`;

  const ing = stream.ingest || {};
  const rows = [];

  const field = (label, value, hint) =>
    h('div', { style: 'margin-bottom:.85rem;' }, [
      h('div', { class: 'section-title', style: 'margin-bottom:.25rem;', text: label }),
      h('div', { class: 'row', style: 'flex-wrap:nowrap;' }, [
        h('input', { value, readonly: true, class: 'mono', onclick: (e) => e.target.select() }),
        h('button', { class: 'icon', title: 'Copy', onclick: () => copyToClipboard(value) }, [icon('copy')]),
      ]),
      hint ? h('div', { style: 'font-size:.72rem; color:var(--ink-muted); margin-top:.25rem;', text: hint }) : null,
    ]);

  if (ing.rtmp) {
    rows.push(h('p', { style: 'font-size:.85rem; color:var(--ink-2)' , text: 'In OBS: Settings → Stream → Service “Custom…”, then paste these two values.' }));
    rows.push(field('Server', ing.rtmp.server));
    rows.push(field('Stream key', ing.rtmp.key));
  }
  if (ing.rtmps) rows.push(field('Server (RTMPS, encrypted)', ing.rtmps.server, 'Same stream key. Use this when the network between OBS and the server is untrusted.'));
  if (ing.srt) rows.push(field('SRT URL', ing.srt.url, 'Service “Custom…” with an SRT URL — better over lossy links.'));

  rows.push(h('hr', { class: 'divider' }));
  rows.push(
    h('p', { style: 'font-size:.8rem; color:var(--ink-muted)' , text: 'Recommended OBS output: 1280×720, 30 fps, 2500–4000 kb/s, keyframe interval 2 s, x264 preset veryfast, profile high, tune zerolatency.' }),
  );

  $('#obs-body').replaceChildren(...rows);
  dialog.showModal();
}

$('#obs-close').addEventListener('click', () => $('#obs-dialog').close());

function renderStreams() {
  const box = $('#streams-table');
  if (admin.streams.length === 0) {
    box.replaceChildren(h('div', { class: 'empty', text: 'No streams yet. Create one above, then paste the key into OBS.' }));
    return;
  }

  const rows = admin.streams.map((s) => {
    const cells = [
      h('td', {}, [
        h('div', { style: 'font-weight:600', text: s.name }),
        s.unknown ? h('div', { style: 'font-size:.72rem; color:var(--warning)', text: 'publishing but not configured' }) : null,
      ]),
      h('td', {}, [
        h('span', { class: 'key-chip' }, [
          h('span', { text: maskKey(s.key), title: 'Click to reveal', style: 'cursor:pointer', onclick: (e) => { e.target.textContent = e.target.textContent.includes('•') ? s.key : maskKey(s.key); } }),
        ]),
        h('button', { class: 'icon ghost', title: 'Copy the key', onclick: () => copyToClipboard(s.key) }, [icon('copy')]),
      ]),
      h('td', {}, [statusChip(s.live ? 'live' : s.enabled === false ? 'bad' : 'idle', s.live ? 'Live' : s.enabled === false ? 'Disabled' : 'Offline')]),
      h('td', { class: 'num', text: s.live ? sinceLabel(s.since) : '—' }),
      h('td', { class: 'num', text: s.hasAudio ? 'yes' : 'no' }),
      h('td', { class: 'num', text: formatBytes(s.bytesReceived || 0) }),
      h('td', {}, [
        h('div', { class: 'row', style: 'flex-wrap:nowrap; justify-content:flex-end;' }, [
          s.id ? h('button', { class: 'ghost', text: 'OBS', onclick: () => obsDialog(s) }) : null,
          s.id ? h('button', { class: 'ghost', text: s.enabled === false ? 'Enable' : 'Disable', onclick: () => patchStream(s.id, { enabled: s.enabled === false }) }) : null,
          s.id ? h('button', { class: 'ghost', text: 'Rename', onclick: () => renameStream(s) }) : null,
          s.id ? h('button', { class: 'ghost', text: 'New key', onclick: () => rotateKey(s) }) : null,
          s.id ? h('button', { class: 'danger ghost', text: 'Delete', onclick: () => deleteStream(s) }) : null,
        ]),
      ]),
    ];
    return h('tr', {}, cells);
  });

  box.replaceChildren(
    h('table', {}, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { text: 'Name' }),
          h('th', { text: 'Stream key' }),
          h('th', { text: 'Status' }),
          h('th', { class: 'num', text: 'On air' }),
          h('th', { class: 'num', text: 'Audio' }),
          h('th', { class: 'num', text: 'Received' }),
          h('th', {}),
        ]),
      ]),
      h('tbody', {}, rows),
    ]),
  );
}

async function loadStreams() {
  const data = await api('/api/admin/streams', { quiet: true }).catch(() => null);
  if (!data) return;
  admin.streams = data.streams;
  renderStreams();
  renderOrderList();
}

async function patchStream(id, patch) {
  await api(`/api/admin/streams/${id}`, { method: 'PATCH', body: patch });
  toast('Stream updated.', 'good');
  loadStreams();
}

function renameStream(stream) {
  const name = window.prompt('New name for this stream', stream.name);
  if (name === null) return;
  patchStream(stream.id, { name });
}

async function rotateKey(stream) {
  if (!window.confirm(`Generate a new key for “${stream.name}”?\n\nWhoever is publishing with the old key will be disconnected and OBS will need the new one.`)) return;
  const data = await api(`/api/admin/streams/${stream.id}/rotate-key`, { method: 'POST' });
  toast('A new key has been generated.', 'good');
  await loadStreams();
  obsDialog({ ...data.stream, ingest: data.stream.ingest });
}

async function deleteStream(stream) {
  if (!window.confirm(`Delete “${stream.name}”? This cannot be undone.`)) return;
  await api(`/api/admin/streams/${stream.id}`, { method: 'DELETE' });
  toast('Stream deleted.', 'good');
  loadStreams();
}

$('#stream-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  if (!body.key) delete body.key;
  try {
    const data = await api('/api/admin/streams', { method: 'POST', body });
    form.reset();
    await loadStreams();
    obsDialog(data.stream);
  } catch (_) {
    /* the toast already explained */
  }
});

$('#streams-refresh').addEventListener('click', loadStreams);

// ------------------------------------------------------------ composition

function renderLayoutButtons() {
  const box = $('#layout-buttons');
  box.replaceChildren(
    ...admin.layouts.map((l) =>
      h('button', {
        class: admin.composition.layout === l.id ? 'primary' : '',
        title: l.hint,
        text: l.label,
        onclick: () => {
          admin.composition.layout = l.id;
          renderLayoutButtons();
          renderCompPreview();
        },
      }),
    ),
  );
}

async function renderCompPreview() {
  const count = Number($('#preview-count').value);
  $('#preview-count-label').textContent = `${count} source${count === 1 ? '' : 's'}`;
  const data = await api(`/api/admin/layout-preview?count=${count}&layout=${encodeURIComponent(admin.composition.layout)}`, { quiet: true }).catch(() => null);
  if (!data) return;
  const l = data.layout;
  const box = $('#comp-preview');
  if (!l.cells.length) {
    box.replaceChildren(h('div', { class: 'empty', style: 'position:absolute; inset:0; display:grid; place-content:center;', text: 'No cells' }));
    return;
  }
  const dropped = count - l.cells.length;
  const cells = l.cells.map((c, i) =>
    h('div', {
      class: 'cell',
      style: `left:${(c.x / l.width) * 100}%; top:${(c.y / l.height) * 100}%; width:${(c.w / l.width) * 100}%; height:${(c.h / l.height) * 100}%;`,
      text: String(i + 1),
    }),
  );
  if (dropped > 0) {
    cells.push(
      h('div', {
        style: 'position:absolute; right:6px; bottom:6px; font-size:.7rem; color:var(--warning);',
        text: `${dropped} source${dropped === 1 ? '' : 's'} would not fit`,
      }),
    );
  }
  box.replaceChildren(...cells);
}

function renderOrderList() {
  const box = $('#order-list');
  const comp = admin.composition;
  if (!comp) return;
  const known = admin.streams.filter((s) => s.id);
  const ordered = [
    ...(comp.order || []).map((k) => known.find((s) => s.key === k)).filter(Boolean),
    ...known.filter((s) => !(comp.order || []).includes(s.key)),
  ];

  if (ordered.length === 0) {
    box.replaceChildren(h('div', { class: 'empty', style: 'padding:1rem', text: 'No streams to order yet.' }));
    return;
  }

  const move = (index, delta) => {
    const keys = ordered.map((s) => s.key);
    const target = index + delta;
    if (target < 0 || target >= keys.length) return;
    [keys[index], keys[target]] = [keys[target], keys[index]];
    comp.order = keys;
    renderOrderList();
  };

  box.replaceChildren(
    ...ordered.map((s, i) =>
      h('div', { class: 'row', style: 'justify-content:space-between; padding:.35rem .5rem; border:1px solid var(--line); border-radius:8px;' }, [
        h('span', { class: 'row', style: 'gap:.5rem;' }, [
          h('span', { class: 'mono', style: 'color:var(--ink-muted); font-size:.75rem;', text: String(i + 1) }),
          h('span', { text: s.name }),
          statusChip(s.live ? 'live' : 'idle', s.live ? 'Live' : 'Off'),
        ]),
        h('span', { class: 'row', style: 'gap:.25rem;' }, [
          h('button', { class: 'ghost', style: 'padding:.2rem .45rem', text: '↑', title: 'Move up', onclick: () => move(i, -1) }),
          h('button', { class: 'ghost', style: 'padding:.2rem .45rem', text: '↓', title: 'Move down', onclick: () => move(i, 1) }),
        ]),
      ]),
    ),
    h('p', { style: 'font-size:.72rem; color:var(--ink-muted); margin:.4rem 0 0;', text: 'Order is applied when you save. Offline sources are skipped without leaving a hole.' }),
  );
}

function fillCompForm() {
  const form = $('#comp-form');
  const c = admin.composition;
  for (const [key, value] of Object.entries(c)) {
    const field = form.elements[key];
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = !!value;
    else field.value = value;
  }

  const select = $('#encoder-select');
  select.replaceChildren(
    h('option', { value: 'auto', text: 'Automatic (hardware if present)' }),
    ...admin.encoders.map((e) =>
      h('option', { value: e.id, disabled: !e.usable, text: e.usable ? e.label : `${e.label} — ${e.reason}` }),
    ),
  );
  select.value = c.encoder;
}

$('#comp-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') body[el.name] = el.checked;
    else if (el.type === 'number') body[el.name] = Number(el.value);
    else body[el.name] = el.value;
  }
  body.layout = admin.composition.layout;
  body.order = admin.composition.order || [];
  try {
    const data = await api('/api/admin/composition', { method: 'PUT', body });
    admin.composition = data.composition;
    toast(`Saved. Encoding with ${data.resolved}.`, 'good');
    fillCompForm();
  } catch (_) {
    /* toast shown */
  }
});

$('#comp-restart').addEventListener('click', async () => {
  await api('/api/admin/restart', { method: 'POST' });
  toast('The encoder is restarting.', 'good');
});

$('#comp-command').addEventListener('click', async () => {
  const box = $('#command-box');
  if (box.style.display !== 'none') {
    box.style.display = 'none';
    return;
  }
  const data = await api('/api/admin/ffmpeg-command');
  box.textContent = data.command;
  box.style.display = '';
});

$('#preview-count').addEventListener('input', renderCompPreview);

async function loadComposition() {
  const data = await api('/api/admin/composition', { quiet: true }).catch(() => null);
  if (!data) return;
  admin.composition = data.composition;
  admin.layouts = data.layouts;
  admin.encoders = data.encoders;
  $('#encoder-chip').replaceChildren(statusChip('idle', `resolved: ${data.resolved}`));
  $('#encoder-hint').textContent = data.capabilities.drawtext
    ? `${data.capabilities.cores} cores · ${data.capabilities.cpu}`
    : 'Text labels are unavailable: this ffmpeg build has no drawtext filter.';
  fillCompForm();
  renderLayoutButtons();
  renderCompPreview();
  renderOrderList();
}

// ------------------------------------------------------------------- users

function renderUsers() {
  const box = $('#users-table');
  box.replaceChildren(
    h('table', {}, [
      h('thead', {}, [h('tr', {}, [h('th', { text: 'Username' }), h('th', { text: 'Role' }), h('th', { text: 'Last signed in' }), h('th', {})])]),
      h('tbody', {}, admin.users.map((u) =>
        h('tr', {}, [
          h('td', { style: 'font-weight:600', text: u.username }),
          h('td', {}, [
            h('select', {
              style: 'width:auto',
              onchange: async (e) => {
                try {
                  await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } });
                  toast('Role updated.', 'good');
                  loadUsers();
                } catch (_) {
                  loadUsers();
                }
              },
            }, [
              h('option', { value: 'viewer', selected: u.role === 'viewer', text: 'Viewer' }),
              h('option', { value: 'admin', selected: u.role === 'admin', text: 'Administrator' }),
            ]),
          ]),
          h('td', { text: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never' }),
          h('td', {}, [
            h('div', { class: 'row', style: 'justify-content:flex-end; flex-wrap:nowrap;' }, [
              h('button', {
                class: 'ghost',
                text: 'Set password',
                onclick: async () => {
                  const password = window.prompt(`New password for ${u.username} (at least 8 characters)`);
                  if (!password) return;
                  await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { password } });
                  toast('Password changed.', 'good');
                },
              }),
              h('button', {
                class: 'danger ghost',
                text: 'Delete',
                onclick: async () => {
                  if (!window.confirm(`Delete the user “${u.username}”?`)) return;
                  await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                  toast('User deleted.', 'good');
                  loadUsers();
                },
              }),
            ]),
          ]),
        ]),
      )),
    ]),
  );
}

async function loadUsers() {
  const data = await api('/api/admin/users', { quiet: true }).catch(() => null);
  if (!data) return;
  admin.users = data.users;
  renderUsers();
}

$('#user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    await api('/api/admin/users', { method: 'POST', body });
    form.reset();
    toast('User created.', 'good');
    loadUsers();
  } catch (_) {
    /* toast shown */
  }
});

// ------------------------------------------------------------------ server

function sparkline(values) {
  const svg = $('#sparkline');
  svg.replaceChildren();
  if (values.length < 2) return;
  const w = 300;
  const hgt = 44;
  const max = Math.max(...values, 1) * 1.15;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => [i * step, hgt - (v / max) * (hgt - 4) - 2]);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${w},${hgt} L0,${hgt} Z`;
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  svg.appendChild(mk('path', { class: 'area', d: area }));
  svg.appendChild(mk('path', { class: 'line', d: line }));
  svg.appendChild(mk('line', { class: 'base', x1: 0, y1: hgt - 0.5, x2: w, y2: hgt - 0.5 }));
  $('#spark-label').textContent = `peak ${Math.round(Math.max(...values))} kb/s`;
}

function renderServer() {
  const st = admin.status;
  if (!st) return;
  const c = st.compositor;
  const host = st.host;
  const cpu = host.cpuPercent;
  const mem = host.memory;

  const tiles = [
    {
      label: 'CPU',
      value: cpu != null ? String(cpu) : '—',
      unit: '%',
      sub: `${host.cpu.cores} cores · load ${host.cpu.load[0]}`,
      meter: cpu,
    },
    {
      label: 'Memory',
      value: String(mem.percent),
      unit: '%',
      sub: `${mem.usedMb} of ${mem.totalMb} MB`,
      meter: mem.percent,
    },
    {
      label: 'Encoder',
      value: c.running ? String(c.progress.fps) : 'idle',
      unit: c.running ? 'fps' : '',
      sub: c.running ? `${c.encoder} · speed ${c.progress.speed}×` : c.enabled ? 'waiting for sources' : 'composition off',
    },
    {
      label: 'Output',
      value: c.running ? formatBitrate(c.progress.bitrateKbps) : '—',
      unit: c.running ? bitrateUnit(c.progress.bitrateKbps) : '',
      sub: `${c.sources.length} on air · ${c.restarts} restarts`,
    },
    {
      label: 'Uptime',
      value: formatDuration(st.node.uptimeSec),
      sub: `node ${st.node.version} · ${st.node.memoryMb} MB`,
    },
  ];

  $('#server-tiles').replaceChildren(
    ...tiles.map((t) =>
      h('div', { class: 'stat' }, [
        h('div', { class: 'label', text: t.label }),
        h('div', { class: 'value' }, [t.value, t.unit ? h('span', { class: 'unit', text: t.unit }) : null]),
        t.sub ? h('div', { class: 'sub', text: t.sub }) : null,
        t.meter != null ? h('div', { class: meterClass(t.meter) }, [h('span', { style: `width:${Math.min(100, t.meter)}%` })]) : null,
      ]),
    ),
  );

  const chip = $('#header-status');
  const live = c.running;
  chip.className = `status ${live ? 'is-live' : c.enabled ? 'is-warn' : 'is-idle'}`;
  chip.replaceChildren(h('span', { class: 'dot' }), document.createTextNode(live ? 'Encoding' : c.enabled ? 'Standby' : 'Composition off'));

  const rows = [
    ['Programme path', st.compositor.output.path],
    ['MediaMTX', st.mediamtx.reachable ? 'reachable' : `unreachable — ${st.mediamtx.lastError || 'no detail'}`],
    ['Programme viewers', String(st.program.readers ?? 0)],
    ['Last encoder exit', c.lastExit ? `code ${c.lastExit.code ?? '—'} ${c.lastExit.signal || ''} at ${new Date(c.lastExit.at).toLocaleTimeString()}` : 'never'],
    ['Last ffmpeg message', c.lastError || 'none'],
    ['Version', `${st.app.version} on ${host.platform}`],
    ['CPU', host.cpu.model],
  ];
  $('#server-info').replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v, style: 'word-break:break-word' })]));

  if (c.running) {
    admin.bitrateHistory.push(c.progress.bitrateKbps || 0);
    if (admin.bitrateHistory.length > 60) admin.bitrateHistory.shift();
    sparkline(admin.bitrateHistory);
  }
}

async function loadStatus() {
  const data = await api('/api/admin/status', { quiet: true }).catch(() => null);
  if (!data) return;
  admin.status = data;
  renderServer();
}

function fillSettingsForm() {
  const form = $('#settings-form');
  for (const [key, value] of Object.entries(admin.settings)) {
    const field = form.elements[key];
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = !!value;
    else field.value = value;
  }
  $('#log-budget').textContent = `at most ${admin.settings.logMaxSizeMb * admin.settings.logMaxFiles} MB per channel`;
}

$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') body[el.name] = el.checked;
    else if (el.type === 'number') body[el.name] = Number(el.value);
    else body[el.name] = el.value;
  }
  const data = await api('/api/admin/settings', { method: 'PUT', body });
  admin.settings = data.settings;
  fillSettingsForm();
  toast('Settings saved.', 'good');
});

async function loadSettings() {
  const data = await api('/api/admin/settings', { quiet: true }).catch(() => null);
  if (!data) return;
  admin.settings = data.settings;
  admin.ingest = data.ingest;
  fillSettingsForm();
}

// -------------------------------------------------------------------- logs

async function loadLogs() {
  const channel = $('#log-channel').value;
  const lines = $('#log-lines').value;
  const data = await api(`/api/admin/logs?channel=${channel}&lines=${lines}`, { quiet: true }).catch(() => null);
  if (!data) return;
  const view = $('#log-view');
  const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 40;
  view.replaceChildren(
    ...data.lines.map((line) => {
      const level = /\sERROR\s/.test(line) ? 'error' : /\sWARN\s/.test(line) ? 'warn' : /\sDEBUG\s/.test(line) ? 'debug' : 'info';
      return h('div', { class: `lvl-${level}`, text: line });
    }),
  );
  if (atBottom) view.scrollTop = view.scrollHeight;
  $('#log-files').textContent = data.files.map((f) => `${f.file} ${formatBytes(f.bytes)}`).join('   ·   ');
}

$('#log-refresh').addEventListener('click', loadLogs);
$('#log-channel').addEventListener('change', loadLogs);
$('#log-lines').addEventListener('change', loadLogs);
$('#log-auto').addEventListener('change', (e) => {
  if (admin.logTimer) clearInterval(admin.logTimer);
  admin.logTimer = e.target.checked ? setInterval(loadLogs, 3000) : null;
});

// -------------------------------------------------------------------- boot

$('#brand-mark').appendChild(icon('logo'));

api('/api/auth/me', { quiet: true }).then((data) => {
  if (!data.user) return;
  $('#user-area').prepend(h('span', { style: 'font-size:.82rem; color:var(--ink-muted)', text: data.user.username }));
  $('#user-area').appendChild(
    h('button', {
      class: 'ghost',
      text: 'Sign out',
      onclick: async () => {
        await api('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      },
    }),
  );
});

const initial = (window.location.hash || '#streams').slice(1);
if ($(`#panel-${initial}`)) showPanel(initial);

Promise.all([loadStreams(), loadComposition(), loadUsers(), loadSettings(), loadStatus()]);
setInterval(loadStatus, 2000);
setInterval(loadStreams, 5000);
