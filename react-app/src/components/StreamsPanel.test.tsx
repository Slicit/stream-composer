import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StreamsPanel } from './StreamsPanel'

const onAir = [
  { key: 'a', name: 'Camera A' },
  { key: 'b', name: 'Camera B' },
]

describe('StreamsPanel', () => {
  it('renders nothing on-air is empty', () => {
    const { container } = render(
      <StreamsPanel onAir={[]} hiddenKeys={new Set()} onToggleHidden={vi.fn()} spotlightKey={null} onToggleSpotlight={vi.fn()} />,
    )
    expect(container.textContent).toBe('')
  })

  it('lists every on-air stream with a highlight and a hide control', async () => {
    const onToggleHidden = vi.fn()
    const onToggleSpotlight = vi.fn()
    render(
      <StreamsPanel onAir={onAir} hiddenKeys={new Set()} onToggleHidden={onToggleHidden} spotlightKey={null} onToggleSpotlight={onToggleSpotlight} />,
    )

    expect(screen.getByText('Camera A')).toBeInTheDocument()
    expect(screen.getByText('Camera B')).toBeInTheDocument()

    await userEvent.click(screen.getAllByTitle('Highlight')[0])
    expect(onToggleSpotlight).toHaveBeenCalledWith('a')

    await userEvent.click(screen.getAllByTitle('Hide')[0])
    expect(onToggleHidden).toHaveBeenCalledWith('a')
  })

  it('shows a filled star and un-highlight label for the spotlighted stream', () => {
    render(<StreamsPanel onAir={onAir} hiddenKeys={new Set()} onToggleHidden={vi.fn()} spotlightKey="b" onToggleSpotlight={vi.fn()} />)
    expect(screen.getByTitle('Un-highlight')).toBeInTheDocument()
  })

  it('shows a strikethrough name and Show label for a hidden stream', () => {
    render(<StreamsPanel onAir={onAir} hiddenKeys={new Set(['a'])} onToggleHidden={vi.fn()} spotlightKey={null} onToggleSpotlight={vi.fn()} />)
    expect(screen.getByText('Camera A')).toHaveClass('line-through')
    expect(screen.getByTitle('Show')).toBeInTheDocument()
  })
})
