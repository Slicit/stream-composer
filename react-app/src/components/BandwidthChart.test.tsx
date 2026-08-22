import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BandwidthChart } from './BandwidthChart'

describe('BandwidthChart', () => {
  it('shows an empty state with no points', () => {
    render(<BandwidthChart points={[]} />)
    expect(screen.getByText('No bandwidth history yet.')).toBeInTheDocument()
  })

  it('renders the latest inbound/outbound reading and the time range', () => {
    render(
      <BandwidthChart
        points={[
          { at: '2026-08-15T00:00:00Z', inboundKbps: 100, outboundKbps: 50 },
          { at: '2026-08-22T00:00:00Z', inboundKbps: 1500, outboundKbps: 300 },
        ]}
      />,
    )
    expect(screen.getByText(/Inbound — 1.5 Mb\/s/)).toBeInTheDocument()
    expect(screen.getByText(/Outbound — 300 kb\/s/)).toBeInTheDocument()
  })
})
