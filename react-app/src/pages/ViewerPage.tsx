import { Navigate } from 'react-router-dom'
import { useViewerState } from '@/hooks/useViewerState'
import { ComposedGrid } from '@/components/ComposedGrid'
import { AudioPicker } from '@/components/AudioPicker'
import { Card, CardContent } from '@/components/ui/card'

// The browser-composed grid: GET /api/state drives which sources are on
// air and where they go, and one WhepClient per tile opens the actual
// media session. Mirrors server/public/assets/app.js's startWebGrid(),
// minus the HLS-fallback path for sources with a playability problem
// (flagged below) and the per-tile stats overlay — both left for a later
// pass rather than half-built here.
export function ViewerPage() {
  const { state, error } = useViewerState()

  // "/" redirects to the configured homepage channel, same as the
  // vanilla app's index.js — reusing the global state's own settings
  // rather than a second request, since GET /api/state already carries
  // homepageChannelSlug for exactly this.
  if (state?.settings.homepageChannelSlug) {
    return <Navigate to={`/c/${state.settings.homepageChannelSlug}`} replace />
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
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8">
      <ComposedGrid state={state} />
      <AudioPicker streams={state.streams} />
    </main>
  )
}
