import { useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { ChannelComposition, ChannelCompositionDestination, Orientation, RelayProvider } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const PRESETS: Record<Orientation, { label: string; width: number; height: number }[]> = {
  horizontal: [
    { label: '1080p (1920x1080)', width: 1920, height: 1080 },
    { label: '720p (1280x720)', width: 1280, height: 720 },
  ],
  vertical: [
    { label: '1080x1920 (TikTok/Shorts/Reels)', width: 1080, height: 1920 },
    { label: '720x1280', width: 720, height: 1280 },
  ],
}

function presetIdFor(orientation: Orientation, width: number, height: number): string {
  const i = PRESETS[orientation].findIndex((p) => p.width === width && p.height === height)
  return i === -1 ? 'custom' : String(i)
}

interface ChannelCompositionSectionProps {
  // /api/channels/mine/:id/compositions for self-service, /api/admin/channels/:id/compositions for admin —
  // same shape either way (Api::ChannelCompositionsController / Api::Admin::ChannelCompositionsController).
  apiBase: string
}

// A channel's server-side compositor config: whether to run a horizontal
// and/or vertical composed feed, at what resolution/bitrate, and where to
// relay each one. Opt-in, gated server-side by can_use_compositor — the
// caller decides whether to render this at all (see ChannelEditPage/
// AdminChannelEditPage). Config only: nothing here starts an ffmpeg
// process, that's a later data-plane slice.
export function ChannelCompositionSection({ apiBase }: ChannelCompositionSectionProps) {
  const [compositions, setCompositions] = useState<ChannelComposition[] | null>(null)
  const [providers, setProviders] = useState<RelayProvider[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const data = await api.get<{ compositions: ChannelComposition[]; providers: RelayProvider[] }>(apiBase)
      setCompositions(data.compositions)
      setProviders(data.providers)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the compositor settings.')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase])

  async function update(orientation: Orientation, patch: Record<string, unknown>) {
    setError(null)
    try {
      const data = await api.patch<{ composition: ChannelComposition }>(`${apiBase}/${orientation}`, patch)
      setCompositions((prev) => (prev ? prev.map((c) => (c.orientation === orientation ? data.composition : c)) : prev))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the composition.')
    }
  }

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    )
  }

  if (!compositions) {
    return <p className="text-muted-foreground">Loading…</p>
  }

  return (
    <div className="flex flex-col gap-6">
      {(['horizontal', 'vertical'] as const).map((orientation) => {
        const composition = compositions.find((c) => c.orientation === orientation)
        if (!composition) return null
        return (
          <OrientationCard
            key={orientation}
            composition={composition}
            providers={providers}
            apiBase={apiBase}
            onUpdate={(patch) => update(orientation, patch)}
            onDestinationsChanged={load}
          />
        )
      })}
    </div>
  )
}

function OrientationCard({
  composition,
  providers,
  apiBase,
  onUpdate,
  onDestinationsChanged,
}: {
  composition: ChannelComposition
  providers: RelayProvider[]
  apiBase: string
  onUpdate: (patch: Record<string, unknown>) => void
  onDestinationsChanged: () => void
}) {
  const orientation = composition.orientation
  const presetId = presetIdFor(orientation, composition.width, composition.height)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base capitalize">{orientation}</CardTitle>
        <Switch
          checked={composition.enabled}
          onCheckedChange={(checked) => onUpdate({ enabled: checked })}
          aria-label={`Enable ${orientation} composition`}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>Resolution</Label>
            <Select
              value={presetId}
              onValueChange={(v) => {
                if (v === 'custom') return
                const preset = PRESETS[orientation][Number(v)]
                onUpdate({ width: preset.width, height: preset.height })
              }}
            >
              <SelectTrigger aria-label={`${orientation} resolution`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS[orientation].map((p, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {presetId === 'custom' && (
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${orientation}-width`}>Width</Label>
                <Input
                  id={`${orientation}-width`}
                  type="number"
                  defaultValue={composition.width}
                  className="w-24"
                  onBlur={(e) => {
                    const width = Number(e.target.value)
                    if (width && width !== composition.width) onUpdate({ width })
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${orientation}-height`}>Height</Label>
                <Input
                  id={`${orientation}-height`}
                  type="number"
                  defaultValue={composition.height}
                  className="w-24"
                  onBlur={(e) => {
                    const height = Number(e.target.value)
                    if (height && height !== composition.height) onUpdate({ height })
                  }}
                />
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${orientation}-bitrate`}>Bitrate (kb/s)</Label>
            <Input
              id={`${orientation}-bitrate`}
              type="number"
              defaultValue={composition.bitrateKbps}
              onBlur={(e) => {
                const bitrateKbps = Number(e.target.value)
                if (bitrateKbps && bitrateKbps !== composition.bitrateKbps) onUpdate({ bitrateKbps })
              }}
            />
          </div>
        </div>

        <DestinationsTable
          composition={composition}
          providers={providers}
          apiBase={apiBase}
          onChanged={onDestinationsChanged}
        />
      </CardContent>
    </Card>
  )
}

function DestinationsTable({
  composition,
  providers,
  apiBase,
  onChanged,
}: {
  composition: ChannelComposition
  providers: RelayProvider[]
  apiBase: string
  onChanged: () => void
}) {
  const [provider, setProvider] = useState('')
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `${apiBase}/${composition.orientation}/destinations`

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
      await api.post(base, { provider, url, key })
      setProvider('')
      setUrl('')
      setKey('')
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the destination.')
    } finally {
      setCreating(false)
    }
  }

  async function toggle(d: ChannelCompositionDestination) {
    setError(null)
    try {
      await api.patch(`${base}/${d.id}`, { enabled: !d.enabled })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the destination.')
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this destination?')) return
    setError(null)
    try {
      await api.delete(`${base}/${id}`)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the destination.')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Label>Relay destinations</Label>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate} aria-label={`Add a ${composition.orientation} relay destination`}>
        <div className="flex flex-col gap-1.5">
          <Label>Provider</Label>
          <Select value={provider} onValueChange={pickProvider}>
            <SelectTrigger aria-label={`Provider for the new ${composition.orientation} destination`} className="w-44">
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
          <Label htmlFor={`${composition.orientation}-dest-url`}>Server URL</Label>
          <Input id={`${composition.orientation}-dest-url`} value={url} onChange={(e) => setUrl(e.target.value)} required className="w-64" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${composition.orientation}-dest-key`}>Stream key</Label>
          <Input id={`${composition.orientation}-dest-key`} type="password" value={key} onChange={(e) => setKey(e.target.value)} className="w-48" />
        </div>
        <Button type="submit" variant="outline" disabled={creating || !provider}>
          Add destination
        </Button>
      </form>

      {composition.destinations.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {composition.destinations.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.providerLabel}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{d.keyMasked || '—'}</TableCell>
                <TableCell>
                  <Switch checked={d.enabled} onCheckedChange={() => toggle(d)} aria-label={`Enabled for ${d.providerLabel}`} />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="icon" className="text-destructive hover:text-destructive" onClick={() => remove(d.id)} title="Delete">
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
