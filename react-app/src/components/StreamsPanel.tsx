import { Eye, EyeOff, RotateCcw, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LiveDot } from '@/components/LiveDot'
import type { OnAirEntry } from '@/api/viewerState'

interface StreamsPanelProps {
  onAir: OnAirEntry[]
  liveByKey: Record<string, boolean>
  hiddenKeys: Set<string>
  onToggleHidden: (key: string) => void
  spotlightKey: string | null
  onToggleSpotlight: (key: string) => void
  onReset: () => void
}

// The left nav's "Streams" (favorites) section, directly below Channels
// — every currently on-air source in the channel being viewed, with
// per-viewer controls that recompose the grid locally (ComposedGrid's
// hiddenKeys/spotlightKey props). Nothing here is sent to the server or
// visible to anyone else watching. "Reset preferences" un-favorites
// everything and shows every stream again.
export function StreamsPanel({ onAir, liveByKey, hiddenKeys, onToggleHidden, spotlightKey, onToggleSpotlight, onReset }: StreamsPanelProps) {
  const entries = onAir.filter((s): s is { key: string; name: string } => s.key !== null)

  if (entries.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Streams</h2>
      {entries.map((s) => {
        const hidden = hiddenKeys.has(s.key)
        const favorited = spotlightKey === s.key
        return (
          <div key={s.key} className="flex items-center justify-between gap-1 rounded-md px-2 py-1 hover:bg-accent">
            <span className="flex min-w-0 items-center gap-1.5">
              <LiveDot live={!!liveByKey[s.key]} />
              <span className={hidden ? 'truncate text-sm text-muted-foreground line-through' : 'truncate text-sm'}>{s.name}</span>
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={`h-7 w-7 ${favorited ? 'border-primary bg-primary/20 text-primary' : ''}`}
                onClick={() => onToggleSpotlight(s.key)}
                title={favorited ? 'Unfavorite' : 'Favorite'}
              >
                <Star className="h-3.5 w-3.5" fill={favorited ? 'currentColor' : 'none'} />
                <span className="sr-only">{favorited ? 'Unfavorite' : 'Favorite'}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => onToggleHidden(s.key)}
                title={hidden ? 'Show' : 'Hide'}
              >
                {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                <span className="sr-only">{hidden ? 'Show' : 'Hide'}</span>
              </Button>
            </div>
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" className="mt-1 justify-start gap-2" onClick={onReset}>
        <RotateCcw className="h-3.5 w-3.5" />
        Reset preferences
      </Button>
    </div>
  )
}
