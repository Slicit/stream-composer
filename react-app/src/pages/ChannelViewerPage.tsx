import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useChannelState } from '@/hooks/useChannelState'
import { ComposedGrid } from '@/components/ComposedGrid'
import { StreamsPanel } from '@/components/StreamsPanel'
import { Card, CardContent } from '@/components/ui/card'

function storageKey(slug: string) {
  return `sc:channel:${slug}:hidden`
}

// A channel's own viewer, at /c/:slug — same grid/audio-picking machinery
// as the global ViewerPage, fed by GET /api/channels/:slug/state instead.
// A 404 there (unknown slug, or a private channel this viewer cannot see)
// is deliberately indistinguishable, matching channelstate.Build's own
// opaque-denial posture.
//
// The "Streams" panel below the grid is per-viewer only: hiding a source
// or picking one to highlight never reaches the server (nobody else
// watching sees your choices) and recomposes ComposedGrid's layout
// locally. Hidden streams persist in localStorage per channel slug so
// they survive a refresh; the highlight does not — it's a momentary
// "look at this one" toggle, not a saved preference.
export function ChannelViewerPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { state, notFound, error } = useChannelState(slug)
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set())
  const [spotlightKey, setSpotlightKey] = useState<string | null>(null)

  useEffect(() => {
    setSpotlightKey(null)
    try {
      const raw = localStorage.getItem(storageKey(slug))
      setHiddenKeys(new Set(raw ? (JSON.parse(raw) as string[]) : []))
    } catch {
      setHiddenKeys(new Set())
    }
  }, [slug])

  function toggleHidden(key: string) {
    setHiddenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(storageKey(slug), JSON.stringify([...next]))
      } catch {
        /* storage unavailable (private browsing, quota) — the toggle still works this session */
      }
      return next
    })
  }

  function toggleSpotlight(key: string) {
    setSpotlightKey((prev) => (prev === key ? null : key))
  }

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
      {state.channel && <h1 className="text-2xl font-semibold tracking-tight">{state.channel.name}</h1>}
      <ComposedGrid state={state} hiddenKeys={hiddenKeys} spotlightKey={spotlightKey} />
      <StreamsPanel
        onAir={state.onAir}
        hiddenKeys={hiddenKeys}
        onToggleHidden={toggleHidden}
        spotlightKey={spotlightKey}
        onToggleSpotlight={toggleSpotlight}
      />
    </div>
  )
}
