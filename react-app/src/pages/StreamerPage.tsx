import { useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { RelayDestination, RelayProvider, RelaySource, Stream } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KeyField } from '@/components/KeyField'

// Self-service for the streamer role: /streams/mine and /relays/mine,
// combined on one page since a relay's ownership follows its source
// stream (mirrors server/src/routes/streamer.js's own single-page shape).
export function StreamerPage() {
  const [streams, setStreams] = useState<Stream[] | null>(null)
  const [quota, setQuota] = useState(0)
  const [relays, setRelays] = useState<RelayDestination[] | null>(null)
  const [providers, setProviders] = useState<RelayProvider[]>([])
  const [sources, setSources] = useState<RelaySource[]>([])
  const [error, setError] = useState<string | null>(null)

  const [streamName, setStreamName] = useState('')
  const [creatingStream, setCreatingStream] = useState(false)

  const [relayStreamId, setRelayStreamId] = useState('')
  const [relayProvider, setRelayProvider] = useState('')
  const [relayUrl, setRelayUrl] = useState('')
  const [relayKey, setRelayKey] = useState('')
  const [creatingRelay, setCreatingRelay] = useState(false)

  async function loadStreams() {
    try {
      const data = await api.get<{ streams: Stream[]; quota: number }>('/api/streams/mine')
      setStreams(data.streams)
      setQuota(data.quota)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your streams.')
    }
  }

  async function loadRelays() {
    try {
      const data = await api.get<{ relays: RelayDestination[]; providers: RelayProvider[]; sources: RelaySource[] }>('/api/relays/mine')
      setRelays(data.relays)
      setProviders(data.providers)
      setSources(data.sources)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your relays.')
    }
  }

  useEffect(() => {
    loadStreams()
    loadRelays()
  }, [])

  async function createStream(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCreatingStream(true)
    try {
      await api.post('/api/streams/mine', { name: streamName })
      setStreamName('')
      await loadStreams()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the stream.')
    } finally {
      setCreatingStream(false)
    }
  }

  async function rotateKey(id: string) {
    if (!confirm('Rotate this stream key? The old key will stop working immediately.')) return
    setError(null)
    try {
      await api.post(`/api/streams/mine/${id}/rotate-key`)
      await loadStreams()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rotate the key.')
    }
  }

  async function toggleStream(s: Stream) {
    setError(null)
    try {
      await api.patch(`/api/streams/mine/${s.id}`, { enabled: !s.enabled })
      await loadStreams()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the stream.')
    }
  }

  async function setVisibility(id: string, next: 'private' | 'public') {
    setError(null)
    try {
      await api.patch(`/api/streams/mine/${id}`, { visibility: next })
      await loadStreams()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update visibility.')
    }
  }

  async function removeStream(id: string) {
    if (!confirm('Delete this stream and everything relaying from it?')) return
    setError(null)
    try {
      await api.delete(`/api/streams/mine/${id}`)
      await loadStreams()
      await loadRelays()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the stream.')
    }
  }

  function pickProvider(id: string) {
    setRelayProvider(id)
    const p = providers.find((x) => x.id === id)
    if (p) setRelayUrl(p.url)
  }

  async function createRelay(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCreatingRelay(true)
    try {
      await api.post('/api/relays/mine', { streamId: relayStreamId, provider: relayProvider, url: relayUrl, key: relayKey })
      setRelayStreamId('')
      setRelayProvider('')
      setRelayUrl('')
      setRelayKey('')
      await loadRelays()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the relay.')
    } finally {
      setCreatingRelay(false)
    }
  }

  async function toggleRelay(r: RelayDestination) {
    setError(null)
    try {
      await api.patch(`/api/relays/mine/${r.id}`, { enabled: !r.enabled })
      await loadRelays()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the relay.')
    }
  }

  async function removeRelay(id: string) {
    if (!confirm('Delete this restream destination?')) return
    setError(null)
    try {
      await api.delete(`/api/relays/mine/${id}`)
      await loadRelays()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the relay.')
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
          <CardTitle>
            My streams {streams && <span className="text-sm font-normal text-muted-foreground">({streams.length}/{quota})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form className="flex flex-wrap items-end gap-3" onSubmit={createStream} aria-label="Add a stream">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-my-stream">Name</Label>
              <Input id="new-my-stream" value={streamName} onChange={(e) => setStreamName(e.target.value)} required />
            </div>
            <Button type="submit" variant="outline" disabled={creatingStream || (streams !== null && streams.length >= quota)}>
              Add stream
            </Button>
          </form>

          {streams === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : streams.length === 0 ? (
            <p className="text-muted-foreground">No streams yet.</p>
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
                      <Select value={s.visibility} onValueChange={(v) => setVisibility(s.id, v as 'private' | 'public')}>
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
                      <Switch checked={s.enabled} onCheckedChange={() => toggleStream(s)} aria-label={`Enabled for ${s.name}`} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeStream(s.id)}
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

      <Card>
        <CardHeader>
          <CardTitle>My restream destinations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form className="flex flex-wrap items-end gap-3" onSubmit={createRelay} aria-label="Add a relay destination">
            <div className="flex flex-col gap-1.5">
              <Label>Source stream</Label>
              <Select value={relayStreamId} onValueChange={setRelayStreamId}>
                <SelectTrigger aria-label="Source stream for the new relay" className="w-48">
                  <SelectValue placeholder="Choose a stream" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Provider</Label>
              <Select value={relayProvider} onValueChange={pickProvider}>
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
              <Label htmlFor="new-relay-url-mine">Ingest server</Label>
              <Input id="new-relay-url-mine" value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} required className="w-64" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-relay-key-mine">Stream key</Label>
              <Input id="new-relay-key-mine" type="password" value={relayKey} onChange={(e) => setRelayKey(e.target.value)} required className="w-48" />
            </div>
            <Button type="submit" variant="outline" disabled={creatingRelay || sources.length === 0}>
              Add relay
            </Button>
          </form>

          {relays === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : relays.length === 0 ? (
            <p className="text-muted-foreground">No restream destinations yet.</p>
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
                      <Switch checked={r.enabled} onCheckedChange={() => toggleRelay(r)} aria-label={`Enabled for ${r.sourceName || 'relay'}`} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeRelay(r.id)}
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
    </div>
  )
}
