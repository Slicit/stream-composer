import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/api/client'
import type { Channel, Game, Stream, User } from '@/api/types'
import { ChannelEditForm } from '@/components/ChannelEditForm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// The admin full edit page for any channel — /admin/channels/:id. Shares
// ChannelEditForm with the self-service equivalent (ChannelEditPage) so
// both offer the same capabilities; the only real difference is the data
// source (every stream/user, not just the caller's own/available ones)
// and the extra owner-reassignment field that capability implies.
export function AdminChannelEditPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [channel, setChannel] = useState<Channel | null>(null)
  const [streams, setStreams] = useState<Stream[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  async function load() {
    try {
      const [channelData, streamsData, gamesData, usersData] = await Promise.all([
        api.get<{ channel: Channel }>(`/api/admin/channels/${id}`),
        api.get<{ streams: Stream[] }>('/api/admin/streams'),
        api.get<{ games: Game[] }>('/api/games'),
        api.get<{ users: User[] }>('/api/admin/users'),
      ])
      setChannel(channelData.channel)
      setStreams(streamsData.streams)
      setGames(gamesData.games)
      setUsers(usersData.users)
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
      const data = await api.patch<{ channel: Channel }>(`/api/admin/channels/${id}`, patch)
      setChannel(data.channel)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the channel.')
    }
  }

  async function uploadBackground(file: File) {
    setError(null)
    setUploading(true)
    try {
      const data = await api.putRaw<{ channel: Channel }>(`/api/admin/channels/${id}/background`, file)
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
      await api.delete(`/api/admin/channels/${id}`)
      navigate('/admin/channels')
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
          <ChannelEditForm
            channel={channel}
            streams={streams}
            games={games}
            users={users}
            onUpdate={update}
            onUploadBackground={uploadBackground}
            uploadingBackground={uploading}
            onDelete={remove}
            listPath="/admin/channels"
          />
        )}
      </CardContent>
    </Card>
  )
}
