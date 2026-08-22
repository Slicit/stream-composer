import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiveDot } from './LiveDot'

describe('LiveDot', () => {
  it('is labeled Live and colored with the success token when live', () => {
    render(<LiveDot live />)
    const dot = screen.getByRole('status')
    expect(dot).toHaveAccessibleName('Live')
    expect(dot.className).toContain('bg-success')
  })

  it('is labeled Offline and neutral when not live', () => {
    render(<LiveDot live={false} />)
    const dot = screen.getByRole('status')
    expect(dot).toHaveAccessibleName('Offline')
    expect(dot.className).not.toContain('bg-success')
  })
})
