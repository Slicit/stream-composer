import { useEffect, useRef, useState } from 'react'
import { WhepClient, type WhepState, type WhepStats } from '@/lib/whep'

interface ViewerTileProps {
  path: string // e.g. s/<playbackId>
  name: string
  cell: { x: number; y: number; w: number; h: number }
  canvasWidth: number
  canvasHeight: number
  paused?: boolean
  showStats?: boolean
  onStats?: (stats: WhepStats) => void
}

// One on-air source, one WHEP session, one absolutely-positioned cell —
// percentages of the composed canvas so the grid scales with the player
// and stays identical to the encoded arrangement at any size, mirroring
// server/public/assets/app.js's startWebGrid().
export function ViewerTile({ path, name, cell, canvasWidth, canvasHeight, paused = false, showStats = false, onStats }: ViewerTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<WhepState>('connecting')
  const [message, setMessage] = useState<string | null>(null)
  const [stats, setStats] = useState<WhepStats | null>(null)

  useEffect(() => {
    const client = new WhepClient(`/mtx/webrtc/${path}/whep`, { video: true, audio: false })
    const offState = client.onState((detail) => {
      setState(detail.state)
      setMessage(detail.message ?? null)
    })
    const offTrack = client.onTrack(() => {
      if (videoRef.current) {
        videoRef.current.srcObject = client.stream
        videoRef.current.play()?.catch(() => {
          /* autoplay policy — the muted attribute below should satisfy it */
        })
      }
    })
    const offStats = client.onStats((detail) => {
      setStats(detail)
      onStats?.(detail)
    })
    client.start()

    return () => {
      offState()
      offTrack()
      offStats()
      client.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (paused) video.pause()
    else video.play()?.catch(() => {})
  }, [paused])

  const style = {
    left: `${(cell.x / canvasWidth) * 100}%`,
    top: `${(cell.y / canvasHeight) * 100}%`,
    width: `${(cell.w / canvasWidth) * 100}%`,
    height: `${(cell.h / canvasHeight) * 100}%`,
  }

  return (
    <div className="absolute overflow-hidden rounded-md bg-black" style={style}>
      <video ref={videoRef} playsInline autoPlay muted className="h-full w-full object-contain" />
      {state !== 'playing' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-2 text-center text-xs text-white/80">
          {state === 'offline' ? 'Not on air' : state === 'error' ? message || 'Playback error' : 'Connecting…'}
        </div>
      )}
      {showStats && stats && (
        <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/70 px-1.5 py-1 font-mono text-[10px] leading-tight text-white/80">
          {stats.width}×{stats.height} · {stats.fps}fps · {stats.kbps}kb/s
        </div>
      )}
      {/* Literal spec values (2.5vw/#1a8900), not design-system tokens — see UI_CONVENTIONS.md. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-1 truncate px-2 text-center"
        style={{ fontSize: '2.5vw', lineHeight: '2.5vw', color: '#1a8900', fontWeight: 'bold' }}
      >
        {name}
      </div>
    </div>
  )
}
