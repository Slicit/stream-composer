import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KeyField } from './KeyField'

describe('KeyField', () => {
  it('renders the key in a single-line input, not a wrapping textarea', () => {
    render(<KeyField value="abcd1234efgh5678" onRotate={vi.fn()} label="Key for test" />)
    const field = screen.getByLabelText('Key for test')
    expect(field.tagName).toBe('INPUT')
    expect(field).toHaveValue('abcd****')
  })

  it('never renders the real key, only the masked prefix', () => {
    render(<KeyField value="the-real-secret-key" onRotate={vi.fn()} label="Key for test" />)
    expect(document.body.textContent).not.toContain('the-real-secret-key')
  })

  it('the copy button has no border (a plain icon suffix, not a bordered control)', () => {
    render(<KeyField value="abcd1234" onRotate={vi.fn()} label="Key for test" />)
    const copyButton = screen.getByRole('button', { name: 'Copy key' })
    expect(copyButton.className).not.toMatch(/\bborder\b/)
  })

  it('copies the real (unmasked) key to the clipboard and shows a transient confirmation', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<KeyField value="the-real-secret-key" onRotate={vi.fn()} label="Key for test" />)
    await user.click(screen.getByRole('button', { name: 'Copy key' }))

    expect(writeText).toHaveBeenCalledWith('the-real-secret-key')
    expect(await screen.findByRole('button', { name: 'Copy key' })).toBeInTheDocument()
  })

  it('calls onRotate when the rotate button is clicked', async () => {
    const onRotate = vi.fn()
    const user = userEvent.setup()
    render(<KeyField value="abcd1234" onRotate={onRotate} label="Key for test" />)

    await user.click(screen.getByRole('button', { name: 'Rotate key' }))
    expect(onRotate).toHaveBeenCalledOnce()
  })
})
