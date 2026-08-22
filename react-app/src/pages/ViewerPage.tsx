import { useViewerState } from '@/hooks/useViewerState'
import { ViewerTile } from '@/components/ViewerTile'
import { AudioPicker } from '@/components/AudioPicker'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// The browser-composed grid: GET /api/state drives which sources are on
// air and where they go, and one WhepClient per tile opens the actual
// media session. Mirrors server/public/assets/app.js's startWebGrid(),
// minus the HLS-fallback path for sources with a playability problem
// (flagged below) and the per-tile stats overlay — both left for a later
// pass rather than half-built here.
export function ViewerPage() {
  const { state, error } = useViewerState()

  if (error && !state) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <Card>
          <CardContent className="pt-6 text-center text-destructive">{error}</CardContent>
        </Card>
      </main>
    )
  }

  if (!state) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <p className="text-center text-muted-foreground">Loading…</p>
      </main>
    )
  }

  const onAir = state.onAir.filter((s): s is { key: string; name: string } => s.key !== null)
  const streamsByKey = new Map(state.streams.map((s) => [s.key, s]))

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8">
      {!state.program.ready || !state.layout || onAir.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Nothing on air. Start streaming and the grid appears here automatically.
          </CardContent>
        </Card>
      ) : (
        <div
          className="relative w-full overflow-hidden rounded-lg bg-black"
          style={{ aspectRatio: `${state.layout.width} / ${state.layout.height}` }}
        >
          {onAir.map((source, i) => {
            const cell = state.layout!.cells[i]
            if (!cell) return null
            const meta = streamsByKey.get(source.key)

            if (meta?.problem) {
              return (
                <div
                  key={source.key}
                  className="absolute flex flex-col items-center justify-center gap-1 rounded-md bg-black p-2 text-center text-white"
                  style={{
                    left: `${(cell.x / state.layout!.width) * 100}%`,
                    top: `${(cell.y / state.layout!.height) * 100}%`,
                    width: `${(cell.w / state.layout!.width) * 100}%`,
                    height: `${(cell.h / state.layout!.height) * 100}%`,
                  }}
                >
                  <Badge variant="destructive">Cannot play here</Badge>
                  <p className="text-xs text-white/80">{meta.problem.summary}</p>
                </div>
              )
            }

            if (!meta?.path) return null

            return (
              <ViewerTile
                key={source.key}
                path={meta.path}
                name={source.name}
                cell={cell}
                canvasWidth={state.layout!.width}
                canvasHeight={state.layout!.height}
              />
            )
          })}
        </div>
      )}

      <AudioPicker streams={state.streams} />
    </main>
  )
}
