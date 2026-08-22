import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useChannelState } from '@/hooks/useChannelState'
import { useChannelPrefs } from '@/contexts/ChannelPrefsContext'
import { ComposedGrid } from '@/components/ComposedGrid'
import { LiveDot } from '@/components/LiveDot'
import { Card, CardContent } from '@/components/ui/card'

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
// recomposes ComposedGrid's layout locally.
export function ChannelViewerPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { state, notFound, error } = useChannelState(slug)
  const { hiddenKeys, spotlightKey, setChannelStreams, clearChannel } = useChannelPrefs()

  useEffect(() => {
    if (!state) return
    const liveByKey: Record<string, boolean> = {}
    for (const s of state.streams) liveByKey[s.key] = s.live
    setChannelStreams(slug, state.channel?.name ?? slug, state.onAir, liveByKey)
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
    <div
      className="flex w-full flex-col gap-4"
      style={state.channel?.backgroundImage ? { backgroundImage: `url(${state.channel.backgroundImage})`, backgroundSize: 'cover' } : undefined}
    >
      {state.channel && (
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <LiveDot live={state.streams.some((s) => s.live)} className="h-2.5 w-2.5" />
          {state.channel.name}
        </h1>
      )}
      <ComposedGrid state={state} hiddenKeys={hiddenKeys} spotlightKey={spotlightKey} />
    </div>
  )
}
