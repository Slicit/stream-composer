import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, beforeEach } from 'vitest'
import { ChannelPrefsProvider, useChannelPrefs } from './ChannelPrefsContext'

function Harness() {
  const { slug, onAir, hiddenKeys, spotlightKey, setChannelStreams, toggleHidden, toggleSpotlight, reset } = useChannelPrefs()
  return (
    <div>
      <button onClick={() => setChannelStreams('room', 'Room', [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }], { a: true, b: false })}>seed</button>
      <button onClick={() => toggleHidden('a')}>hide-a</button>
      <button onClick={() => toggleSpotlight('b')}>favorite-b</button>
      <button onClick={reset}>reset</button>
      <p>slug:{slug ?? 'none'}</p>
      <p>onAir:{onAir.map((s) => s.key).join(',')}</p>
      <p>hidden:{[...hiddenKeys].join(',')}</p>
      <p>spotlight:{spotlightKey ?? 'none'}</p>
    </div>
  )
}

describe('ChannelPrefsContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reset clears both hidden and favorited state (un-favorite everything, show everything)', async () => {
    render(
      <ChannelPrefsProvider>
        <Harness />
      </ChannelPrefsProvider>,
    )

    await userEvent.click(screen.getByText('seed'))
    await userEvent.click(screen.getByText('hide-a'))
    await userEvent.click(screen.getByText('favorite-b'))

    expect(screen.getByText('hidden:a')).toBeInTheDocument()
    expect(screen.getByText('spotlight:b')).toBeInTheDocument()

    await userEvent.click(screen.getByText('reset'))

    expect(screen.getByText('hidden:')).toBeInTheDocument()
    expect(screen.getByText('spotlight:none')).toBeInTheDocument()
    // The channel itself is still open — reset clears preferences, not the view.
    expect(screen.getByText('slug:room')).toBeInTheDocument()
  })

  it('persists hidden streams to localStorage per channel slug, and reset clears that entry too', async () => {
    render(
      <ChannelPrefsProvider>
        <Harness />
      </ChannelPrefsProvider>,
    )

    await userEvent.click(screen.getByText('seed'))
    await userEvent.click(screen.getByText('hide-a'))
    expect(localStorage.getItem('sc:channel:room:hidden')).toBe('["a"]')

    await userEvent.click(screen.getByText('reset'))
    expect(localStorage.getItem('sc:channel:room:hidden')).toBe('[]')
  })
})
