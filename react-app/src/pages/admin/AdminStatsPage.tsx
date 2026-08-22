import { useEffect, useState, type ReactNode } from 'react'
import { Activity, Clock, Cpu, MemoryStick, Server } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LiveDot } from '@/components/LiveDot'
import { BandwidthChart, type BandwidthPoint } from '@/components/BandwidthChart'

interface HostStats {
  cpuPercent: number | null
  cpu: { cores: number; model: string; speedMhz: number; load: number[] }
  memory: { totalMb: number; usedMb: number; percent: number }
  uptimeSec: number
  platform: string
  hostname: string
}

interface StatusResponse {
  host: HostStats
  mediamtx: { reachable: boolean; lastError?: string }
  relays: { total: number; enabled: number; live: number }
  audio: { tracked: number; live: number }
  dataplane: { uptimeSec: number }
}

const STATUS_POLL_MS = 5_000
const BANDWIDTH_POLL_MS = 60_000

function formatUptime(sec: number): string {
  const days = Math.floor(sec / 86400)
  const hours = Math.floor((sec % 86400) / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function StatTile({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground">{icon}</div>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold leading-tight">{value}</span>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  )
}

function ServiceRow({ label, live, detail }: { label: string; live: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2">
      <span className="flex items-center gap-2">
        <LiveDot live={live} onLabel="Reachable" offLabel="Unreachable" />
        <span className="text-sm font-medium">{label}</span>
      </span>
      <span className="text-sm text-muted-foreground">{detail}</span>
    </div>
  )
}

// The admin "Server & Stats" page — reintroduced from the pre-migration
// app's own admin panel (bandwidth graph, host CPU/memory, service
// health), now backed by go-service/internal/hoststats and the
// relayrunner/audiomonitor Summary()s, proxied through
// Api::Admin::StatsController since the browser never talks to the data
// plane's /internal/* routes directly.
export function AdminStatsPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [bandwidth, setBandwidth] = useState<BandwidthPoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const data = await api.get<StatusResponse>('/api/admin/stats/status')
        if (!cancelled) {
          setStatus(data)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not reach the data plane.')
      }
    }
    poll()
    const interval = setInterval(poll, STATUS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const data = await api.get<BandwidthPoint[]>('/api/admin/stats/bandwidth-history')
        if (!cancelled) setBandwidth(data)
      } catch {
        /* the status poll above already surfaces a reachability error */
      }
    }
    poll()
    const interval = setInterval(poll, BANDWIDTH_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {!status ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              icon={<Cpu className="h-4 w-4" />}
              label="CPU"
              value={status.host.cpuPercent === null ? '—' : `${status.host.cpuPercent}%`}
              hint={`${status.host.cpu.cores} cores · load ${status.host.cpu.load.map((n) => n.toFixed(2)).join(' / ')}`}
            />
            <StatTile
              icon={<MemoryStick className="h-4 w-4" />}
              label="Memory"
              value={`${status.host.memory.percent}%`}
              hint={`${status.host.memory.usedMb} / ${status.host.memory.totalMb} MB`}
            />
            <StatTile icon={<Clock className="h-4 w-4" />} label="Host uptime" value={formatUptime(status.host.uptimeSec)} hint={status.host.hostname} />
            <StatTile icon={<Server className="h-4 w-4" />} label="Data plane uptime" value={formatUptime(status.dataplane.uptimeSec)} hint={status.host.platform} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Services</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              <ServiceRow label="MediaMTX" live={status.mediamtx.reachable} detail={status.mediamtx.reachable ? 'OK' : status.mediamtx.lastError || 'Unreachable'} />
              <ServiceRow
                label="Restream destinations"
                live={status.relays.total === 0 || status.relays.live > 0}
                detail={`${status.relays.live} live / ${status.relays.enabled} enabled / ${status.relays.total} total`}
              />
              <ServiceRow
                label="Audio monitor"
                live={status.audio.tracked === 0 || status.audio.live > 0}
                detail={`${status.audio.live} live / ${status.audio.tracked} tracked`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" />
                Bandwidth — last 7 days
              </CardTitle>
            </CardHeader>
            <CardContent>{bandwidth === null ? <p className="text-muted-foreground">Loading…</p> : <BandwidthChart points={bandwidth} />}</CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
