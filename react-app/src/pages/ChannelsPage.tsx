import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { Channel } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// Self-service "my channels": /api/channels/mine. Any signed-in user may
// own channels, mirroring the Rails side's own gate (require_user!, not
// require_streamer_or_admin!). Kept lean on purpose — visibility is a
// quick action worth keeping here, everything else (description, topic,
// featured game, layout mode, membership, background) lives on the full
// edit page at /channels/:id, shared with the admin equivalent so both
// have the same capabilities.
export function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const data = await api.get<{ channels: Channel[] }>('/api/channels/mine')
      setChannels(data.channels)
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>My channels</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link to={`/channels/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link to={`/c/${c.slug}`} className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline">
                      /c/{c.slug}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Select value={c.visibility} onValueChange={(v) => setVisibility(c.id, v as 'private' | 'public')}>
                      <SelectTrigger aria-label={`Visibility for ${c.name}`} className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="private">Private</SelectItem>
                        <SelectItem value="public">Public</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="icon" asChild title="Edit">
                      <Link to={`/channels/${c.id}`}>
                        <Pencil className="h-4 w-4" />
                        <span className="sr-only">Edit</span>
                      </Link>
                    </Button>
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
