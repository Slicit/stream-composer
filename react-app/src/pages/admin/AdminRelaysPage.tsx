import { useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { RelayDestination, RelayProvider, Stream } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function AdminRelaysPage() {
  const [relays, setRelays] = useState<RelayDestination[] | null>(null)
  const [providers, setProviders] = useState<RelayProvider[]>([])
  const [streams, setStreams] = useState<Stream[]>([])
  const [error, setError] = useState<string | null>(null)

  const [streamId, setStreamId] = useState('')
  const [provider, setProvider] = useState('')
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const [relaysData, streamsData] = await Promise.all([
        api.get<{ relays: RelayDestination[]; providers: RelayProvider[] }>('/api/admin/relays'),
        api.get<{ streams: Stream[] }>('/api/admin/streams'),
      ])
      setRelays(relaysData.relays)
      setProviders(relaysData.providers)
      setStreams(streamsData.streams)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load relays.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  function pickProvider(id: string) {
    setProvider(id)
    const p = providers.find((x) => x.id === id)
    if (p) setUrl(p.url)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCreating(true)
    try {
      await api.post('/api/admin/relays', { streamId, provider, url, key })
      setStreamId('')
      setProvider('')
      setUrl('')
      setKey('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the relay.')
    } finally {
      setCreating(false)
    }
  }

  async function toggleEnabled(r: RelayDestination) {
    setError(null)
    try {
      await api.patch(`/api/admin/relays/${r.id}`, { enabled: !r.enabled })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the relay.')
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this restream destination?')) return
    setError(null)
    try {
      await api.delete(`/api/admin/relays/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the relay.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Restream destinations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate} aria-label="Add a relay destination">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-relay-stream">Source stream</Label>
            <Combobox
              id="new-relay-stream"
              aria-label="Source stream for the new relay"
              className="w-56"
              options={streams.map((s) => ({ value: s.id, label: s.nickname || s.name }))}
              value={streamId}
              onValueChange={setStreamId}
              placeholder="Choose a stream"
              searchPlaceholder="Search streams…"
              emptyText="No streams match."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={pickProvider}>
              <SelectTrigger aria-label="Provider for the new relay" className="w-44">
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-relay-url">Ingest server</Label>
            <Input id="new-relay-url" value={url} onChange={(e) => setUrl(e.target.value)} required className="w-64" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-relay-key">Stream key</Label>
            <Input id="new-relay-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} required className="w-48" />
          </div>
          <Button type="submit" variant="outline" disabled={creating || !streamId}>
            Add relay
          </Button>
        </form>

        {relays === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {relays.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.sourceMissing ? <span className="text-destructive">missing source</span> : r.sourceName || '—'}
                  </TableCell>
                  <TableCell>{r.providerLabel}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.keyMasked}</TableCell>
                  <TableCell>
                    <Switch checked={r.enabled} onCheckedChange={() => toggleEnabled(r)} aria-label={`Enabled for ${r.sourceName || 'relay'}`} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(r.id)}
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
