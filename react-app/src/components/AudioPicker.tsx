import { useEffect, useRef, useState } from 'react'
import { WhepClient } from '@/lib/whep'
import { Button } from '@/components/ui/button'
import type { ViewerStreamEntry } from '@/api/viewerState'

interface AudioPickerProps {
  streams: ViewerStreamEntry[]
}

// Exactly one source can be audible at a time and nothing is audible by
// default: a wall of simultaneous room audio is unusable, and an
// unexpected noise on page load is worse. Mirrors app.js's selectAudio().
export function AudioPicker({ streams }: AudioPickerProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const clientRef = useRef<WhepClient | null>(null)

  const candidates = streams.filter((s) => s.hasAudio && s.audioPath)

  useEffect(() => {
    // The picked stream may have gone offline or lost its audioPath since
    // selection (a viewer's own access can change between polls too).
    if (activeKey && !candidates.some((s) => s.key === activeKey)) {
      setActiveKey(null)
    }
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
        audioRef.current.play().catch(() => {
          /* autoplay policy — the picker itself is the user gesture, but a stray denial should not crash anything */
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

  if (candidates.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
      <span className="text-sm font-medium">Audio:</span>
      <Button
        size="sm"
        variant="outline"
        className={activeKey === null ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground' : ''}
        onClick={() => setActiveKey(null)}
      >
        Muted
      </Button>
      {candidates.map((s) => (
        <Button
          key={s.key}
          size="sm"
          variant="outline"
          className={activeKey === s.key ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground' : ''}
          onClick={() => setActiveKey(s.key)}
        >
          {s.name}
        </Button>
      ))}
      <audio ref={audioRef} autoPlay className="hidden" />
    </div>
  )
}
