import { usePolledState } from './usePolledState'
import type { ViewerState } from '../api/viewerState'

export function useViewerState() {
  const { state, error } = usePolledState<ViewerState>('/api/state')
  return { state, error }
}
