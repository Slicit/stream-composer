// WHEP (WebRTC-HTTP Egress Protocol) client. Talks to MediaMTX through the
// Go data plane's authenticated proxy. Ported field-for-field from
// server/public/assets/whep.js — dependency-free, framework-agnostic, so
// the port keeps the same shape (an EventTarget) rather than becoming a
// hook itself; useWhepClient wraps it for React.

export interface IceServer {
  urls: string
  username?: string
  credential?: string
}

function parseLinkHeader(value: string | null): IceServer[] {
  const servers: IceServer[] = []
  if (!value) return servers
  for (const part of value.split(/,\s*(?=<)/)) {
    const urlMatch = /^<(.+?)>/.exec(part.trim())
    if (!urlMatch) continue
    const attrs: Record<string, string> = {}
    for (const m of part.matchAll(/;\s*([a-zA-Z-]+)\s*=\s*"?([^";]+)"?/g)) {
      attrs[m[1].toLowerCase()] = m[2]
    }
    if ((attrs.rel || '') !== 'ice-server') continue
    const server: IceServer = { urls: urlMatch[1] }
    if (attrs.username) server.username = attrs.username
    if (attrs.credential) server.credential = attrs.credential
    servers.push(server)
  }
  return servers
}

/**
 * Whether this browser can receive H.264, which is what every source here
 * produces. Nearly all browsers can, but some Linux builds of Chromium and
 * Firefox ship without it, and the failure is otherwise opaque — MediaMTX
 * simply closes the session and the player spins forever.
 */
export function canReceiveH264(): boolean {
  try {
    const caps = RTCRtpReceiver.getCapabilities('video')
    if (!caps || !caps.codecs) return true // unknown: let it try
    return caps.codecs.some((c) => /h264/i.test(c.mimeType))
  } catch {
    return true
  }
}

export type WhepState = 'idle' | 'connecting' | 'playing' | 'reconnecting' | 'offline' | 'error'

export interface WhepStateDetail {
  state: WhepState
  message?: string
  fatal?: boolean
  reason?: string
  inMs?: number
}

export interface WhepStats {
  kbps: number
  fps: number
  width: number
  height: number
  packetsLost: number
  jitterMs: number
  codec: string | null
  rttMs: number | null
}

type Listener<T> = (detail: T) => void

export class WhepClient extends EventTarget {
  url: string
  wantVideo: boolean
  wantAudio: boolean
  autoReconnect: boolean
  pc: RTCPeerConnection | null = null
  sessionUrl: string | null = null
  stream: MediaStream | null = null
  state: WhepState = 'idle'
  lastStats: WhepStats | null = null

  private retryDelay = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private prevBytes = 0
  private prevAt = 0

  constructor(url: string, opts: { video?: boolean; audio?: boolean; autoReconnect?: boolean } = {}) {
    super()
    this.url = url
    this.wantVideo = opts.video !== false
    this.wantAudio = !!opts.audio
    this.autoReconnect = opts.autoReconnect !== false
  }

  onState(fn: Listener<WhepStateDetail>): () => void {
    const handler = (e: Event) => fn((e as CustomEvent<WhepStateDetail>).detail)
    this.addEventListener('state', handler)
    return () => this.removeEventListener('state', handler)
  }

  onTrack(fn: Listener<{ stream: MediaStream; track: MediaStreamTrack }>): () => void {
    const handler = (e: Event) => fn((e as CustomEvent<{ stream: MediaStream; track: MediaStreamTrack }>).detail)
    this.addEventListener('track', handler)
    return () => this.removeEventListener('track', handler)
  }

  onStats(fn: Listener<WhepStats>): () => void {
    const handler = (e: Event) => fn((e as CustomEvent<WhepStats>).detail)
    this.addEventListener('stats', handler)
    return () => this.removeEventListener('stats', handler)
  }

  private emit<T>(type: string, detail: T) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }

  private setState(state: WhepState, detail: Partial<WhepStateDetail> = {}) {
    if (this.state === state) return
    this.state = state
    this.emit('state', { state, ...detail })
  }

  private async iceServers(): Promise<IceServer[]> {
    try {
      const res = await fetch(this.url, { method: 'OPTIONS' })
      return parseLinkHeader(res.headers.get('link'))
    } catch {
      return []
    }
  }

  async start(): Promise<void> {
    this.stopped = false
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    await this.connect()
  }

  private async connect(): Promise<void> {
    this.teardownPeer()

    if (this.wantVideo && !canReceiveH264()) {
      this.stopped = true
      this.setState('error', {
        message: 'This browser cannot decode H.264 video, which every stream here uses. Try Chrome, Edge, Safari, or a Firefox build with H.264 support.',
        fatal: true,
      })
      return
    }

    this.setState('connecting')

    let iceServers: IceServer[] = []
    try {
      iceServers = await this.iceServers()
    } catch {
      iceServers = []
    }
    if (this.stopped) return

    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
    this.pc = pc
    this.stream = new MediaStream()

    if (this.wantVideo) pc.addTransceiver('video', { direction: 'recvonly' })
    if (this.wantAudio) pc.addTransceiver('audio', { direction: 'recvonly' })

    pc.addEventListener('track', (event) => {
      this.stream!.addTrack(event.track)
      this.emit('track', { stream: this.stream, track: event.track })
    })

    pc.addEventListener('connectionstatechange', () => {
      if (!this.pc || this.pc !== pc) return
      if (pc.connectionState === 'connected') {
        this.retryDelay = 0
        this.setState('playing')
        this.startStats()
      } else if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this.stopStats()
        if (!this.stopped) this.scheduleReconnect(`connection ${pc.connectionState}`)
      }
    })

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await this.waitForIce(pc)
      if (this.stopped) return

      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription!.sdp,
      })

      if (res.status === 401 || res.status === 403) {
        this.setState('error', { message: 'Your session has expired — please sign in again.', fatal: true })
        this.stopped = true
        return
      }
      if (res.status === 404) {
        this.setState('offline', { message: 'This stream is not on air.' })
        this.scheduleReconnect('stream offline', 4000)
        return
      }
      if (!res.ok) {
        throw new Error(`the media server answered ${res.status}`)
      }

      const location = res.headers.get('location')
      if (location) this.sessionUrl = new URL(location, window.location.origin).toString()

      const answer = await res.text()
      if (this.stopped) return
      await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    } catch (err) {
      if (this.stopped) return
      const message = err instanceof Error ? err.message : String(err)
      this.setState('error', { message })
      this.scheduleReconnect(message)
    }
  }

  /** Non-trickle: gather everything, then offer. Simpler and MediaMTX is fine with it. */
  private waitForIce(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', check)
        clearTimeout(timer)
        resolve()
      }
      const check = () => {
        if (pc.iceGatheringState === 'complete') done()
      }
      const timer = setTimeout(done, timeoutMs)
      pc.addEventListener('icegatheringstatechange', check)
    })
  }

  private scheduleReconnect(reason: string, fixedDelay?: number) {
    if (!this.autoReconnect || this.stopped || this.retryTimer) return
    this.retryDelay = fixedDelay || Math.min(this.retryDelay ? this.retryDelay * 2 : 1000, 10000)
    this.setState('reconnecting', { reason, inMs: this.retryDelay })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.stopped) this.connect()
    }, this.retryDelay)
  }

  private startStats() {
    this.stopStats()
    this.statsTimer = setInterval(() => this.collectStats(), 1000)
  }

  private stopStats() {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
  }

  private async collectStats() {
    if (!this.pc) return
    let reports: RTCStatsReport
    try {
      reports = await this.pc.getStats()
    } catch {
      return
    }
    const out: WhepStats = { kbps: 0, fps: 0, width: 0, height: 0, packetsLost: 0, jitterMs: 0, codec: null, rttMs: null }
    const codecs = new Map<string, string>()
    reports.forEach((r: any) => {
      if (r.type === 'codec') codecs.set(r.id, r.mimeType)
    })
    reports.forEach((r: any) => {
      if (r.type === 'inbound-rtp' && !r.isRemote) {
        const now = r.timestamp
        const bytes = r.bytesReceived || 0
        if (this.prevAt && now > this.prevAt) {
          out.kbps = Math.max(0, Math.round(((bytes - this.prevBytes) * 8) / (now - this.prevAt)))
        }
        this.prevBytes = bytes
        this.prevAt = now
        out.fps = Math.round(r.framesPerSecond || 0)
        out.width = r.frameWidth || 0
        out.height = r.frameHeight || 0
        out.packetsLost = r.packetsLost || 0
        out.jitterMs = Math.round((r.jitter || 0) * 1000)
        if (r.codecId && codecs.has(r.codecId)) out.codec = codecs.get(r.codecId)!.replace(/^\w+\//, '')
      }
      if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) {
        out.rttMs = Math.round(r.currentRoundTripTime * 1000)
      }
    })
    this.lastStats = out
    this.emit('stats', out)
  }

  private teardownPeer() {
    this.stopStats()
    if (this.sessionUrl) {
      // Best-effort session teardown so MediaMTX releases the reader promptly.
      fetch(this.sessionUrl, { method: 'DELETE', keepalive: true }).catch(() => {})
      this.sessionUrl = null
    }
    if (this.pc) {
      try {
        this.pc.close()
      } catch {
        /* already closed */
      }
      this.pc = null
    }
    this.prevBytes = 0
    this.prevAt = 0
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.teardownPeer()
    this.stream = null
    this.setState('idle')
  }
}
