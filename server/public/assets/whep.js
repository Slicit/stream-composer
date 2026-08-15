/* WHEP (WebRTC-HTTP Egress Protocol) client.
 *
 * Talks to MediaMTX through this server's authenticated proxy. Kept dependency
 * free and small: one class, an optional audio-only mode, automatic reconnect
 * with backoff, and a stats poller for the overlay.
 */

/* eslint-env browser */

function parseLinkHeader(value) {
  // <stun:host:port>; rel="ice-server"
  // <turn:host:port>; rel="ice-server"; username="u"; credential="c"; credential-type="password"
  const servers = [];
  if (!value) return servers;
  for (const part of value.split(/,\s*(?=<)/)) {
    const urlMatch = /^<(.+?)>/.exec(part.trim());
    if (!urlMatch) continue;
    const attrs = {};
    for (const m of part.matchAll(/;\s*([a-zA-Z-]+)\s*=\s*"?([^";]+)"?/g)) {
      attrs[m[1].toLowerCase()] = m[2];
    }
    if ((attrs.rel || '') !== 'ice-server') continue;
    const server = { urls: urlMatch[1] };
    if (attrs.username) server.username = attrs.username;
    if (attrs.credential) server.credential = attrs.credential;
    servers.push(server);
  }
  return servers;
}

export class WhepClient extends EventTarget {
  /**
   * @param {string} url    proxied WHEP endpoint, e.g. /mtx/webrtc/program/whep
   * @param {object} opts   { video: boolean, audio: boolean, autoReconnect: boolean }
   */
  constructor(url, opts = {}) {
    super();
    this.url = url;
    this.wantVideo = opts.video !== false;
    this.wantAudio = !!opts.audio;
    this.autoReconnect = opts.autoReconnect !== false;
    this.pc = null;
    this.sessionUrl = null;
    this.stream = null;
    this.state = 'idle';
    this.retryDelay = 0;
    this.retryTimer = null;
    this.stopped = true;
    this.statsTimer = null;
    this.lastStats = null;
    this._prevBytes = 0;
    this._prevAt = 0;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(state, detail) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', { state, ...detail });
  }

  async iceServers() {
    try {
      const res = await fetch(this.url, { method: 'OPTIONS' });
      return parseLinkHeader(res.headers.get('link'));
    } catch (_) {
      return [];
    }
  }

  async start() {
    this.stopped = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    await this.connect();
  }

  async connect() {
    this.teardownPeer();
    this.setState('connecting');

    let iceServers = [];
    try {
      iceServers = await this.iceServers();
    } catch (_) {
      iceServers = [];
    }
    if (this.stopped) return;

    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    this.pc = pc;
    this.stream = new MediaStream();

    if (this.wantVideo) pc.addTransceiver('video', { direction: 'recvonly' });
    if (this.wantAudio) pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.addEventListener('track', (event) => {
      this.stream.addTrack(event.track);
      this.emit('track', { stream: this.stream, track: event.track });
    });

    pc.addEventListener('connectionstatechange', () => {
      if (!this.pc || this.pc !== pc) return;
      if (pc.connectionState === 'connected') {
        this.retryDelay = 0;
        this.setState('playing');
        this.startStats();
      } else if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this.stopStats();
        if (!this.stopped) this.scheduleReconnect(`connection ${pc.connectionState}`);
      }
    });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.waitForIce(pc);
      if (this.stopped) return;

      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp,
      });

      if (res.status === 401 || res.status === 403) {
        this.setState('error', { message: 'Your session has expired — please sign in again.', fatal: true });
        this.stopped = true;
        return;
      }
      if (res.status === 404) {
        this.setState('offline', { message: 'This stream is not on air.' });
        this.scheduleReconnect('stream offline', 4000);
        return;
      }
      if (!res.ok) {
        throw new Error(`the media server answered ${res.status}`);
      }

      const location = res.headers.get('location');
      if (location) this.sessionUrl = new URL(location, window.location.origin).toString();

      const answer = await res.text();
      if (this.stopped) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch (err) {
      if (this.stopped) return;
      this.setState('error', { message: err.message });
      this.scheduleReconnect(err.message);
    }
  }

  /** Non-trickle: gather everything, then offer. Simpler and MediaMTX is fine with it. */
  waitForIce(pc, timeoutMs = 2500) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', check);
        clearTimeout(timer);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      const timer = setTimeout(done, timeoutMs);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  scheduleReconnect(reason, fixedDelay) {
    if (!this.autoReconnect || this.stopped || this.retryTimer) return;
    this.retryDelay = fixedDelay || Math.min(this.retryDelay ? this.retryDelay * 2 : 1000, 10000);
    this.setState('reconnecting', { reason, inMs: this.retryDelay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.connect();
    }, this.retryDelay);
  }

  startStats() {
    this.stopStats();
    this.statsTimer = setInterval(() => this.collectStats(), 1000);
  }

  stopStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  async collectStats() {
    if (!this.pc) return;
    let reports;
    try {
      reports = await this.pc.getStats();
    } catch (_) {
      return;
    }
    const out = { kbps: 0, fps: 0, width: 0, height: 0, packetsLost: 0, jitterMs: 0, codec: null, rttMs: null };
    const codecs = new Map();
    reports.forEach((r) => {
      if (r.type === 'codec') codecs.set(r.id, r.mimeType);
    });
    reports.forEach((r) => {
      if (r.type === 'inbound-rtp' && !r.isRemote) {
        const now = r.timestamp;
        const bytes = r.bytesReceived || 0;
        if (this._prevAt && now > this._prevAt) {
          out.kbps = Math.max(0, Math.round(((bytes - this._prevBytes) * 8) / (now - this._prevAt)));
        }
        this._prevBytes = bytes;
        this._prevAt = now;
        out.fps = Math.round(r.framesPerSecond || 0);
        out.width = r.frameWidth || 0;
        out.height = r.frameHeight || 0;
        out.packetsLost = r.packetsLost || 0;
        out.jitterMs = Math.round((r.jitter || 0) * 1000);
        if (r.codecId && codecs.has(r.codecId)) out.codec = codecs.get(r.codecId).replace(/^\w+\//, '');
      }
      if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) {
        out.rttMs = Math.round(r.currentRoundTripTime * 1000);
      }
    });
    this.lastStats = out;
    this.emit('stats', out);
  }

  teardownPeer() {
    this.stopStats();
    if (this.sessionUrl) {
      // Best-effort session teardown so MediaMTX releases the reader promptly.
      navigator.sendBeacon
        ? fetch(this.sessionUrl, { method: 'DELETE', keepalive: true }).catch(() => {})
        : fetch(this.sessionUrl, { method: 'DELETE' }).catch(() => {});
      this.sessionUrl = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch (_) {
        /* already closed */
      }
      this.pc = null;
    }
    this._prevBytes = 0;
    this._prevAt = 0;
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.teardownPeer();
    this.stream = null;
    this.setState('idle');
  }
}

export default WhepClient;
