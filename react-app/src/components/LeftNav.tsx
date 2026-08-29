import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { api } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { useChannelPrefs } from '@/contexts/ChannelPrefsContext'
import { StreamsPanel } from '@/components/StreamsPanel'
import { LiveDot } from '@/components/LiveDot'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { Channel } from '@/api/types'

const LIVE_POLL_MS = 10_000

// The persistent left sidebar: "Channels" (every channel the signed-in
// user can view — public, owned, or shared with them; see
// Api::ChannelsController#accessible, distinct from /channels, the
// owned-only self-service management page) and, below it, "Streams" —
// the favorites/hide list for whichever channel is currently open (fed
// by ChannelViewerPage via ChannelPrefsContext; empty/absent when not
// viewing a channel).
export function LeftNav() {
  const { user } = useAuth()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [liveBySlug, setLiveBySlug] = useState<Record<string, boolean>>({})
  const { slug, onAir, liveByKey, hiddenKeys, spotlightKey, toggleHidden, toggleSpotlight, reset } = useChannelPrefs()

  useEffect(() => {
    if (!user) {
      setChannels(null)
      return
    }
    let cancelled = false
    api
      .get<{ channels: Channel[] }>('/api/channels')
      .then((data) => {
        if (!cancelled) setChannels(data.channels)
      })
      .catch(() => {
        if (!cancelled) setChannels([])
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // Bulk live status for every channel in the list, polled independently
  // of the channel list itself — a transient failure just keeps the last
  // known state rather than flashing every dot to "offline".
  useEffect(() => {
    if (!user) {
      setLiveBySlug({})
      return
    }
    let cancelled = false
    async function poll() {
      try {
        const data = await api.get<Record<string, boolean>>('/api/channels/live')
        if (!cancelled) setLiveBySlug(data)
      } catch {
        /* keep the last known state */
      }
    }
    poll()
    const interval = setInterval(poll, LIVE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [user])

  if (!user) return null

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r bg-nav text-nav-foreground px-3 py-4 sm:flex">
      <div className="flex flex-col gap-1">
        <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channels</h2>
        {channels === null ? (
          <p className="px-2 text-sm text-muted-foreground">Loading…</p>
        ) : channels.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No channels yet.</p>
        ) : (
          channels.map((c) => (
            <NavLink
              key={c.id}
              to={`/c/${c.slug}`}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <LiveDot live={!!liveBySlug[c.slug]} />
              <span className="truncate">{c.name}</span>
            </NavLink>
          ))
        )}
      </div>

      {slug && onAir.length > 0 && (
        <>
          <Separator className="my-4" />
          <StreamsPanel
            onAir={onAir}
            liveByKey={liveByKey}
            hiddenKeys={hiddenKeys}
            onToggleHidden={toggleHidden}
            spotlightKey={spotlightKey}
            onToggleSpotlight={toggleSpotlight}
            onReset={reset}
          />
        </>
      )}

      {user.role === 'admin' && (
        <div className="mt-auto">
          <Separator className="mb-2 mt-4" />
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )
            }
          >
            <ShieldCheck className="h-4 w-4" />
            Admin
          </NavLink>
        </div>
      )}
    </aside>
  )
}
