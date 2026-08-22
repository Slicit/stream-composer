import { useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { Stream } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KeyField } from '@/components/KeyField'

export function AdminStreamsPage() {
  const [streams, setStreams] = useState<Stream[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const data = await api.get<{ streams: Stream[] }>('/api/admin/streams')
      setStreams(data.streams)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load streams.')
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
      await api.post('/api/admin/streams', { name, visibility })
      setName('')
      setVisibility('private')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the stream.')
    } finally {
      setCreating(false)
    }
  }

  async function toggleEnabled(s: Stream) {
    setError(null)
    try {
      await api.patch(`/api/admin/streams/${s.id}`, { enabled: !s.enabled })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the stream.')
    }
  }

  async function setStreamVisibility(id: string, next: 'private' | 'public') {
    setError(null)
    try {
      await api.patch(`/api/admin/streams/${id}`, { visibility: next })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update visibility.')
    }
  }

  async function rotateKey(id: string) {
    if (!confirm('Rotate this stream key? The old key will stop working immediately.')) return
    setError(null)
    try {
      await api.post(`/api/admin/streams/${id}/rotate-key`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rotate the key.')
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this stream? Its relays and any channels referencing it are affected too.')) return
    setError(null)
    try {
      await api.delete(`/api/admin/streams/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the stream.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Streams</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate} aria-label="Add a stream">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-stream-name">Name</Label>
            <Input id="new-stream-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as 'private' | 'public')}>
              <SelectTrigger aria-label="Visibility for the new stream" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="outline" disabled={creating}>
            Add stream
          </Button>
        </form>

        {streams === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {streams.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <KeyField value={s.key} onRotate={() => rotateKey(s.id)} label={`Key for ${s.name}`} />
                  </TableCell>
                  <TableCell>
                    <Select value={s.visibility} onValueChange={(v) => setStreamVisibility(s.id, v as 'private' | 'public')}>
                      <SelectTrigger aria-label={`Visibility for ${s.name}`} className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="private">Private</SelectItem>
                        <SelectItem value="public">Public</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Switch checked={s.enabled} onCheckedChange={() => toggleEnabled(s)} aria-label={`Enabled for ${s.name}`} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(s.id)}
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
