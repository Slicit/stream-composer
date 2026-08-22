import { useEffect, useRef, useState } from 'react'
import { WhepClient, type WhepState } from '@/lib/whep'

interface ViewerTileProps {
  path: string // e.g. s/<playbackId>
  name: string
  cell: { x: number; y: number; w: number; h: number }
  canvasWidth: number
  canvasHeight: number
}

// One on-air source, one WHEP session, one absolutely-positioned cell —
// percentages of the composed canvas so the grid scales with the player
// and stays identical to the encoded arrangement at any size, mirroring
// server/public/assets/app.js's startWebGrid().
export function ViewerTile({ path, name, cell, canvasWidth, canvasHeight }: ViewerTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<WhepState>('connecting')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const client = new WhepClient(`/mtx/webrtc/${path}/whep`, { video: true, audio: false })
    const offState = client.onState((detail) => {
      setState(detail.state)
      setMessage(detail.message ?? null)
    })
    const offTrack = client.onTrack(() => {
      if (videoRef.current) {
        videoRef.current.srcObject = client.stream
        videoRef.current.play().catch(() => {
          /* autoplay policy — the muted attribute below should satisfy it */
        })
      }
    })
    client.start()

    return () => {
      offState()
      offTrack()
      client.stop()
    }
  }, [path])

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
      <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">{name}</div>
    </div>
  )
}
