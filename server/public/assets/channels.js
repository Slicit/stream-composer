/* "My channels" — create and manage the channels a logged-in user owns. */
/* eslint-env browser */

import { $, h, api, toast, icon, copyToClipboard } from './ui.js';

const state = {
  channels: [],
  available: [], // streams this user may add to a channel
  editingId: null, // channel currently being edited, or null when creating
};

$('#brand-mark').appendChild(icon('logo'));

// -------------------------------------------------------------------- user

api('/api/auth/me', { quiet: true }).then((data) => {
  if (!data.user) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    return;
  }
  $('#user-area').prepend(h('span', { style: 'font-size:.82rem; color:var(--ink-muted)', text: data.user.username }));
});

// ------------------------------------------------------------ stream picker

function renderStreamPicker() {
  const box = $('#stream-picker');
  if (state.available.length === 0) {
    box.replaceChildren(h('span', { class: 'hint', text: 'No streams are available to you yet.' }));
    return;
  }
  const editing = state.channels.find((c) => c.id === state.editingId);
  const checked = new Set(editing ? editing.streamIds : []);
  box.replaceChildren(
    ...state.available.map((s) =>
      h('label', { class: 'inline', style: 'font-size:.85rem;' }, [
        h('input', { type: 'checkbox', name: 'streamIds', value: s.id, checked: checked.has(s.id) }),
        h('span', { text: `${s.nickname || s.name}${s.visibility === 'private' ? ' 🔒' : ''}` }),
      ]),
    ),
  );
}

async function loadAvailable() {
  const data = await api('/api/streams/available', { quiet: true }).catch(() => null);
  if (!data) return;
  state.available = data.streams;
  renderStreamPicker();
}

// ---------------------------------------------------------------- listing

function renderChannels() {
  const box = $('#channels-list');
  if (state.channels.length === 0) {
    box.replaceChildren(h('div', { class: 'empty', text: 'No channels yet — create one above.' }));
    return;
  }
  const rows = state.channels.map((c) => {
    const url = `${window.location.origin}/c/${c.slug}`;
    return h('div', { class: 'card', style: 'margin-bottom:.6rem; padding:.85rem 1rem;' }, [
      h('div', { class: 'row', style: 'align-items:center;' }, [
        h('div', { style: 'flex:1 1 auto;' }, [
          h('div', { style: 'font-weight:600', text: c.name }),
          h('div', { class: 'mono', style: 'font-size:.75rem; color:var(--ink-muted)', text: `/c/${c.slug} · ${c.visibility} · ${c.streamIds.length} streams` }),
        ]),
        h('button', { class: 'icon ghost', title: 'Copy the link', onclick: () => copyToClipboard(url) }, [icon('copy')]),
        h('a', { class: 'ghost btn', href: `/c/${c.slug}`, target: '_blank' }, ['View']),
        h('button', { class: 'ghost', text: 'Edit', onclick: () => startEdit(c) }),
        h('button', { class: 'danger ghost', text: 'Delete', onclick: () => deleteChannel(c) }),
      ]),
      h('div', { class: 'row', style: 'margin-top:.6rem; align-items:center;' }, [
        h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', onchange: (e) => uploadBackground(c, e.target.files[0]) }),
        h('span', { class: 'hint', text: c.backgroundImage ? 'Background set — choose a file to replace it.' : 'No background image yet.' }),
      ]),
    ]);
  });
  box.replaceChildren(...rows);
}

async function loadChannels() {
  const data = await api('/api/channels/mine', { quiet: true }).catch(() => null);
  if (!data) return;
  state.channels = data.channels;
  renderChannels();
  renderStreamPicker(); // pre-checked boxes depend on whether we are editing
}

// ------------------------------------------------------------------- form

function startEdit(channel) {
  state.editingId = channel.id;
  const form = $('#channel-form');
  form.name.value = channel.name;
  form.slug.value = channel.slug;
  form.visibility.value = channel.visibility;
  $('#form-title').textContent = `Edit “${channel.name}”`;
  $('#channel-submit').textContent = 'Save changes';
  $('#channel-cancel-edit').style.display = '';
  renderStreamPicker();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
  state.editingId = null;
  const form = $('#channel-form');
  form.reset();
  $('#form-title').textContent = 'Create a channel';
  $('#channel-submit').textContent = 'Create channel';
  $('#channel-cancel-edit').style.display = 'none';
  renderStreamPicker();
}

$('#channel-cancel-edit').addEventListener('click', resetForm);

$('#channel-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const streamIds = [...form.querySelectorAll('input[name="streamIds"]:checked')].map((el) => el.value);
  const body = {
    name: form.name.value,
    visibility: form.visibility.value,
    streamIds,
  };
  if (form.slug.value.trim()) body.slug = form.slug.value.trim();

  try {
    if (state.editingId) {
      await api(`/api/channels/mine/${state.editingId}`, { method: 'PATCH', body });
      toast('Channel updated.', 'good');
    } else {
      await api('/api/channels/mine', { method: 'POST', body });
      toast('Channel created.', 'good');
    }
    resetForm();
    loadChannels();
  } catch (_) {
    /* api() already toasted the error */
  }
});

async function deleteChannel(channel) {
  if (!window.confirm(`Delete "${channel.name}"? This cannot be undone.`)) return;
  await api(`/api/channels/mine/${channel.id}`, { method: 'DELETE' });
  toast('Channel deleted.', 'good');
  if (state.editingId === channel.id) resetForm();
  loadChannels();
}

/** Raw PUT of the file's bytes — no multipart, see routes/channels.js. */
async function uploadBackground(channel, file) {
  if (!file) return;
  const res = await fetch(`/api/channels/mine/${channel.id}/background`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    toast((data && data.error) || 'Could not upload the image.', 'error');
    return;
  }
  toast('Background image updated.', 'good');
  loadChannels();
}

$('#channels-refresh').addEventListener('click', loadChannels);

loadAvailable();
loadChannels();
