import { ViewerTile } from '@/components/ViewerTile'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ViewerState } from '@/api/viewerState'

interface ComposedGridProps {
  state: ViewerState
  emptyMessage?: string
}

// The browser-composed grid, shared by the global viewer and a channel's
// viewer — same layout math (from GET /api/state or GET /api/channels/
// :slug/state), same three tile kinds: a live WhepClient tile, a
// playability-problem placeholder, and (channel state only) a restricted
// placeholder for a member the viewer cannot reach.
export function ComposedGrid({ state, emptyMessage = 'Nothing on air. Start streaming and the grid appears here automatically.' }: ComposedGridProps) {
  const onAir = state.onAir.filter((s): s is { key: string; name: string } => s.key !== null)
  const streamsByKey = new Map(state.streams.map((s) => [s.key, s]))

  if (!state.program.ready || !state.layout || onAir.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">{emptyMessage}</CardContent>
      </Card>
    )
  }

  const layout = state.layout

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
      {onAir.map((source, i) => {
        const cell = layout.cells[i]
        if (!cell) return null
        const meta = streamsByKey.get(source.key)
        const cellStyle = {
          left: `${(cell.x / layout.width) * 100}%`,
          top: `${(cell.y / layout.height) * 100}%`,
          width: `${(cell.w / layout.width) * 100}%`,
          height: `${(cell.h / layout.height) * 100}%`,
        }

        if (meta?.restricted) {
          return (
            <div
              key={source.key}
              className="absolute flex flex-col items-center justify-center gap-1 rounded-md bg-black p-2 text-center text-white"
              style={cellStyle}
            >
              <strong className="text-sm">This stream is private</strong>
              <span className="text-xs text-white/70">Please ask for access.</span>
            </div>
          )
        }

        if (meta?.problem) {
          return (
            <div
              key={source.key}
              className="absolute flex flex-col items-center justify-center gap-1 rounded-md bg-black p-2 text-center text-white"
              style={cellStyle}
            >
              <Badge variant="destructive">Cannot play here</Badge>
              <p className="text-xs text-white/80">{meta.problem.summary}</p>
            </div>
          )
        }

        if (!meta?.path) return null

        return <ViewerTile key={source.key} path={meta.path} name={source.name} cell={cell} canvasWidth={layout.width} canvasHeight={layout.height} />
      })}
    </div>
  )
}
