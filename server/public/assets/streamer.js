/* Streamer self-service: manage your own streams and restream destinations. */
/* eslint-env browser */

import { $, $$, h, api, toast, icon, statusChip, formatBitrate, bitrateUnit, formatBytes, formatDuration, copyToClipboard } from './ui.js';

const state = {
  streams: [],
  quota: 0,
  relays: [],
  relayProviders: [],
};

$('#brand-mark').appendChild(icon('logo'));

// -------------------------------------------------------------------- user

api('/api/auth/me', { quiet: true }).then((data) => {
  if (!data.user || (data.user.role !== 'streamer' && data.user.role !== 'admin')) {
    window.location.href = '/';
    return;
  }
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

// -------------------------------------------------------------------- tabs

function showPanel(name) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.panel === name));
  $$('.panel').forEach((p) => p.classList.toggle('is-active', p.id === `panel-${name}`));
  window.location.hash = name;
  if (name === 'restream') loadRelays();
}
$$('.tab').forEach((tab) => tab.addEventListener('click', () => showPanel(tab.dataset.panel)));

// ------------------------------------------------------------------ streams

function shortMaskKey(key) {
  return `${key.slice(0, 4)}..`;
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
    rows.push(h('p', { style: 'font-size:.85rem; color:var(--ink-2)', text: 'In OBS: Settings → Stream → Service “Custom…”, then paste these two values.' }));
    rows.push(field('Server', ing.rtmp.server));
    rows.push(field('Stream key', ing.rtmp.key));
  }
  if (ing.srt) rows.push(field('SRT URL', ing.srt.url, 'Service “Custom…” with an SRT URL — better over lossy links.'));
  $('#obs-body').replaceChildren(...rows);
  dialog.showModal();
}
$('#obs-close').addEventListener('click', () => $('#obs-dialog').close());

function renderStreams() {
  const box = $('#streams-table');
  $('#quota-readout').textContent = `${state.streams.length} of ${state.quota} used`;
  if (state.streams.length === 0) {
    box.replaceChildren(h('div', { class: 'empty', text: 'No streams yet. Create one above, then paste the key into OBS.' }));
    return;
  }
  const rows = state.streams.map((s) => h('tr', {}, [
    h('td', { style: 'font-weight:600', text: s.name }),
    h('td', { text: s.nickname || '—' }),
    h('td', { style: 'white-space:nowrap' }, [
      h('div', { class: 'key-input' }, [
        h('input', { readonly: true, value: shortMaskKey(s.key), class: 'mono', title: 'Click to copy the key', onclick: () => copyToClipboard(s.key) }),
        h('button', { class: 'key-input-copy', type: 'button', title: 'Copy the key', onclick: () => copyToClipboard(s.key) }, [icon('copy')]),
      ]),
    ]),
    h('td', {}, [
      statusChip(s.live ? 'live' : s.enabled === false ? 'bad' : 'idle', s.live ? 'Live' : s.enabled === false ? 'Disabled' : 'Offline'),
    ]),
    h('td', {}, [statusChip(s.visibility === 'public' ? 'live' : 'idle', s.visibility === 'public' ? 'Public' : 'Private')]),
    h('td', {}, [
      h('div', { class: 'row', style: 'flex-wrap:nowrap; justify-content:flex-end;' }, [
        h('button', { class: 'ghost', text: 'OBS', onclick: () => obsDialog(s) }),
        h('button', { class: 'ghost', text: s.enabled === false ? 'Enable' : 'Disable', onclick: () => patchStream(s.id, { enabled: s.enabled === false }) }),
        h('button', {
          class: 'ghost',
          text: s.visibility === 'public' ? 'Make private' : 'Make public',
          onclick: () => patchStream(s.id, { visibility: s.visibility === 'public' ? 'private' : 'public' }),
        }),
        h('button', {
          class: 'icon ghost',
          title: 'Generate a new key',
          onclick: async () => {
            if (!window.confirm(`Generate a new key for “${s.name}”?\n\nWhoever is publishing with the old key will be disconnected.`)) return;
            await api(`/api/streams/mine/${s.id}/rotate-key`, { method: 'POST' });
            toast('A new key has been generated.', 'good');
            loadStreams();
          },
        }, [icon('refresh')]),
        h('button', {
          class: 'icon ghost danger',
          title: 'Delete',
          onclick: async () => {
            if (!window.confirm(`Delete “${s.name}”? This cannot be undone.`)) return;
            await api(`/api/streams/mine/${s.id}`, { method: 'DELETE' });
            toast('Stream deleted.', 'good');
            loadStreams();
          },
        }, [icon('trash')]),
      ]),
    ]),
  ]));
  box.replaceChildren(
    h('table', {}, [
      h('thead', {}, [h('tr', {}, [
        h('th', { text: 'Name' }), h('th', { text: 'Nickname' }), h('th', { text: 'Stream key' }),
        h('th', { text: 'Status' }), h('th', { text: 'Visibility' }), h('th', {}),
      ])]),
      h('tbody', {}, rows),
    ]),
  );
}

async function patchStream(id, patch) {
  await api(`/api/streams/mine/${id}`, { method: 'PATCH', body: patch });
  toast('Stream updated.', 'good');
  loadStreams();
}

async function loadStreams() {
  const data = await api('/api/streams/mine', { quiet: true }).catch(() => null);
  if (!data) return;
  if (document.activeElement && document.activeElement.closest('#streams-table')) return;
  state.streams = data.streams;
  state.quota = data.quota;
  renderStreams();
  renderRelaySources();
}

$('#stream-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  if (!body.nickname) delete body.nickname;
  try {
    await api('/api/streams/mine', { method: 'POST', body });
    toast('Stream created.', 'good');
    form.reset();
    loadStreams();
  } catch (_) {
    /* toast shown */
  }
});

$('#streams-refresh').addEventListener('click', loadStreams);

// ----------------------------------------------------------------- restream

function applyRelayProvider({ keepValues = false } = {}) {
  const id = $('#relay-provider').value;
  const provider = state.relayProviders.find((p) => p.id === id) || state.relayProviders[0];
  if (!provider) return;
  $('#relay-url-label').textContent = provider.urlLabel || 'Server URL';
  $('#relay-key-label').textContent = provider.keyLabel || 'Stream key';
  $('#relay-url-hint').textContent = provider.urlHint || '';
  $('#relay-key-hint').textContent = provider.keyHint || '';
  $('#relay-provider-hint').textContent = provider.id === 'custom'
    ? 'Anything that accepts an RTMP publish.'
    : `Forwarded to ${provider.label} untouched.`;
  if (!keepValues) $('#relay-url').value = provider.url || '';
  $('#relay-url').placeholder = provider.url || 'rtmp://';
}

function relayStatusChip(relay) {
  if (!relay.enabled) return statusChip('idle', 'Off');
  switch (relay.status) {
    case 'live': return statusChip('live', 'Forwarding');
    case 'connecting': return statusChip('warn', 'Connecting');
    case 'retrying': return statusChip('bad', relay.retryInMs > 0 ? `Retrying in ${Math.ceil(relay.retryInMs / 1000)}s` : 'Retrying');
    case 'waiting': return statusChip('idle', 'Waiting for the source');
    default: return statusChip('idle', 'Idle');
  }
}

async function patchRelay(id, patch, note) {
  await api(`/api/relays/mine/${id}`, { method: 'PATCH', body: patch });
  if (note) toast(note, 'good');
  loadRelays();
}

async function replaceRelayKey(relay) {
  const key = window.prompt(`New stream key for “${relay.name}”.\n\nLeave it empty to cancel.`);
  if (!key) return;
  await patchRelay(relay.id, { key: key.trim() }, 'Stream key replaced.');
}

async function revealRelayKey(relay, span) {
  if (!span.textContent.includes('•')) {
    span.textContent = relay.keyMasked;
    return;
  }
  const data = await api(`/api/relays/mine/${relay.id}/key`);
  span.textContent = data.key || '(none)';
}

async function showRelayCommand(relay) {
  const box = $('#relay-command-box');
  if (box.style.display !== 'none' && box.dataset.relay === relay.id) {
    box.style.display = 'none';
    return;
  }
  const data = await api(`/api/relays/mine/${relay.id}/command`);
  box.textContent = data.command;
  box.dataset.relay = relay.id;
  box.style.display = '';
}

async function deleteRelay(relay) {
  if (!window.confirm(`Stop forwarding “${relay.sourceName || 'this source'}” to ${relay.name}?\n\nThe destination and its stream key are deleted.`)) return;
  await api(`/api/relays/mine/${relay.id}`, { method: 'DELETE' });
  toast('Destination removed.', 'good');
  loadRelays();
}

function renderRelays() {
  const box = $('#relays-table');
  const summary = state.relays.length ? `${state.relays.filter((r) => r.status === 'live').length} of ${state.relays.length} carrying` : '';
  $('#relay-summary').textContent = summary;

  if (state.relays.length === 0) {
    box.replaceChildren(h('div', { class: 'empty', text: 'Nothing is being forwarded. Add a destination above to send one of your streams on to Twitch, YouTube or any other RTMP service.' }));
    return;
  }

  const sorted = [...state.relays].sort((a, b) =>
    String(a.sourceName || '').localeCompare(String(b.sourceName || ''), undefined, { numeric: true, sensitivity: 'base' })
    || String(a.name).localeCompare(String(b.name)));

  let lastSource = Symbol('none');
  const rows = sorted.map((r) => {
    const newGroup = r.streamId !== lastSource;
    lastSource = r.streamId;
    return h('tr', {}, [
      h('td', {}, [
        newGroup ? h('div', { style: 'font-weight:600', text: r.sourceName || 'deleted source' }) : h('span', { style: 'color:var(--ink-muted)', text: '↳' }),
      ]),
      h('td', {}, [
        h('div', { style: 'font-weight:600', text: r.name }),
        h('div', { class: 'mono', style: 'font-size:.72rem; color:var(--ink-muted); word-break:break-all;', text: r.url }),
      ]),
      h('td', { style: 'white-space:nowrap' }, [
        r.hasKey
          ? h('span', { class: 'key-chip' }, [
            h('span', { text: r.keyMasked, title: 'Click to reveal', style: 'cursor:pointer', onclick: (e) => revealRelayKey(r, e.target) }),
          ])
          : h('span', { style: 'color:var(--ink-muted)', text: 'in the URL' }),
      ]),
      h('td', {}, [
        h('div', { class: 'row', style: 'gap:.35rem' }, [
          relayStatusChip(r),
          r.audio === 'aac' ? h('span', { class: 'warn-chip', title: 'Audio is re-encoded to AAC for this destination.', text: 'AAC' }) : null,
        ].filter(Boolean)),
      ]),
      h('td', { class: 'num', text: r.status === 'live' ? formatDuration(r.progress.uptimeSec) : '—' }),
      h('td', { class: 'num', text: r.status === 'live' ? `${formatBitrate(r.progress.bitrateKbps)} ${bitrateUnit(r.progress.bitrateKbps)}` : '—' }),
      h('td', { class: 'num', text: formatBytes(r.progress.bytesSent || 0) }),
      h('td', {}, [
        h('div', { class: 'row', style: 'flex-wrap:nowrap; justify-content:flex-end;' }, [
          h('button', {
            class: r.enabled ? 'ghost' : 'primary',
            text: r.enabled ? 'Turn off' : 'Turn on',
            onclick: () => patchRelay(r.id, { enabled: !r.enabled }, r.enabled ? 'Forwarding stopped.' : 'Forwarding will start with the source.'),
          }),
          h('button', { class: 'ghost', text: 'New key', onclick: () => replaceRelayKey(r) }),
          h('button', { class: 'ghost', text: 'Command', onclick: () => showRelayCommand(r) }),
          h('button', { class: 'icon ghost danger', title: 'Delete', onclick: () => deleteRelay(r) }, [icon('trash')]),
        ]),
      ]),
    ]);
  });

  box.replaceChildren(
    h('table', {}, [
      h('thead', {}, [h('tr', {}, [
        h('th', { text: 'Source' }), h('th', { text: 'Destination' }), h('th', { text: 'Stream key' }), h('th', { text: 'Status' }),
        h('th', { class: 'num', text: 'For' }), h('th', { class: 'num', text: 'Rate' }), h('th', { class: 'num', text: 'Sent' }), h('th', {}),
      ])]),
      h('tbody', {}, rows),
    ]),
  );
}

function renderRelaySources() {
  const select = $('#relay-source');
  const chosen = select.value;
  select.replaceChildren(...state.streams.map((s) => h('option', { value: s.id, text: s.enabled === false ? `${s.name} (disabled)` : s.name })));
  if (state.streams.some((s) => s.id === chosen)) select.value = chosen;
  if (state.streams.length === 0) select.replaceChildren(h('option', { value: '', text: 'Create a stream first' }));
}

async function loadRelays() {
  const data = await api('/api/relays/mine', { quiet: true }).catch(() => null);
  if (!data) return;
  const first = state.relayProviders.length === 0;
  state.relays = data.relays;
  state.relayProviders = data.providers;
  if (first) {
    $('#relay-provider').replaceChildren(...state.relayProviders.map((p) => h('option', { value: p.id, text: p.label })));
    applyRelayProvider();
  }
  renderRelays();
}

$('#relay-provider').addEventListener('change', () => applyRelayProvider());
$('#relays-refresh').addEventListener('click', loadRelays);

$('#relay-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  if (!body.streamId) {
    toast('Create a stream first — there is nothing to forward yet.', 'error');
    return;
  }
  if (!body.name) delete body.name;
  try {
    await api('/api/relays/mine', { method: 'POST', body });
    form.reset();
    applyRelayProvider();
    toast('Destination added. It goes live as soon as the source is publishing.', 'good');
    loadRelays();
  } catch (_) {
    /* toast shown */
  }
});

// -------------------------------------------------------------------- boot

const initial = (window.location.hash || '#streams').slice(1);
if ($(`#panel-${initial}`)) showPanel(initial);

loadStreams();
setInterval(loadStreams, 5000);
setInterval(() => {
  if ($('#panel-restream').classList.contains('is-active')) loadRelays();
}, 3000);
