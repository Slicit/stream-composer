import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StreamsPanel } from './StreamsPanel'

const onAir = [
  { key: 'a', name: 'Camera A' },
  { key: 'b', name: 'Camera B' },
]

function noop() {
  /* not exercised by this assertion */
}

describe('StreamsPanel', () => {
  it('renders nothing when on-air is empty', () => {
    const { container } = render(
      <StreamsPanel
        onAir={[]}
        liveByKey={{}}
        hiddenKeys={new Set()}
        onToggleHidden={noop}
        spotlightKey={null}
        onToggleSpotlight={noop}
        onReset={noop}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('lists every on-air stream with a favorite and a hide control, plus a reset action', async () => {
    const onToggleHidden = vi.fn()
    const onToggleSpotlight = vi.fn()
    const onReset = vi.fn()
    render(
      <StreamsPanel
        onAir={onAir}
        liveByKey={{}}
        hiddenKeys={new Set()}
        onToggleHidden={onToggleHidden}
        spotlightKey={null}
        onToggleSpotlight={onToggleSpotlight}
        onReset={onReset}
      />,
    )

    expect(screen.getByText('Camera A')).toBeInTheDocument()
    expect(screen.getByText('Camera B')).toBeInTheDocument()

    await userEvent.click(screen.getAllByTitle('Favorite')[0])
    expect(onToggleSpotlight).toHaveBeenCalledWith('a')

    await userEvent.click(screen.getAllByTitle('Hide')[0])
    expect(onToggleHidden).toHaveBeenCalledWith('a')

    await userEvent.click(screen.getByRole('button', { name: /reset preferences/i }))
    expect(onReset).toHaveBeenCalled()
  })

  it('shows a filled star and Unfavorite label for the favorited stream', () => {
    render(
      <StreamsPanel
        onAir={onAir}
        liveByKey={{}}
        hiddenKeys={new Set()}
        onToggleHidden={noop}
        spotlightKey="b"
        onToggleSpotlight={noop}
        onReset={noop}
      />,
    )
    expect(screen.getByTitle('Unfavorite')).toBeInTheDocument()
  })

  it('shows a strikethrough name and Show label for a hidden stream', () => {
    render(
      <StreamsPanel
        onAir={onAir}
        liveByKey={{}}
        hiddenKeys={new Set(['a'])}
        onToggleHidden={noop}
        spotlightKey={null}
        onToggleSpotlight={noop}
        onReset={noop}
      />,
    )
    expect(screen.getByText('Camera A')).toHaveClass('line-through')
    expect(screen.getByTitle('Show')).toBeInTheDocument()
  })

  it('marks a live stream distinctly from an offline one', () => {
    render(
      <StreamsPanel
        onAir={onAir}
        liveByKey={{ a: true, b: false }}
        hiddenKeys={new Set()}
        onToggleHidden={noop}
        spotlightKey={null}
        onToggleSpotlight={noop}
        onReset={noop}
      />,
    )
    const dots = screen.getAllByRole('status')
    expect(dots).toHaveLength(2)
    expect(dots[0]).toHaveAccessibleName('Live')
    expect(dots[1]).toHaveAccessibleName('Offline')
  })
})
