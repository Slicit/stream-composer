import { usePolledState } from './usePolledState'
import type { ViewerState } from '../api/viewerState'

// notFound reflects a real 404 from GET /api/channels/:slug/state — an
// unknown slug and a private channel the caller cannot see are
// indistinguishable on purpose (channelstate.Build's own "found" gate).
export function useChannelState(slug: string) {
  const { state, notFound, error } = usePolledState<ViewerState>(`/api/channels/${encodeURIComponent(slug)}/state`)
  return { state, notFound, error }
}
