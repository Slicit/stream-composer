import { useEffect, useRef, useState } from 'react'
import type { ViewerState } from '../api/viewerState'

// Polls GET /api/state on the same interval the data plane's own reconcile
// loops run at, so the grid never lags meaningfully behind reality. Kept as
// a plain interval rather than a WebSocket — the payload is small and the
// endpoint is cheap, matching the vanilla app's own polling approach.
const POLL_MS = 2000

export function useViewerState() {
  const [state, setState] = useState<ViewerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    stoppedRef.current = false

    async function poll() {
      try {
        const res = await fetch('/api/state', { credentials: 'include' })
        if (!res.ok) throw new Error(`the server answered ${res.status}`)
        const data = (await res.json()) as ViewerState
        if (!stoppedRef.current) {
          setState(data)
          setError(null)
        }
      } catch (err) {
        if (!stoppedRef.current) setError(err instanceof Error ? err.message : 'Could not load the stream state.')
      } finally {
        if (!stoppedRef.current) timerRef.current = setTimeout(poll, POLL_MS)
      }
    }

    poll()
    return () => {
      stoppedRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { state, error }
}
