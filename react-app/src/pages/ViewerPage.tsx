import { Navigate } from 'react-router-dom'
import { useViewerState } from '@/hooks/useViewerState'
import { ComposedGrid } from '@/components/ComposedGrid'
import { Card, CardContent } from '@/components/ui/card'

// The browser-composed grid: GET /api/state drives which sources are on
// air and where they go, and one WhepClient per tile opens the actual
// media session. Mirrors server/public/assets/app.js's startWebGrid(),
// minus the HLS-fallback path for sources with a playability problem
// (flagged below). The play/pause, stats, audio-picker, and fullscreen
// controls live in ComposedGrid's PlayerOverlay.
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
      <Card>
        <CardContent className="pt-6 text-center text-destructive">{error}</CardContent>
      </Card>
    )
  }

  if (!state) {
    return <p className="text-center text-muted-foreground">Loading…</p>
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <ComposedGrid state={state} />
    </div>
  )
}
