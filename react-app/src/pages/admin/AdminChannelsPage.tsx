import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { Channel } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export function AdminChannelsPage() {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [homepageChannelId, setHomepageChannelId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const data = await api.get<{ channels: Channel[]; homepageChannelId: string | null }>('/api/admin/channels')
      setChannels(data.channels)
      setHomepageChannelId(data.homepageChannelId)
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
      await api.post('/api/admin/channels', { name })
      setName('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the channel.')
    } finally {
      setCreating(false)
    }
  }

  async function setHomepage(id: string) {
    setError(null)
    try {
      await api.put(`/api/admin/channels/${id}/homepage`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set the homepage channel.')
    }
  }

  async function clearHomepage(id: string) {
    setError(null)
    try {
      // The route is scoped by channel id even though clearing the
      // homepage setting itself doesn't depend on which one — mirrors
      // Api::Admin::ChannelsController#clear_homepage, which ignores
      // params[:id] entirely.
      await api.delete(`/api/admin/channels/${id}/homepage`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not clear the homepage channel.')
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this channel?')) return
    setError(null)
    try {
      await api.delete(`/api/admin/channels/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the channel.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Channels</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate} aria-label="Add a channel">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-channel-name">Name</Label>
            <Input id="new-channel-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <Button type="submit" variant="outline" disabled={creating}>
            Add channel
          </Button>
        </form>

        {channels === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>Homepage</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link to={`/admin/channels/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">/c/{c.slug}</TableCell>
                  <TableCell>
                    <Badge variant={c.visibility === 'public' ? 'default' : 'secondary'}>{c.visibility}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={homepageChannelId === c.id}
                      onCheckedChange={(checked) => (checked ? setHomepage(c.id) : clearHomepage(c.id))}
                      aria-label={`Homepage channel: ${c.name}`}
                    />
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="icon" asChild title="Edit">
                      <Link to={`/admin/channels/${c.id}`}>
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
