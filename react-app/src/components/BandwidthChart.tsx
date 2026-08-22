import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface BandwidthPoint {
  at: string
  inboundKbps: number
  outboundKbps: number
}

interface BandwidthChartProps {
  points: BandwidthPoint[]
}

function formatKbps(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)} Mb/s` : `${Math.round(v)} kb/s`
}

interface TooltipPayloadItem {
  dataKey: string
  name: string
  value: number
  color: string
}

// Custom rather than the library default so it's themed with this app's
// own tokens (border/popover/popover-foreground) instead of recharts'
// default light-only styling — this is the hover-value readout. Exported
// so its own rendering can be tested directly: simulating a real mouse
// hover to trigger recharts' internal tracking isn't reliably testable
// (jsdom has no layout, and recharts computes the nearest point from
// real pixel coordinates) — recharts' own hover-to-tooltip wiring is
// mature, widely-used library behavior; what's actually ours to verify
// is what this renders once recharts calls it.
export function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
  if (!active || !payload?.length || !label) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{new Date(label).toLocaleString()}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {formatKbps(p.value)}
        </p>
      ))}
    </div>
  )
}

// Real data from GET /api/admin/stats/bandwidth-history (go-service's
// bandwidthhistory.Tracker — 15-minute samples, kept 7 days), not a demo
// — recharts, themed with the app's existing --primary/--success tokens
// rather than its own default palette.
export function BandwidthChart({ points }: BandwidthChartProps) {
  if (points.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No bandwidth history yet.</p>
  }

  const data = points.map((p) => ({ at: p.at, Inbound: p.inboundKbps, Outbound: p.outboundKbps }))

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="bandwidth-inbound-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="bandwidth-outbound-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="at"
          tickFormatter={(v: string) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          minTickGap={40}
        />
        <YAxis tickFormatter={(v: number) => formatKbps(v)} stroke="hsl(var(--muted-foreground))" fontSize={11} width={70} />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }} />
        <Area type="monotone" dataKey="Inbound" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#bandwidth-inbound-fill)" />
        <Area type="monotone" dataKey="Outbound" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#bandwidth-outbound-fill)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}
