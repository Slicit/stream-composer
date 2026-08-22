import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BandwidthChart, ChartTooltip } from './BandwidthChart'

describe('BandwidthChart', () => {
  it('shows an empty state with no points', () => {
    render(<BandwidthChart points={[]} />)
    expect(screen.getByText('No bandwidth history yet.')).toBeInTheDocument()
  })

  it('renders a chart for real points, with no crash', () => {
    const { container } = render(
      <BandwidthChart
        points={[
          { at: '2026-08-15T00:00:00Z', inboundKbps: 100, outboundKbps: 50 },
          { at: '2026-08-22T00:00:00Z', inboundKbps: 1500, outboundKbps: 300 },
        ]}
      />,
    )
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument()
  })
})

describe('ChartTooltip', () => {
  it('renders nothing while inactive (no hover yet)', () => {
    const { container } = render(<ChartTooltip active={false} payload={[]} label="2026-08-22T00:00:00Z" />)
    expect(container.textContent).toBe('')
  })

  it('shows the hovered timestamp and both series formatted, in Mb/s once over 1000 kb/s', () => {
    render(
      <ChartTooltip
        active
        label="2026-08-22T12:00:00Z"
        payload={[
          { dataKey: 'Inbound', name: 'Inbound', value: 1500, color: 'blue' },
          { dataKey: 'Outbound', name: 'Outbound', value: 300, color: 'green' },
        ]}
      />,
    )
    expect(screen.getByText(/Inbound: 1.5 Mb\/s/)).toBeInTheDocument()
    expect(screen.getByText(/Outbound: 300 kb\/s/)).toBeInTheDocument()
  })
})
