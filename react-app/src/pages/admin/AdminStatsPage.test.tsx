import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AdminStatsPage } from './AdminStatsPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const status = {
  host: {
    cpuPercent: 12.3,
    cpu: { cores: 4, model: 'Test CPU', speedMhz: 3000, load: [0.5, 0.4, 0.3] },
    memory: { totalMb: 8000, usedMb: 4000, percent: 50 },
    uptimeSec: 90000,
    platform: 'linux amd64',
    hostname: 'test-host',
  },
  mediamtx: { reachable: true },
  relays: { total: 2, enabled: 2, live: 1 },
  audio: { tracked: 1, live: 1 },
  dataplane: { uptimeSec: 3600 },
}

const bandwidth = [
  { at: '2026-08-15T00:00:00Z', inboundKbps: 100, outboundKbps: 50 },
  { at: '2026-08-22T00:00:00Z', inboundKbps: 200, outboundKbps: 150 },
]

describe('AdminStatsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders host stats, service health, and the bandwidth chart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/admin/stats/status') return jsonResponse(status)
        if (url === '/api/admin/stats/bandwidth-history') return jsonResponse(bandwidth)
        throw new Error(`unexpected fetch ${url}`)
      }),
    )

    render(<AdminStatsPage />)

    expect(await screen.findByText('12.3%')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('MediaMTX')).toBeInTheDocument()
    expect(screen.getByText('1 live / 2 enabled / 2 total')).toBeInTheDocument()
    expect(screen.getByText('1 live / 1 tracked')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Inbound/)).toBeInTheDocument())
  })

  it('shows an error when the data plane is unreachable, without crashing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/admin/stats/status') return Promise.resolve(new Response(JSON.stringify({ error: 'bad gateway' }), { status: 502 }))
        return jsonResponse([])
      }),
    )

    render(<AdminStatsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('bad gateway')
  })

  it('marks a service unreachable distinctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/admin/stats/status') return jsonResponse({ ...status, mediamtx: { reachable: false, lastError: 'connection refused' } })
        return jsonResponse(bandwidth)
      }),
    )

    render(<AdminStatsPage />)

    expect(await screen.findByText('connection refused')).toBeInTheDocument()
  })
})
