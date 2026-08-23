import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { OnAirEntry } from '@/api/viewerState'

interface ChannelPrefsState {
  slug: string | null
  channelName: string | null
  onAir: OnAirEntry[]
  // Per-stream live status (ViewerStreamEntry.live), keyed the same as
  // onAir — lets the left nav's Streams rows show a live dot without
  // threading the full ViewerState through.
  liveByKey: Record<string, boolean>
  hiddenKeys: Set<string>
  spotlightKey: string | null
  // The current channel's background image, or null — read by App.tsx's
  // <main> (a sibling of ChannelViewerPage, same reason onAir/liveByKey
  // live here rather than as page-local state) so the background covers
  // the actual content area, not just whatever box the page itself draws.
  backgroundImage: string | null
  // ChannelViewerPage calls this every poll tick with whatever channel
  // it's currently showing — this is the only way the left nav's
  // "Streams" section (which lives outside that page, as a sibling in
  // App.tsx) learns what's on air.
  setChannelStreams: (
    slug: string,
    channelName: string,
    onAir: OnAirEntry[],
    liveByKey: Record<string, boolean>,
    backgroundImage: string | null,
  ) => void
  // Called when ChannelViewerPage unmounts (navigating away from /c/:slug
  // entirely) so the left nav's Streams section disappears rather than
  // showing a stale channel's list.
  clearChannel: () => void
  toggleHidden: (key: string) => void
  toggleSpotlight: (key: string) => void
  // "Reset preferences": un-favorite everything and show every stream —
  // clears both the in-memory state and this channel's localStorage entry.
  reset: () => void
}

const ChannelPrefsContext = createContext<ChannelPrefsState | null>(null)

function storageKey(slug: string) {
  return `sc:channel:${slug}:hidden`
}

function loadHidden(slug: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(slug))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveHidden(slug: string, hidden: Set<string>) {
  try {
    localStorage.setItem(storageKey(slug), JSON.stringify([...hidden]))
  } catch {
    /* storage unavailable (private browsing, quota) — the toggle still works this session */
  }
}

export function ChannelPrefsProvider({ children }: { children: ReactNode }) {
  const [slug, setSlug] = useState<string | null>(null)
  const [channelName, setChannelName] = useState<string | null>(null)
  const [onAir, setOnAir] = useState<OnAirEntry[]>([])
  const [liveByKey, setLiveByKey] = useState<Record<string, boolean>>({})
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set())
  const [spotlightKey, setSpotlightKey] = useState<string | null>(null)
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null)

  const setChannelStreams = useCallback(
    (
      nextSlug: string,
      nextName: string,
      nextOnAir: OnAirEntry[],
      nextLiveByKey: Record<string, boolean>,
      nextBackgroundImage: string | null,
    ) => {
      setSlug((prevSlug) => {
        if (prevSlug !== nextSlug) {
          setHiddenKeys(loadHidden(nextSlug))
          setSpotlightKey(null)
        }
        return nextSlug
      })
      setChannelName(nextName)
      setOnAir(nextOnAir)
      setLiveByKey(nextLiveByKey)
      setBackgroundImage(nextBackgroundImage)
    },
    [],
  )

  const clearChannel = useCallback(() => {
    setSlug(null)
    setChannelName(null)
    setOnAir([])
    setLiveByKey({})
    setHiddenKeys(new Set())
    setSpotlightKey(null)
    setBackgroundImage(null)
  }, [])

  const toggleHidden = useCallback(
    (key: string) => {
      setHiddenKeys((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        if (slug) saveHidden(slug, next)
        return next
      })
    },
    [slug],
  )

  const toggleSpotlight = useCallback((key: string) => {
    setSpotlightKey((prev) => (prev === key ? null : key))
  }, [])

  const reset = useCallback(() => {
    setHiddenKeys(new Set())
    setSpotlightKey(null)
    if (slug) saveHidden(slug, new Set())
  }, [slug])

  const value = useMemo<ChannelPrefsState>(
    () => ({
      slug,
      channelName,
      onAir,
      liveByKey,
      hiddenKeys,
      spotlightKey,
      backgroundImage,
      setChannelStreams,
      clearChannel,
      toggleHidden,
      toggleSpotlight,
      reset,
    }),
    [slug, channelName, onAir, liveByKey, hiddenKeys, spotlightKey, backgroundImage, setChannelStreams, clearChannel, toggleHidden, toggleSpotlight, reset],
  )

  return <ChannelPrefsContext.Provider value={value}>{children}</ChannelPrefsContext.Provider>
}

export function useChannelPrefs(): ChannelPrefsState {
  const ctx = useContext(ChannelPrefsContext)
  if (!ctx) throw new Error('useChannelPrefs must be used within a ChannelPrefsProvider')
  return ctx
}
