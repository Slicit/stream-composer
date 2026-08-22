import { useParams } from 'react-router-dom'
import { useChannelState } from '@/hooks/useChannelState'
import { ComposedGrid } from '@/components/ComposedGrid'
import { Card, CardContent } from '@/components/ui/card'

// A channel's own viewer, at /c/:slug — same grid/audio-picking machinery
// as the global ViewerPage, fed by GET /api/channels/:slug/state instead.
// A 404 there (unknown slug, or a private channel this viewer cannot see)
// is deliberately indistinguishable, matching channelstate.Build's own
// opaque-denial posture.
export function ChannelViewerPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { state, notFound, error } = useChannelState(slug)

  if (notFound) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">No such channel.</CardContent>
        </Card>
      </main>
    )
  }

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

  return (
    <main
      className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8"
      style={state.channel?.backgroundImage ? { backgroundImage: `url(${state.channel.backgroundImage})`, backgroundSize: 'cover' } : undefined}
    >
      {state.channel && <h1 className="text-2xl font-semibold tracking-tight">{state.channel.name}</h1>}
      <ComposedGrid state={state} />
    </main>
  )
}
