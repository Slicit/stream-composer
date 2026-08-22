/* Shared helpers: fetch wrapper, toasts, formatters, tiny DOM utilities. */
/* eslint-env browser */

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let toastStack = null;

export function toast(message, kind = 'info', ms = 4200) {
  if (!toastStack) {
    toastStack = h('div', { class: 'toast-stack' });
    document.body.appendChild(toastStack);
  }
  const el = h('div', { class: `toast${kind === 'error' ? ' is-error' : kind === 'good' ? ' is-good' : ''}`, text: message });
  toastStack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s ease';
    setTimeout(() => el.remove(), 260);
  }, ms);
  return el;
}

export async function api(path, { method = 'GET', body, quiet = false } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('Signed out.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status}).`;
    if (!quiet) toast(message, 'error');
    throw Object.assign(new Error(message), { status: res.status, data });
  }
  return data;
}

// ------------------------------------------------------------- formatters

/** "1 source", "2 sources" — irregular plurals pass their own form as `plural`. */
export function pluralize(count, word, plural = `${word}s`) {
  return `${count} ${count === 1 ? word : plural}`;
}

export function formatBitrate(kbps) {
  if (!kbps || kbps < 1) return '0';
  if (kbps >= 1000) return (kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1);
  return String(Math.round(kbps));
}

export function bitrateUnit(kbps) {
  return kbps >= 1000 ? 'Mb/s' : 'kb/s';
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const hrs = Math.floor(seconds / 3600);
  if (hrs > 0) return `${hrs}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function sinceLabel(isoString) {
  if (!isoString) return '—';
  const elapsed = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (!Number.isFinite(elapsed) || elapsed < 0) return '—';
  return formatDuration(elapsed);
}

/** Status chip: colour always travels with a word, never alone. */
export function statusChip(kind, label) {
  const cls = { live: 'is-live', warn: 'is-warn', bad: 'is-bad', idle: 'is-idle' }[kind] || 'is-idle';
  return h('span', { class: `status ${cls}` }, [h('span', { class: 'dot' }), label]);
}

export function meterClass(percent) {
  if (percent >= 90) return 'meter is-critical';
  if (percent >= 75) return 'meter is-serious';
  if (percent >= 60) return 'meter is-warn';
  return 'meter';
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to the clipboard.', 'good', 1800);
    return true;
  } catch (_) {
    // Clipboard API needs a secure context; fall back to a selection prompt.
    const area = h('textarea', { style: 'position:fixed;opacity:0' });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast('Copied to the clipboard.', 'good', 1800);
      return true;
    } catch (_e) {
      toast('Could not copy — select the text and copy it manually.', 'error');
      return false;
    } finally {
      area.remove();
    }
  }
}

export function icon(name) {
  const paths = {
    play: '<path d="M5 3.5v13l11-6.5z"/>',
    pause: '<path d="M6 3.5h3.2v13H6zM11.8 3.5H15v13h-3.2z"/>',
    expand: '<path d="M3 7V3h4M17 7V3h-4M3 13v4h4M17 13v4h-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    stats: '<path d="M3 16V9M8 16V4M13 16v-5M18 16v-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    volume: '<path d="M4 8h3l4-3v10l-4-3H4z"/><path d="M14 7.5a4 4 0 010 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    mute: '<path d="M4 8h3l4-3v10l-4-3H4z"/><path d="M14 8l4 4M18 8l-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    refresh: '<path d="M16 10a6 6 0 11-1.8-4.3M16 2v4h-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    copy: '<rect x="7" y="7" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 5H6a2 2 0 00-2 2v7" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    trash: '<path d="M4 6h12M8 6V4.5a1 1 0 011-1h2a1 1 0 011 1V6M8.5 9.5v6M11.5 9.5v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5.5 6l.7 9.4a1.5 1.5 0 001.5 1.4h4.6a1.5 1.5 0 001.5-1.4L14.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    logo: '<rect x="2" y="3" width="7" height="6" rx="1.4" fill="#fff" opacity=".95"/><rect x="11" y="3" width="7" height="6" rx="1.4" fill="#fff" opacity=".7"/><rect x="2" y="11" width="16" height="6" rx="1.4" fill="#fff" opacity=".85"/>',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths[name] || '';
  return svg;
}
