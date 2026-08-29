import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, beforeEach } from 'vitest'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ThemeSwitcher } from './ThemeSwitcher'

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('lists all four themes, marking the current one selected', async () => {
    render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Theme' }))

    expect(await screen.findByRole('menuitemradio', { name: 'Studio' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Legacy' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: 'Aurora' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'On Air' })).toBeInTheDocument()
  })

  it('picking a theme applies it and persists it', async () => {
    render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Theme' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Aurora' }))

    expect(document.documentElement.dataset.theme).toBe('aurora')
    expect(localStorage.getItem('sc:theme')).toBe('aurora')

    await userEvent.click(screen.getByRole('button', { name: 'Theme' }))
    expect(await screen.findByRole('menuitemradio', { name: 'Aurora' })).toHaveAttribute('aria-checked', 'true')
  })
})
