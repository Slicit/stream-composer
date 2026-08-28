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
  // The source's own width/height, once known — needed to work out how
  // much of the cell object-contain actually letterboxes, so the name
  // caption can be pushed up to sit at the bottom of the real, visible
  // picture instead of the cell's own (possibly taller) bottom edge.
  // null until then, treated as "no letterboxing yet".
  const [videoRatio, setVideoRatio] = useState<number | null>(null)

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

  // `loadedmetadata` alone isn't reliable for a live WebRTC source: it can
  // fire before videoWidth/videoHeight are actually populated, silently
  // leaving videoRatio null forever and pinning the caption to the cell's
  // bottom edge instead of the picture's. The video element's own `resize`
  // event is what actually fires once (and whenever) its intrinsic size is
  // known — including if a source's encoder changes resolution mid-stream.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handleResize = () => {
      if (video.videoWidth && video.videoHeight) setVideoRatio(video.videoWidth / video.videoHeight)
    }
    video.addEventListener('resize', handleResize)
    return () => video.removeEventListener('resize', handleResize)
  }, [])

  const style = {
    left: `${(cell.x / canvasWidth) * 100}%`,
    top: `${(cell.y / canvasHeight) * 100}%`,
    width: `${(cell.w / canvasWidth) * 100}%`,
    height: `${(cell.h / canvasHeight) * 100}%`,
  }

  // object-contain must never crop the picture, which means it letterboxes
  // whenever the cell's shape doesn't exactly match the source's own — the
  // "auto" grid (clientLayout.ts) picks cell shapes that minimize this for
  // an assumed ~16:9 source, but a real source can be any ratio, and even
  // a good-fit cell is rarely a pixel-exact match. Work out how much of the
  // cell's height that leaves blank (only possible once the source's real
  // dimensions are known, hence videoRatio), and lift the caption by
  // exactly that much so it still sits right at the bottom of the visible
  // picture instead of the cell's own, possibly-taller, bottom edge.
  const cellAspect = cell.w / cell.h
  const letterboxFraction = videoRatio && videoRatio >= cellAspect ? 1 - cellAspect / videoRatio : 0
  const captionBottom = `calc(${(letterboxFraction / 2) * 100}% + 0.25rem)`

  return (
    <div className="absolute overflow-hidden rounded-md bg-black" style={style}>
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        className="h-full w-full object-contain"
      />
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
      {/* Literal spec values (2vw, 20% down from the original 2.5vw/#1a8900), not design-system tokens — see UI_CONVENTIONS.md.
          Two-part on purpose: the outer div only positions/centers (full
          cell width, so it tracks captionBottom regardless of name
          length); the inner one is the actual badge, sized to its own
          text so the background hugs the name rather than stretching
          edge to edge. */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center px-2" style={{ bottom: captionBottom }}>
        <div
          className="max-w-full truncate"
          style={{
            fontSize: '2vw',
            lineHeight: '2vw',
            color: '#1a8900',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            padding: '2px 10px',
            borderRadius: '4px',
          }}
        >
          {name}
        </div>
      </div>
    </div>
  )
}
