import { useMemo, useRef, useState } from 'react'
import { ViewerTile } from '@/components/ViewerTile'
import { PlayerOverlay } from '@/components/PlayerOverlay'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useElementSize } from '@/hooks/useElementSize'
import { computeClientLayout, naturalFillHeight } from '@/lib/clientLayout'
import type { ViewerState } from '@/api/viewerState'
import type { WhepStats } from '@/lib/whep'

interface ComposedGridProps {
  state: ViewerState
  emptyMessage?: string
  // Per-viewer overrides (the channel page's "Streams" panel drives
  // these) — hiding a source or picking a spotlight is never sent to the
  // server, so the grid recomposes locally instead of waiting on the
  // next poll. Both default to "no override", identical to the plain
  // global viewer.
  hiddenKeys?: Set<string>
  spotlightKey?: string | null
  // "maximize" layout mode: pack tiles at whatever width this component
  // actually renders at (measured), sized only as tall as the videos
  // themselves need (naturalFillHeight) rather than stretched to fill
  // available space — capped at `maxHeight` (the caller's own budget, so
  // it never grows past whatever the caller needs to keep visible below
  // it, e.g. a channel's title/description). Undefined/0 falls back to
  // the fixed 1920x1080 canvas's own height.
  fill?: boolean
  maxHeight?: number
}

// The browser-composed grid, shared by the global viewer and a channel's
// viewer — same source list (from GET /api/state or GET /api/channels/
// :slug/state), same three tile kinds: a live WhepClient tile, a
// playability-problem placeholder, and (channel state only) a restricted
// placeholder for a member the viewer cannot reach. Cell positions are
// computed entirely client-side (lib/clientLayout.ts, ported from
// go-service/internal/layout) rather than taken from the server's own
// layout.cells, so hiding a source or picking a spotlight recomposes the
// grid immediately with no round trip. The bottom PlayerOverlay (play/
// pause, stats, audio picker, fullscreen) mirrors the pre-migration
// app's .player-overlay — see PlayerOverlay.tsx for why it's styled
// outside the shadcn design system.
export function ComposedGrid({
  state,
  emptyMessage = 'Nothing on air. Start streaming and the grid appears here automatically.',
  hiddenKeys,
  spotlightKey = null,
  fill = false,
  maxHeight,
}: ComposedGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [setSizeRef, measured] = useElementSize<HTMLDivElement>(fill)
  const [paused, setPaused] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [statsByKey, setStatsByKey] = useState<Record<string, WhepStats>>({})

  const onAirAll = state.onAir.filter((s): s is { key: string; name: string } => s.key !== null)
  const onAir = hiddenKeys ? onAirAll.filter((s) => !hiddenKeys.has(s.key)) : onAirAll
  const streamsByKey = new Map(state.streams.map((s) => [s.key, s]))

  const aggregate = useMemo(() => {
    const values = Object.values(statsByKey)
    return {
      sources: values.length,
      fps: values.length ? Math.round(values.reduce((sum, s) => sum + s.fps, 0) / values.length) : 0,
      kbps: Math.round(values.reduce((sum, s) => sum + s.kbps, 0)),
    }
  }, [statsByKey])

  if (!state.program.ready || !state.layout || onAir.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">{emptyMessage}</CardContent>
      </Card>
    )
  }

  const layout = state.layout
  const spotlightIndex = spotlightKey ? onAir.findIndex((s) => s.key === spotlightKey) : -1
  const hasSpotlight = spotlightIndex >= 0
  // "fixed" packs into the server's 1920x1080-ish canvas; "maximize"
  // packs at this component's own real (measured) width, falling back to
  // the fixed canvas width for the one frame before that measurement
  // lands. Height only shrinks to fit content for a plain "auto" grid —
  // a spotlight's main+side-stack shape doesn't reduce to a single cell
  // aspect ratio, so it keeps the old "stretch to the given budget"
  // behaviour (see naturalFillHeight's own doc comment).
  const canvasWidth = fill ? measured?.width || layout.width : layout.width
  const fillBudget = maxHeight || layout.height
  const canvasHeight = fill ? (hasSpotlight ? fillBudget : naturalFillHeight(onAir.length, canvasWidth, fillBudget, state.program.gapPx)) : layout.height
  const cells = computeClientLayout(onAir.length, { width: canvasWidth, height: canvasHeight, gap: state.program.gapPx }, hasSpotlight ? spotlightIndex : null)

  return (
    <div
      ref={(node) => {
        containerRef.current = node
        setSizeRef(node)
      }}
      className="group relative w-full overflow-hidden rounded-lg border bg-black"
      style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
    >
      {onAir.map((source, i) => {
        const cell = cells[i]
        if (!cell) return null
        const meta = streamsByKey.get(source.key)
        const cellStyle = {
          left: `${(cell.x / canvasWidth) * 100}%`,
          top: `${(cell.y / canvasHeight) * 100}%`,
          width: `${(cell.w / canvasWidth) * 100}%`,
          height: `${(cell.h / canvasHeight) * 100}%`,
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

        return (
          <ViewerTile
            key={source.key}
            path={meta.path}
            name={source.name}
            cell={cell}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            paused={paused}
            showStats={showStats}
            onStats={(stats) => setStatsByKey((prev) => ({ ...prev, [source.key]: stats }))}
          />
        )
      })}
      <PlayerOverlay
        containerRef={containerRef}
        streams={state.streams}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        showStats={showStats}
        onToggleStats={() => setShowStats((s) => !s)}
        sourceCount={aggregate.sources}
        fps={aggregate.fps}
        kbps={aggregate.kbps}
      />
    </div>
  )
}
