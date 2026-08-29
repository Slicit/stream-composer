import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, beforeEach } from 'vitest'
import { ThemeProvider, useTheme } from './ThemeContext'

function Harness() {
  const { theme, setTheme } = useTheme()
  return (
    <div>
      <p>theme:{theme}</p>
      <button onClick={() => setTheme('aurora')}>aurora</button>
      <button onClick={() => setTheme('onair')}>onair</button>
      <button onClick={() => setTheme('legacy')}>legacy</button>
    </div>
  )
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('defaults to studio when nothing is stored', () => {
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    expect(screen.getByText('theme:studio')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('studio')
  })

  it('reads a previously stored theme on mount', () => {
    localStorage.setItem('sc:theme', 'aurora')
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    expect(screen.getByText('theme:aurora')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('aurora')
  })

  it('ignores an invalid stored value and falls back to the default', () => {
    localStorage.setItem('sc:theme', 'not-a-real-theme')
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    expect(screen.getByText('theme:studio')).toBeInTheDocument()
  })

  it('setTheme updates state, persists to localStorage, and sets the data-theme attribute', async () => {
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )

    await userEvent.click(screen.getByText('onair'))

    expect(screen.getByText('theme:onair')).toBeInTheDocument()
    expect(localStorage.getItem('sc:theme')).toBe('onair')
    expect(document.documentElement.dataset.theme).toBe('onair')
  })

  it('switching to legacy is preserved across a remount (simulating a reload)', async () => {
    const { unmount } = render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    await userEvent.click(screen.getByText('legacy'))
    unmount()

    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    expect(screen.getByText('theme:legacy')).toBeInTheDocument()
  })
})
