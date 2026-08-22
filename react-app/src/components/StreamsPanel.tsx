import { Eye, EyeOff, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OnAirEntry } from '@/api/viewerState'

interface StreamsPanelProps {
  onAir: OnAirEntry[]
  hiddenKeys: Set<string>
  onToggleHidden: (key: string) => void
  spotlightKey: string | null
  onToggleSpotlight: (key: string) => void
}

// The channel page's secondary "Streams" section: every currently
// on-air source, with per-viewer controls that recompose the grid
// locally (ComposedGrid's hiddenKeys/spotlightKey props) — nothing here
// is sent to the server or visible to anyone else watching.
export function StreamsPanel({ onAir, hiddenKeys, onToggleHidden, spotlightKey, onToggleSpotlight }: StreamsPanelProps) {
  const entries = onAir.filter((s): s is { key: string; name: string } => s.key !== null)

  if (entries.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Streams</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {entries.map((s) => {
          const hidden = hiddenKeys.has(s.key)
          const spotlighted = spotlightKey === s.key
          return (
            <div key={s.key} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
              <span className={hidden ? 'truncate text-sm text-muted-foreground line-through' : 'truncate text-sm'}>{s.name}</span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={spotlighted ? 'border-primary bg-primary/20 text-primary' : ''}
                  onClick={() => onToggleSpotlight(s.key)}
                  title={spotlighted ? 'Un-highlight' : 'Highlight'}
                >
                  <Star className="h-4 w-4" fill={spotlighted ? 'currentColor' : 'none'} />
                  <span className="sr-only">{spotlighted ? 'Un-highlight' : 'Highlight'}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => onToggleHidden(s.key)}
                  title={hidden ? 'Show' : 'Hide'}
                >
                  {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  <span className="sr-only">{hidden ? 'Show' : 'Hide'}</span>
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
