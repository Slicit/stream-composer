import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useChannelState } from '@/hooks/useChannelState'
import { useChannelPrefs } from '@/contexts/ChannelPrefsContext'
import { useAvailableHeight } from '@/hooks/useAvailableHeight'
import { useElementSize } from '@/hooks/useElementSize'
import { ComposedGrid } from '@/components/ComposedGrid'
import { LiveDot } from '@/components/LiveDot'
import { Card, CardContent } from '@/components/ui/card'

// Must match the stage's own gap-3 (0.75rem) below — the budget handed
// to ComposedGrid needs to account for the gap between it and the title
// block, not just the title block's own height.
const STAGE_GAP_PX = 12
const MIN_GRID_HEIGHT_PX = 120

// A channel's own viewer, at /c/:slug — same grid/audio-picking machinery
// as the global ViewerPage, fed by GET /api/channels/:slug/state instead.
// A 404 there (unknown slug, or a private channel this viewer cannot see)
// is deliberately indistinguishable, matching channelstate.Build's own
// opaque-denial posture.
//
// The "Streams" (favorites) section lives in the left nav, not on this
// page — see ChannelPrefsContext, which this page feeds every poll tick
// and clears on unmount, and LeftNav, which renders it. Favoriting/
// hiding a source is per-viewer only: it never reaches the server and
// recomposes ComposedGrid's layout locally. The background image works
// the same way: this page only ever reports it into context, App.tsx's
// <main> is what actually paints it, since that's the element it needs
// to cover.
//
// layoutMode === 'maximize': the grid sizes itself to what the videos
// actually need (ComposedGrid's own `fill`/`naturalFillHeight` — see
// that component), not stretched to fill the page — this page's only
// job is handing it a height *budget* to stay within: the viewport space
// actually available below it (useAvailableHeight) minus the title
// block's own real, measured height, so the grid can never grow large
// enough to push the title/description off-screen. 'fixed' (the
// default) is unchanged: a 16:9-locked canvas that scales with width.
export function ChannelViewerPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { state, notFound, error } = useChannelState(slug)
  const { hiddenKeys, spotlightKey, setChannelStreams, clearChannel } = useChannelPrefs()
  const stageRef = useRef<HTMLDivElement>(null)

  const maximize = state?.channel?.layoutMode === 'maximize'
  const availableHeight = useAvailableHeight(stageRef, maximize)
  const [setTitleRef, titleSize] = useElementSize<HTMLDivElement>(maximize)
  const maxGridHeight = availableHeight != null ? Math.max(availableHeight - (titleSize?.height ?? 0) - STAGE_GAP_PX, MIN_GRID_HEIGHT_PX) : undefined

  useEffect(() => {
    if (!state) return
    const liveByKey: Record<string, boolean> = {}
    for (const s of state.streams) liveByKey[s.key] = s.live
    setChannelStreams(slug, state.channel?.name ?? slug, state.onAir, liveByKey, state.channel?.backgroundImage || null)
  }, [slug, state, setChannelStreams])

  useEffect(() => {
    return () => clearChannel()
  }, [clearChannel])

  if (notFound) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">No such channel.</CardContent>
      </Card>
    )
  }

  if (error && !state) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-destructive">{error}</CardContent>
      </Card>
    )
  }

  if (!state) {
    return <p className="text-center text-muted-foreground">Loading…</p>
  }

  return (
    <div ref={stageRef} className="flex w-full flex-col gap-3">
      <ComposedGrid state={state} hiddenKeys={hiddenKeys} spotlightKey={spotlightKey} fill={maximize} maxHeight={maximize ? maxGridHeight : undefined} />
      {state.channel && (
        <div ref={setTitleRef} className="flex flex-col gap-1">
          {state.channel.description && <p className="text-lg font-medium">{state.channel.description}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-2 font-medium text-foreground">
              <LiveDot live={state.streams.some((s) => s.live)} className="h-2.5 w-2.5" />
              {state.channel.name}
            </span>
            {state.channel.featuredGame && <span>Playing {state.channel.featuredGame}</span>}
            {state.channel.currentTopic && <span>{state.channel.currentTopic}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
