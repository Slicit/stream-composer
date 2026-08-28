import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/api/client'
import type { AvailableStream, Channel, Game } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { ChannelEditForm } from '@/components/ChannelEditForm'
import { ChannelCompositionSection } from '@/components/ChannelCompositionSection'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// The self-service full edit page for one of the signed-in user's own
// channels — /channels/:id. Shares ChannelEditForm with the admin
// equivalent (AdminChannelEditPage) so both offer the same capabilities;
// this wrapper only supplies the /api/channels/mine/* data and endpoints.
export function ChannelEditPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canUseCompositor = user?.role === 'admin' || (user?.compositorQuota ?? 0) > 0
  const [channel, setChannel] = useState<Channel | null>(null)
  const [streams, setStreams] = useState<AvailableStream[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  async function load() {
    try {
      const [channelData, streamsData, gamesData] = await Promise.all([
        api.get<{ channel: Channel }>(`/api/channels/mine/${id}`),
        api.get<{ streams: AvailableStream[] }>('/api/streams/available'),
        api.get<{ games: Game[] }>('/api/games'),
      ])
      setChannel(channelData.channel)
      setStreams(streamsData.streams)
      setGames(gamesData.games)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this channel.')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function update(patch: Record<string, unknown>) {
    setError(null)
    try {
      const data = await api.patch<{ channel: Channel }>(`/api/channels/mine/${id}`, patch)
      setChannel(data.channel)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the channel.')
    }
  }

  async function uploadBackground(file: File) {
    setError(null)
    setUploading(true)
    try {
      const data = await api.putRaw<{ channel: Channel }>(`/api/channels/mine/${id}/background`, file)
      setChannel(data.channel)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload the background image.')
    } finally {
      setUploading(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this channel?')) return
    setError(null)
    try {
      await api.delete(`/api/channels/mine/${id}`)
      navigate('/channels')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the channel.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{channel?.name ?? 'Channel'}</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {!channel ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-8">
            <ChannelEditForm
              channel={channel}
              streams={streams}
              games={games}
              onUpdate={update}
              onUploadBackground={uploadBackground}
              uploadingBackground={uploading}
              onDelete={remove}
              listPath="/channels"
            />
            {canUseCompositor && (
              <div className="flex flex-col gap-3">
                <h3 className="text-lg font-semibold">Compositor & restream</h3>
                <ChannelCompositionSection apiBase={`/api/channels/mine/${channel.id}/compositions`} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
