import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { AvailableStream, Channel, Game } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

// Self-service "my channels": /api/channels/mine. Any signed-in user may
// own channels, mirroring the Rails side's own gate (require_user!, not
// require_streamer_or_admin!).
export function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [available, setAvailable] = useState<AvailableStream[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const fileInputs = useRef(new Map<string, HTMLInputElement | null>())

  async function load() {
    try {
      const [channelsData, availableData, gamesData] = await Promise.all([
        api.get<{ channels: Channel[] }>('/api/channels/mine'),
        api.get<{ streams: AvailableStream[] }>('/api/streams/available'),
        api.get<{ games: Game[] }>('/api/games'),
      ])
      setChannels(channelsData.channels)
      setAvailable(availableData.streams)
      setGames(gamesData.games)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load channels.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCreating(true)
    try {
      await api.post('/api/channels/mine', { name })
      setName('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the channel.')
    } finally {
      setCreating(false)
    }
  }

  async function setVisibility(id: string, next: 'private' | 'public') {
    setError(null)
    try {
      await api.patch(`/api/channels/mine/${id}`, { visibility: next })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update visibility.')
    }
  }

  async function updateChannel(id: string, patch: Record<string, unknown>) {
    setError(null)
    try {
      await api.patch(`/api/channels/mine/${id}`, patch)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the channel.')
    }
  }

  async function toggleStream(channel: Channel, streamId: string) {
    setError(null)
    const streamIds = channel.streamIds.includes(streamId)
      ? channel.streamIds.filter((id) => id !== streamId)
      : [...channel.streamIds, streamId]
    try {
      await api.patch(`/api/channels/mine/${channel.id}`, { streamIds })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the channel.')
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this channel?')) return
    setError(null)
    try {
      await api.delete(`/api/channels/mine/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the channel.')
    }
  }

  async function uploadBackground(channelId: string, file: File) {
    setError(null)
    setUploadingFor(channelId)
    try {
      await api.putRaw(`/api/channels/mine/${channelId}/background`, file)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload the background image.')
    } finally {
      setUploadingFor(null)
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>My channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate} aria-label="Add a channel">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-channel-mine">Name</Label>
              <Input id="new-channel-mine" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <Button type="submit" variant="outline" disabled={creating}>
              Add channel
            </Button>
          </form>

          {channels === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : channels.length === 0 ? (
            <p className="text-muted-foreground">No channels yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {channels.map((c) => (
                <Card key={c.id}>
                  <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{c.name}</CardTitle>
                      <Link to={`/c/${c.slug}`} className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline">
                        /c/{c.slug}
                      </Link>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={c.visibility} onValueChange={(v) => setVisibility(c.id, v as 'private' | 'public')}>
                        <SelectTrigger aria-label={`Visibility for ${c.name}`} className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="private">Private</SelectItem>
                          <SelectItem value="public">Public</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => remove(c.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`description-${c.id}`}>Description</Label>
                      <Textarea
                        id={`description-${c.id}`}
                        defaultValue={c.description}
                        maxLength={500}
                        placeholder="What is this channel about?"
                        onBlur={(e) => {
                          if (e.target.value !== c.description) updateChannel(c.id, { description: e.target.value })
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`topic-${c.id}`}>Current topic</Label>
                        <Input
                          id={`topic-${c.id}`}
                          defaultValue={c.currentTopic}
                          maxLength={255}
                          placeholder="What's on right now?"
                          className="w-64"
                          onBlur={(e) => {
                            if (e.target.value !== c.currentTopic) updateChannel(c.id, { currentTopic: e.target.value })
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`game-${c.id}`}>Featured game</Label>
                        <Combobox
                          id={`game-${c.id}`}
                          aria-label={`Featured game for ${c.name}`}
                          className="w-56"
                          options={[{ value: '', label: 'None' }, ...games.map((g) => ({ value: g.id, label: g.name }))]}
                          value={c.featuredGameId ?? ''}
                          onValueChange={(v) => updateChannel(c.id, { featuredGameId: v || null })}
                          placeholder="None"
                          searchPlaceholder="Search games…"
                          emptyText="No games match."
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {available.map((s) => {
                        const included = c.streamIds.includes(s.id)
                        return (
                          <Badge
                            key={s.id}
                            variant={included ? 'default' : 'outline'}
                            className="cursor-pointer select-none"
                            onClick={() => toggleStream(c, s.id)}
                          >
                            {s.nickname || s.name}
                          </Badge>
                        )
                      })}
                      {available.length === 0 && <p className="text-sm text-muted-foreground">No streams available to add yet.</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      {c.backgroundImage && <img src={c.backgroundImage} alt="" className="h-12 w-20 rounded object-cover" />}
                      <input
                        ref={(el) => {
                          fileInputs.current.set(c.id, el)
                        }}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) uploadBackground(c.id, file)
                          e.target.value = ''
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={uploadingFor === c.id}
                        onClick={() => fileInputs.current.get(c.id)?.click()}
                      >
                        {uploadingFor === c.id ? 'Uploading…' : 'Set background image'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
