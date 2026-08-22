import { useEffect, useRef, useState, type RefObject } from 'react'
import { BarChart2, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { WhepClient } from '@/lib/whep'
import type { ViewerStreamEntry } from '@/api/viewerState'

interface PlayerOverlayProps {
  containerRef: RefObject<HTMLDivElement | null>
  streams: ViewerStreamEntry[]
  paused: boolean
  onTogglePause: () => void
  showStats: boolean
  onToggleStats: () => void
  sourceCount: number
  fps: number
  kbps: number
}

// This bar deliberately does not use the app's shadcn Button/Badge styling
// (solid surfaces on an opaque background) — it sits on top of arbitrary
// video content, so it needs a translucent, blurred surface with its own
// contrast rules instead, matching the pre-migration app's player overlay
// (server/public/assets/style.css's .player-overlay/.audio-chip). This is
// the one place in the app that intentionally steps outside the design
// system; see react-app/UI_CONVENTIONS.md.
export function PlayerOverlay({
  containerRef,
  streams,
  paused,
  onTogglePause,
  showStats,
  onToggleStats,
  sourceCount,
  fps,
  kbps,
}: PlayerOverlayProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [muted, setMuted] = useState(true)
  const [volume, setVolume] = useState(80)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const clientRef = useRef<WhepClient | null>(null)

  const candidates = streams.filter((s) => s.hasAudio && s.audioPath)

  useEffect(() => {
    if (activeKey && !candidates.some((s) => s.key === activeKey)) setActiveKey(null)
  }, [activeKey, candidates])

  useEffect(() => {
    if (clientRef.current) {
      clientRef.current.stop()
      clientRef.current = null
    }
    if (audioRef.current) audioRef.current.srcObject = null

    if (!activeKey) return
    const stream = candidates.find((s) => s.key === activeKey)
    if (!stream || !stream.audioPath) return

    const client = new WhepClient(`/mtx/webrtc/${stream.audioPath}/whep`, { video: false, audio: true })
    clientRef.current = client
    const offTrack = client.onTrack(() => {
      if (audioRef.current) {
        audioRef.current.srcObject = client.stream
        audioRef.current.play()?.catch(() => {
          /* autoplay policy — picking a chip is itself the user gesture, but a stray denial should not crash anything */
        })
      }
    })
    client.start()

    return () => {
      offTrack()
      client.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100
  }, [volume])

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted
  }, [muted])

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [containerRef])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      containerRef.current?.requestFullscreen().catch(() => {})
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 py-2.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/20"
        onClick={onTogglePause}
        title={paused ? 'Play' : 'Pause'}
      >
        {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        <span className="sr-only">{paused ? 'Play' : 'Pause'}</span>
      </button>

      <button
        type="button"
        className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border text-white transition-colors ${
          showStats ? 'border-primary bg-primary/25' : 'border-white/10 bg-white/10 hover:bg-white/20'
        }`}
        onClick={onToggleStats}
        title="Show connection statistics"
      >
        <BarChart2 className="h-4 w-4" />
        <span className="sr-only">Show connection statistics</span>
      </button>

      {candidates.length > 0 && (
        <div className="flex max-w-[32vw] items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          <button
            type="button"
            className={`flex h-[34px] shrink-0 items-center rounded-full border px-2.5 text-xs transition-colors ${
              activeKey === null ? 'border-primary bg-primary/20 text-white' : 'border-white/10 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
            }`}
            onClick={() => setActiveKey(null)}
          >
            Muted
          </button>
          {candidates.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`flex h-[34px] shrink-0 items-center rounded-full border px-2.5 text-xs transition-colors ${
                activeKey === s.key ? 'border-primary bg-primary/20 text-white' : 'border-white/10 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
              }`}
              onClick={() => setActiveKey(s.key)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <span className="flex-1" />

      <span className="hidden font-mono text-xs text-white/60 sm:inline">
        {sourceCount} source{sourceCount === 1 ? '' : 's'} · {fps} fps · {kbps} kb/s
      </span>

      <button
        type="button"
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/20"
        onClick={() => setMuted((m) => !m)}
        title={muted ? 'Unmute the audio monitor' : 'Mute the audio monitor'}
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        <span className="sr-only">{muted ? 'Unmute' : 'Mute'} the audio monitor</span>
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="h-1 w-[5.5rem] shrink-0 accent-primary"
        title="Audio monitor volume"
        aria-label="Audio monitor volume"
      />

      <button
        type="button"
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/20"
        onClick={toggleFullscreen}
        title="Full screen"
      >
        {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        <span className="sr-only">Full screen</span>
      </button>

      <audio ref={audioRef} autoPlay className="hidden" />
    </div>
  )
}
