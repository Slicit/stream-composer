import { useEffect, useRef, useState } from 'react'

// Shared polling core for useViewerState and useChannelState — same
// interval the data plane's own reconcile loops run at, so the grid never
// lags meaningfully behind reality. Kept as a plain interval rather than a
// WebSocket — the payload is small and the endpoint is cheap, matching
// the vanilla app's own polling approach.
const POLL_MS = 2000

export function usePolledState<T>(url: string) {
  const [state, setState] = useState<T | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    stoppedRef.current = false
    setState(null)
    setNotFound(false)
    setError(null)

    async function poll() {
      try {
        const res = await fetch(url, { credentials: 'include' })
        if (res.status === 404) {
          if (!stoppedRef.current) {
            setNotFound(true)
            setError(null)
          }
          return
        }
        if (!res.ok) throw new Error(`the server answered ${res.status}`)
        const data = (await res.json()) as T
        if (!stoppedRef.current) {
          setState(data)
          setNotFound(false)
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
  }, [url])

  return { state, notFound, error }
}
