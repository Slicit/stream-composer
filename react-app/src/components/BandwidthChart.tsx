export interface BandwidthPoint {
  at: string
  inboundKbps: number
  outboundKbps: number
}

interface BandwidthChartProps {
  points: BandwidthPoint[]
}

const WIDTH = 600
const HEIGHT = 180
const PAD = 8

function toPath(values: number[], max: number): string {
  if (values.length === 0) return ''
  const stepX = values.length > 1 ? (WIDTH - PAD * 2) / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = PAD + i * stepX
      const y = max > 0 ? HEIGHT - PAD - (v / max) * (HEIGHT - PAD * 2) : HEIGHT - PAD
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function formatKbps(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)} Mb/s` : `${Math.round(v)} kb/s`
}

// Hand-rolled rather than a charting library — this app has none
// installed, and a 7-day/15-min-sample trend line doesn't need one. Two
// polylines scaled to a fixed viewBox, colored with the existing
// --primary (inbound) and --success (outbound) tokens, not new colors.
export function BandwidthChart({ points }: BandwidthChartProps) {
  if (points.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No bandwidth history yet.</p>
  }

  const inbound = points.map((p) => p.inboundKbps)
  const outbound = points.map((p) => p.outboundKbps)
  const max = Math.max(1, ...inbound, ...outbound)
  const latest = points[points.length - 1]
  const first = points[0]

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-40 w-full" preserveAspectRatio="none">
        <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} className="stroke-border" strokeWidth={1} />
        <path d={toPath(inbound, max)} fill="none" className="stroke-primary" strokeWidth={2} />
        <path d={toPath(outbound, max)} fill="none" className="stroke-success" strokeWidth={2} />
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-primary" />
            Inbound — {formatKbps(latest.inboundKbps)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-success" />
            Outbound — {formatKbps(latest.outboundKbps)}
          </span>
        </div>
        <span>
          {new Date(first.at).toLocaleString()} – {new Date(latest.at).toLocaleString()}
        </span>
      </div>
    </div>
  )
}
