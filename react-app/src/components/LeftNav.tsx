import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Radio } from 'lucide-react'
import { api } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { useChannelPrefs } from '@/contexts/ChannelPrefsContext'
import { StreamsPanel } from '@/components/StreamsPanel'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { Channel } from '@/api/types'

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
  const { slug, onAir, hiddenKeys, spotlightKey, toggleHidden, toggleSpotlight, reset } = useChannelPrefs()

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

  if (!user) return null

  return (
    <aside className="hidden w-56 shrink-0 border-r px-3 py-4 sm:block">
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
              <Radio className="h-3.5 w-3.5 shrink-0" />
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
            hiddenKeys={hiddenKeys}
            onToggleHidden={toggleHidden}
            spotlightKey={spotlightKey}
            onToggleSpotlight={toggleSpotlight}
            onReset={reset}
          />
        </>
      )}
    </aside>
  )
}
