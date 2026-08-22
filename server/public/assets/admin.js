/* Administration console. */
/* eslint-env browser */

import { $, $$, h, api, toast, icon, statusChip, formatBitrate, bitrateUnit, formatBytes, formatDuration, sinceLabel, copyToClipboard, meterClass } from './ui.js';

const admin = {
  streams: [],
  relays: [],
  relayProviders: [],
  relaySources: [],
  channels: [],
  homepageChannelId: null,
  channelEditingId: null, // channel currently being edited in the form above, or null when creating
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
  if (name === 'restream') loadRelays();
  if (name === 'channels') loadChannels();
  if (name === 'server') loadBandwidthHistory();
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => showPanel(tab.dataset.panel)));

// ---------------------------------------------------------------- streams

/** Just enough to recognise a key at a glance — the full one is a click away. */
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

/**
 * The nickname is burnt into the video, so it is edited in place rather than
 * behind a prompt: you tend to nudge the wording a few times before it looks
 * right, and each save re-renders the grid within a couple of seconds.
 */
function nicknameField(stream) {
  const input = h('input', {
    value: stream.nickname || '',
    maxlength: 32,
    placeholder: stream.name,
    style: 'min-width:9rem',
    title: 'Shown on air, bottom-centre of this stream. Empty falls back to the name.',
  });

  let saved = stream.nickname || '';
  const commit = async () => {
    const value = input.value.trim();
    if (value === saved) return;
    try {
      await api(`/api/admin/streams/${stream.id}`, { method: 'PATCH', body: { nickname: value } });
      saved = value;
      stream.nickname = value;
      toast(value ? `On air as “${value}”.` : `Nickname cleared — “${stream.name}” will be shown.`, 'good');
    } catch (_) {
      input.value = saved; // the toast already explained why
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = saved;
      input.blur();
    }
  });
  return input;
}

/** "→ 2 destinations", when this source is being forwarded anywhere. */
function relayChip(stream) {
  if (!stream.id) return null;
  const mine = admin.relays.filter((r) => r.streamId === stream.id && r.enabled);
  if (mine.length === 0) return null;
  const carrying = mine.filter((r) => r.status === 'live').length;
  return h('span', {
    class: 'status is-idle',
    style: 'cursor:pointer',
    title: `${mine.map((r) => r.name).join(', ')} — open the Restream tab`,
    onclick: () => showPanel('restream'),
  }, [h('span', { class: 'dot' }), `→ ${carrying}/${mine.length}`]);
}

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
      h('td', {}, [s.id ? nicknameField(s) : h('span', { style: 'color:var(--ink-muted)', text: '—' })]),
      h('td', { style: 'white-space:nowrap' }, [
        h('div', { class: 'key-input' }, [
          h('input', { readonly: true, value: shortMaskKey(s.key), class: 'mono', title: 'Click to copy the key', onclick: () => copyToClipboard(s.key) }),
          h('button', { class: 'key-input-copy', type: 'button', title: 'Copy the key', onclick: () => copyToClipboard(s.key) }, [icon('copy')]),
        ]),
      ]),
      h('td', {}, [
        statusChip(s.live ? 'live' : s.enabled === false ? 'bad' : 'idle', s.live ? 'Live' : s.enabled === false ? 'Disabled' : 'Offline'),
        // Publishing happily, but no browser can play it directly — which
        // breaks previews, and the whole grid when the browser composes.
        s.playback && s.playback.problem
          ? h('span', {
            class: 'warn-chip',
            title: `${s.playback.problem.summary} ${s.playback.problem.fix || ''}`.trim(),
            text: 'not playable',
          })
          : null,
        // Cross-reference to the Restream tab: knowing a source is going out to
        // a platform matters most when you are about to rotate its key here.
        relayChip(s),
      ].filter(Boolean)),
      h('td', { class: 'num', text: s.live ? sinceLabel(s.since) : '—' }),
      h('td', { class: 'num', text: s.hasAudio ? 'yes' : 'no' }),
      h('td', { class: 'num', text: formatBytes(s.bytesReceived || 0) }),
      h('td', {}, [
        s.id
          ? statusChip(s.visibility === 'public' ? 'live' : 'idle', s.visibility === 'public' ? 'Public' : 'Private')
          : h('span', { style: 'color:var(--ink-muted)', text: '—' }),
        s.id && s.visibility !== 'public' && (s.sharedWith || []).length
          ? h('span', { class: 'meta', style: 'display:block; font-size:.7rem; margin-top:.2rem;', text: `${s.sharedWith.length} granted` })
          : null,
      ].filter(Boolean)),
      h('td', {}, [
        h('div', { class: 'row', style: 'flex-wrap:nowrap; justify-content:flex-end;' }, [
          s.id ? h('button', { class: 'ghost', text: 'OBS', onclick: () => obsDialog(s) }) : null,
          s.id ? h('button', { class: 'ghost', text: s.enabled === false ? 'Enable' : 'Disable', onclick: () => patchStream(s.id, { enabled: s.enabled === false }) }) : null,
          s.id ? h('button', { class: 'ghost', text: 'Rename', onclick: () => renameStream(s) }) : null,
          s.id ? h('button', { class: 'ghost', text: s.visibility === 'public' ? 'Make private' : 'Make public', onclick: () => patchStream(s.id, { visibility: s.visibility === 'public' ? 'private' : 'public' }) }) : null,
          s.id && s.visibility !== 'public' ? h('button', { class: 'ghost', text: 'Access', onclick: () => editStreamAccess(s) }) : null,
          s.id ? h('button', { class: 'icon ghost', title: 'Generate a new key', onclick: () => rotateKey(s) }, [icon('refresh')]) : null,
          s.id ? h('button', { class: 'icon ghost danger', title: 'Delete', onclick: () => deleteStream(s) }, [icon('trash')]) : null,
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
          h('th', { text: 'Nickname' }),
          h('th', { text: 'Stream key' }),
          h('th', { text: 'Status' }),
          h('th', { class: 'num', text: 'On air' }),
          h('th', { class: 'num', text: 'Audio' }),
          h('th', { class: 'num', text: 'Received' }),
          h('th', { text: 'Visibility' }),
          h('th', {}),
        ]),
      ]),
      h('tbody', {}, rows),
    ]),
  );
}

/**
 * Grant/revoke access to a private resource (a stream here; channels reuse
 * this too — see setChannelAccess). A checkbox list of every actual user
 * rather than a type-and-hope prompt: guessing at usernames from memory is
 * exactly the kind of thing that quietly grants the wrong person access.
 */
function openAccessDialog({ title, currentIds, onSave }) {
  const dialog = $('#access-dialog');
  $('#access-title').textContent = title;
  const filter = $('#access-filter');
  filter.value = '';
  const selected = new Set(currentIds || []);

  function renderList() {
    const q = filter.value.trim().toLowerCase();
    const users = admin.users.filter((u) => !q || u.username.toLowerCase().includes(q));
    if (users.length === 0) {
      $('#access-list').replaceChildren(h('div', { class: 'empty', text: 'No matching users.' }));
      return;
    }
    $('#access-list').replaceChildren(
      ...users.map((u) => h('label', { class: 'inline', style: 'padding:.3rem 0;' }, [
        h('input', {
          type: 'checkbox',
          checked: selected.has(u.id),
          onchange: (e) => {
            if (e.target.checked) selected.add(u.id);
            else selected.delete(u.id);
          },
        }),
        h('span', { text: u.username }),
        u.role === 'admin' ? h('span', { class: 'meta', style: 'margin-left:.4rem;', text: '(admin — always allowed)' }) : null,
      ].filter(Boolean))),
    );
  }
  renderList();
  filter.oninput = renderList;

  const cancel = () => dialog.close();
  $('#access-cancel').onclick = cancel;
  $('#access-close').onclick = cancel;
  $('#access-save').onclick = () => {
    dialog.close();
    onSave([...selected]);
  };

  dialog.showModal();
  filter.focus();
}

function editStreamAccess(stream) {
  openAccessDialog({
    title: `Access — ${stream.name}`,
    currentIds: stream.sharedWith || [],
    onSave: (sharedWith) => patchStream(stream.id, { sharedWith }),
  });
}

async function loadStreams() {
  const data = await api('/api/admin/streams', { quiet: true }).catch(() => null);
  if (!data) return;
  // The table re-renders every few seconds; doing that under someone's cursor
  // would wipe a half-typed nickname.
  if (document.activeElement && document.activeElement.closest('#streams-table')) return;
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
  if (!body.nickname) delete body.nickname;
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

// --------------------------------------------------------------- restream

/**
 * Picking a platform fills in its ingest URL and re-labels the two fields.
 * The URL stays editable for every provider, because ingest hostnames are
 * regional and the well-known ones do get retired.
 */
function applyRelayProvider({ keepValues = false } = {}) {
  const id = $('#relay-provider').value;
  const provider = admin.relayProviders.find((p) => p.id === id) || admin.relayProviders[0];
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
    case 'live':
      return statusChip('live', 'Forwarding');
    case 'connecting':
      return statusChip('warn', 'Connecting');
    case 'retrying':
      return statusChip('bad', relay.retryInMs > 0 ? `Retrying in ${Math.ceil(relay.retryInMs / 1000)}s` : 'Retrying');
    case 'waiting':
      return statusChip('idle', 'Waiting for the source');
    default:
      return statusChip('idle', 'Idle');
  }
}

async function patchRelay(id, patch, note) {
  await api(`/api/admin/relays/${id}`, { method: 'PATCH', body: patch });
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
  const data = await api(`/api/admin/relays/${relay.id}/key`);
  span.textContent = data.key || '(none)';
}

/** Same idea as "Show ffmpeg command" on the Composition tab, per destination. */
async function showRelayCommand(relay) {
  const box = $('#relay-command-box');
  if (box.style.display !== 'none' && box.dataset.relay === relay.id) {
    box.style.display = 'none';
    return;
  }
  const data = await api(`/api/admin/relays/${relay.id}/command`);
  box.textContent = data.command;
  box.dataset.relay = relay.id;
  box.style.display = '';
}

async function deleteRelay(relay) {
  if (!window.confirm(`Stop forwarding “${relay.sourceName || 'this source'}” to ${relay.name}?\n\nThe destination and its stream key are deleted.`)) return;
  await api(`/api/admin/relays/${relay.id}`, { method: 'DELETE' });
  toast('Destination removed.', 'good');
  loadRelays();
}

function renderRelays() {
  const box = $('#relays-table');

  const summary = admin.relays.length
    ? `${admin.relays.filter((r) => r.status === 'live').length} of ${admin.relays.length} carrying`
    : '';
  $('#relay-summary').textContent = summary;

  if (admin.relays.length === 0) {
    box.replaceChildren(
      h('div', { class: 'empty', text: 'Nothing is being forwarded. Add a destination above to send a source on to Twitch, YouTube or any other RTMP service.' }),
    );
    return;
  }

  // Grouped by source, with the name printed once per group: one camera going
  // to three platforms is the case this page exists for, and repeating its
  // name three times makes that harder to read, not easier.
  const sorted = [...admin.relays].sort((a, b) =>
    String(a.sourceName || '').localeCompare(String(b.sourceName || ''), undefined, { numeric: true, sensitivity: 'base' })
    || String(a.name).localeCompare(String(b.name)));

  let lastSource = Symbol('none');
  const rows = sorted.map((r) => {
    const newGroup = r.streamId !== lastSource;
    lastSource = r.streamId;

    return h('tr', {}, [
      h('td', {}, [
        newGroup
          ? h('div', { style: 'font-weight:600', text: r.sourceName || 'deleted source' })
          : h('span', { style: 'color:var(--ink-muted)', text: '↳' }),
        newGroup && r.sourceMissing
          ? h('div', { style: 'font-size:.72rem; color:var(--warning)', text: 'the source no longer exists' })
          : null,
      ]),
      h('td', {}, [
        h('div', { style: 'font-weight:600', text: r.name }),
        h('div', { class: 'mono', style: 'font-size:.72rem; color:var(--ink-muted); word-break:break-all;', text: r.url }),
      ]),
      h('td', { style: 'white-space:nowrap' }, [
        r.hasKey
          ? h('span', { class: 'key-chip' }, [
            h('span', {
              text: r.keyMasked,
              title: 'Click to reveal',
              style: 'cursor:pointer',
              onclick: (e) => revealRelayKey(r, e.target),
            }),
          ])
          : h('span', { style: 'color:var(--ink-muted)', text: 'in the URL' }),
      ]),
      h('td', {}, [
        h('div', { class: 'row', style: 'gap:.35rem' }, [
          relayStatusChip(r),
          r.audio === 'aac' ? h('span', { class: 'warn-chip', title: 'Audio is re-encoded to AAC for this destination.', text: 'AAC' }) : null,
        ].filter(Boolean)),
        r.enabled && r.lastError && r.status !== 'live'
          ? h('div', { style: 'font-size:.7rem; color:var(--ink-muted); margin-top:.2rem; word-break:break-word;', text: r.lastError })
          : null,
      ]),
      h('td', { class: 'num', text: r.status === 'live' ? formatDuration(r.progress.uptimeSec) : '—' }),
      h('td', { class: 'num', text: r.status === 'live' ? `${formatBitrate(r.progress.bitrateKbps)} ${bitrateUnit(r.progress.bitrateKbps)}` : '—' }),
      h('td', { class: 'num', text: formatBytes(r.progress.bytesSent || 0) }),
      h('td', {}, [
        h('div', { class: 'row', style: 'flex-wrap:nowrap; justify-content:flex-end;' }, [
          h('button', {
            class: r.enabled ? 'ghost' : 'primary',
            text: r.enabled ? 'Turn off' : 'Turn on',
            title: r.enabled ? 'Stop forwarding immediately' : 'Start forwarding as soon as the source is publishing',
            onclick: () => patchRelay(r.id, { enabled: !r.enabled }, r.enabled ? 'Forwarding stopped.' : 'Forwarding will start with the source.'),
          }),
          h('button', { class: 'ghost', text: 'New key', onclick: () => replaceRelayKey(r) }),
          h('button', { class: 'ghost', text: 'Command', title: 'The exact ffmpeg carrying this destination, with the key removed', onclick: () => showRelayCommand(r) }),
          h('button', { class: 'danger ghost', text: 'Delete', onclick: () => deleteRelay(r) }),
        ]),
      ]),
    ]);
  });

  box.replaceChildren(
    h('table', {}, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { text: 'Source' }),
          h('th', { text: 'Destination' }),
          h('th', { text: 'Stream key' }),
          h('th', { text: 'Status' }),
          h('th', { class: 'num', text: 'For' }),
          h('th', { class: 'num', text: 'Rate' }),
          h('th', { class: 'num', text: 'Sent' }),
          h('th', {}),
        ]),
      ]),
      h('tbody', {}, rows),
    ]),
  );
}

function renderRelaySources() {
  const select = $('#relay-source');
  const chosen = select.value;
  select.replaceChildren(
    ...admin.relaySources.map((s) => h('option', { value: s.id, text: s.enabled === false ? `${s.name} (disabled)` : s.name })),
  );
  if (admin.relaySources.some((s) => s.id === chosen)) select.value = chosen;
  if (admin.relaySources.length === 0) {
    select.replaceChildren(h('option', { value: '', text: 'Create a stream first' }));
  }
}

async function loadRelays() {
  const data = await api('/api/admin/relays', { quiet: true }).catch(() => null);
  if (!data) return;
  const first = admin.relayProviders.length === 0;
  admin.relays = data.relays;
  admin.relayProviders = data.providers;
  admin.relaySources = data.sources;

  if (first) {
    $('#relay-provider').replaceChildren(
      ...admin.relayProviders.map((p) => h('option', { value: p.id, text: p.label })),
    );
    applyRelayProvider();
  }
  // Refilling the source list under someone's cursor would fight their typing.
  if (!(document.activeElement && document.activeElement.closest('#relay-form'))) renderRelaySources();
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
    await api('/api/admin/relays', { method: 'POST', body });
    form.reset();
    applyRelayProvider();
    renderRelaySources();
    toast('Destination added. It goes live as soon as the source is publishing.', 'good');
    loadRelays();
  } catch (_) {
    /* the toast already explained */
  }
});

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

/**
 * Reflect the composition mode: check the right option, grey out the settings
 * the encoder owns, and say what the choice means right now.
 */
function applyModeUi() {
  const mode = admin.composition.mode === 'web' ? 'web' : 'server';
  for (const radio of document.querySelectorAll('#mode-choice input[name="mode"]')) {
    radio.checked = radio.value === mode;
  }
  $('#panel-composition').classList.toggle('is-not-encoding', mode === 'web');
  // Only web composition ever plays a source straight to a browser.
  $('#fallback-row').style.display = mode === 'web' ? '' : 'none';
  $('#fallback-select').value = admin.composition.fallback === 'warn' ? 'warn' : 'hls';
  $('#mode-note').textContent = mode === 'web'
    ? 'No encoder runs. Resolution, bitrate and encoder settings below are kept but unused; the layout, gutter, background and captions still apply, drawn by the player. Viewers must be able to reach each source, so "Show individual sources to viewers" cannot hide them in this mode.'
    : 'ffmpeg is composing and publishing one programme stream.';
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
  applyModeUi();
}

$('#fallback-select').addEventListener('change', async (event) => {
  try {
    const data = await api('/api/admin/composition', { method: 'PUT', body: { fallback: event.currentTarget.value } });
    admin.composition = data.composition;
    toast('Saved.', 'good');
  } catch (_) {
    applyModeUi();
  }
});

// Switching mode is a big enough change that it applies on the spot rather
// than waiting for Save — and it takes effect within a poll either way.
for (const radio of document.querySelectorAll('#mode-choice input[name="mode"]')) {
  radio.addEventListener('change', async (event) => {
    const mode = event.currentTarget.value;
    try {
      const data = await api('/api/admin/composition', { method: 'PUT', body: { mode } });
      admin.composition = data.composition;
      applyModeUi();
      toast(mode === 'web'
        ? 'Composing in the browser. The encoder has stopped.'
        : 'Composing on the server. The encoder is starting.', 'good');
    } catch (_) {
      applyModeUi(); // put the radio back where it was
    }
  });
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

// ---------------------------------------------------------------- channels

function renderChannelStreamPicker() {
  const box = $('#channel-stream-picker');
  const editing = admin.channels.find((c) => c.id === admin.channelEditingId);
  const checked = new Set(editing ? editing.streamIds : []);
  const withKey = admin.streams.filter((s) => s.id);
  if (withKey.length === 0) {
    box.replaceChildren(h('span', { class: 'hint', text: 'No streams exist yet.' }));
    return;
  }
  box.replaceChildren(
    ...withKey.map((s) =>
      h('label', { class: 'inline', style: 'font-size:.85rem;' }, [
        h('input', { type: 'checkbox', name: 'streamIds', value: s.id, checked: checked.has(s.id) }),
        h('span', { text: `${s.nickname || s.name}${s.visibility === 'private' ? ' 🔒' : ''}` }),
      ]),
    ),
  );
}

function startEditChannel(channel) {
  admin.channelEditingId = channel.id;
  const form = $('#channel-form');
  form.name.value = channel.name;
  form.slug.value = channel.slug;
  form.visibility.value = channel.visibility;
  $('#channel-form-title').textContent = `Edit “${channel.name}”`;
  $('#channel-form-submit').textContent = 'Save changes';
  $('#channel-form-cancel').style.display = '';
  renderChannelStreamPicker();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEditChannel() {
  admin.channelEditingId = null;
  const form = $('#channel-form');
  form.reset();
  $('#channel-form-title').textContent = 'Add a channel';
  $('#channel-form-submit').textContent = 'Create';
  $('#channel-form-cancel').style.display = 'none';
  renderChannelStreamPicker();
}

$('#channel-form-cancel').addEventListener('click', cancelEditChannel);

function renderChannels() {
  const box = $('#channels-table');
  if (admin.channels.length === 0) {
    box.replaceChildren(h('div', { class: 'empty', text: 'No channels yet.' }));
    return;
  }
  const rows = admin.channels.map((c) => {
    const owner = admin.users.find((u) => u.id === c.ownerId);
    const isHomepage = admin.homepageChannelId === c.id;
    return h('tr', {}, [
      h('td', {}, [
        h('div', { style: 'font-weight:600', text: c.name }),
        h('div', { class: 'mono', style: 'font-size:.72rem; color:var(--ink-muted)', text: `/c/${c.slug}` }),
      ]),
      h('td', { text: owner ? owner.username : '—' }),
      h('td', {}, [statusChip(c.visibility === 'public' ? 'live' : 'idle', c.visibility === 'public' ? 'Public' : 'Private')]),
      h('td', { class: 'num', text: String((c.streamIds || []).length) }),
      h('td', {}, [isHomepage ? h('span', { class: 'warn-chip', text: 'Homepage' }) : null].filter(Boolean)),
      h('td', {}, [
        h('div', { class: 'row', style: 'flex-wrap:nowrap; justify-content:flex-end;' }, [
          h('button', { class: 'ghost', text: 'Edit', onclick: () => startEditChannel(c) }),
          h('button', {
            class: 'ghost',
            text: isHomepage ? 'Unset homepage' : 'Set as homepage',
            onclick: () => setHomepageChannel(isHomepage ? null : c.id),
          }),
          h('button', { class: 'icon ghost danger', title: 'Delete', onclick: () => deleteChannel(c) }, [icon('trash')]),
        ]),
      ]),
    ]);
  });
  box.replaceChildren(
    h('table', {}, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { text: 'Channel' }),
          h('th', { text: 'Owner' }),
          h('th', { text: 'Visibility' }),
          h('th', { class: 'num', text: 'Streams' }),
          h('th', {}),
          h('th', {}),
        ]),
      ]),
      h('tbody', {}, rows),
    ]),
  );
}

async function loadChannels() {
  const data = await api('/api/admin/channels', { quiet: true }).catch(() => null);
  if (!data) return;
  admin.channels = data.channels;
  admin.homepageChannelId = data.homepageChannelId;
  renderChannels();
  renderChannelStreamPicker(); // pre-checked boxes depend on whether we are editing
}

async function setHomepageChannel(id) {
  if (id) await api(`/api/admin/channels/${id}/homepage`, { method: 'PUT' });
  else await api(`/api/admin/channels/${admin.homepageChannelId}/homepage`, { method: 'DELETE' });
  toast(id ? 'Homepage channel set.' : 'Homepage channel cleared.', 'good');
  loadChannels();
}

async function deleteChannel(channel) {
  if (!window.confirm(`Delete “${channel.name}”? This cannot be undone.`)) return;
  await api(`/api/admin/channels/${channel.id}`, { method: 'DELETE' });
  toast('Channel deleted.', 'good');
  loadChannels();
}

$('#channel-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  // FormData collapses repeated checkbox names to their last value — collect
  // the checked streamIds explicitly instead.
  const streamIds = [...form.querySelectorAll('input[name="streamIds"]:checked')].map((el) => el.value);
  const body = { name: form.name.value, visibility: form.visibility.value, streamIds };
  if (form.slug.value.trim()) body.slug = form.slug.value.trim();

  try {
    if (admin.channelEditingId) {
      await api(`/api/admin/channels/${admin.channelEditingId}`, { method: 'PATCH', body });
      toast('Channel updated.', 'good');
    } else {
      await api('/api/admin/channels', { method: 'POST', body });
      toast('Channel created.', 'good');
    }
    cancelEditChannel();
    loadChannels();
  } catch (err) {
    toast(err.message || 'Could not save the channel.', 'error');
  }
});

$('#channels-refresh').addEventListener('click', loadChannels);

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

/** chart.js ships as a UMD bundle, so it goes in through a script tag, not import(). */
function loadScript(src) {
  if (window.Chart) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(el);
  });
}

function formatKbps(v) {
  return `${formatBitrate(v)} ${bitrateUnit(v)}`;
}

let bandwidthChart = null;

async function renderBandwidthChart(history) {
  const canvas = $('#bandwidth-chart');
  if (!canvas) return;
  try {
    await loadScript('/vendor/chart.js');
  } catch (_) {
    return; // the tab still works without it; there is just no chart
  }
  const Chart = window.Chart;
  if (!Chart) return;

  const labels = history.map((p) =>
    new Date(p.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  );
  const inbound = history.map((p) => p.inboundKbps);
  const outbound = history.map((p) => p.outboundKbps);

  if (bandwidthChart) {
    bandwidthChart.data.labels = labels;
    bandwidthChart.data.datasets[0].data = inbound;
    bandwidthChart.data.datasets[1].data = outbound;
    bandwidthChart.update();
    return;
  }

  bandwidthChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Inbound', data: inbound, borderColor: '#3987e5', backgroundColor: 'rgba(57,135,229,.12)', fill: true, tension: 0.25, pointRadius: 0, borderWidth: 1.5 },
        { label: 'Outbound', data: outbound, borderColor: '#0ca30c', backgroundColor: 'rgba(12,163,12,.12)', fill: true, tension: 0.25, pointRadius: 0, borderWidth: 1.5 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 10, color: '#898781' }, grid: { color: 'rgba(255,255,255,.08)' } },
        y: { beginAtZero: true, ticks: { color: '#898781', callback: (v) => formatKbps(v) }, grid: { color: 'rgba(255,255,255,.08)' } },
      },
      plugins: {
        legend: { labels: { color: '#c3c2b7' } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatKbps(ctx.parsed.y)}` } },
      },
    },
  });
}

async function loadBandwidthHistory() {
  const data = await api('/api/admin/bandwidth-history', { quiet: true }).catch(() => null);
  if (!data) return;
  renderBandwidthChart(data.history);
}

function renderServer() {
  const st = admin.status;
  if (!st) return;
  const c = st.compositor;
  const web = c.mode === 'web';
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
      value: web ? 'none' : c.running ? String(c.progress.fps) : 'idle',
      unit: !web && c.running ? 'fps' : '',
      sub: web
        ? 'composed in the browser'
        : c.running ? `${c.encoder} · speed ${c.progress.speed}×` : c.enabled ? 'waiting for sources' : 'composition off',
    },
    {
      label: web ? 'Sources' : 'Output',
      value: web ? String(c.sources.length) : c.running ? formatBitrate(c.progress.bitrateKbps) : '—',
      unit: !web && c.running ? bitrateUnit(c.progress.bitrateKbps) : '',
      sub: web ? 'sent to each viewer directly' : `${c.sources.length} on air · ${c.restarts} restarts`,
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
  const live = web ? c.sources.length > 0 : c.running;
  chip.className = `status ${live ? 'is-live' : c.enabled ? 'is-warn' : 'is-idle'}`;
  chip.replaceChildren(
    h('span', { class: 'dot' }),
    document.createTextNode(
      !c.enabled ? 'Composition off' : web ? (live ? 'On air (web)' : 'Standby') : live ? 'Encoding' : 'Standby',
    ),
  );

  const rows = [
    ['Composition', web ? 'in the browser — nothing re-encoded' : 'on the server'],
    ['Programme path', web ? '—' : st.compositor.output.path],
    ['MediaMTX', st.mediamtx.reachable ? 'reachable' : `unreachable — ${st.mediamtx.lastError || 'no detail'}`],
    [
      'Restreaming',
      !st.relays || st.relays.total === 0
        ? 'no destinations'
        : `${st.relays.live} of ${st.relays.enabled} switched on are carrying (${st.relays.total} configured)`,
    ],
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

Promise.all([loadStreams(), loadRelays(), loadComposition(), loadChannels(), loadUsers(), loadSettings(), loadStatus()]);
setInterval(loadStatus, 2000);
setInterval(loadStreams, 5000);
// Only while it is on screen: the numbers are per-second, and nobody needs
// them refreshed behind a tab they are not looking at.
setInterval(() => {
  if ($('#panel-restream').classList.contains('is-active')) loadRelays();
}, 3000);
// The server samples every fifteen minutes — refreshing far more often than
// that would just redraw the same chart.
setInterval(() => {
  if ($('#panel-server').classList.contains('is-active')) loadBandwidthHistory();
}, 5 * 60 * 1000);
