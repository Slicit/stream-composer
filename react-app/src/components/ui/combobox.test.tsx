import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Combobox, type ComboboxOption } from './combobox'

const OPTIONS: ComboboxOption[] = [
  { value: 'id-1', label: 'Front Row Cam' },
  { value: 'id-2', label: 'Drum Cam' },
  { value: 'id-3', label: 'Wide Shot' },
]

function Controlled({ options = OPTIONS }: { options?: ComboboxOption[] }) {
  const [value, setValue] = useState('')
  return (
    <Combobox
      aria-label="Source stream"
      options={options}
      value={value}
      onValueChange={setValue}
      placeholder="Choose a stream"
      searchPlaceholder="Search streams…"
    />
  )
}

describe('Combobox', () => {
  it('shows the placeholder, not a raw id, until something is picked', () => {
    render(<Controlled />)
    expect(screen.getByRole('combobox', { name: 'Source stream' })).toHaveTextContent('Choose a stream')
  })

  it('lists every option by its label when opened, and selecting one sets the value to its id', async () => {
    const user = userEvent.setup()
    render(<Controlled />)

    await user.click(screen.getByRole('combobox', { name: 'Source stream' }))
    expect(screen.getByText('Front Row Cam')).toBeInTheDocument()
    expect(screen.getByText('Drum Cam')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Drum Cam' }))

    // The trigger now shows the label (not id-2), and re-opening shows the
    // matching option checked — proving the underlying value really is the id.
    const trigger = screen.getByRole('combobox', { name: 'Source stream' })
    expect(trigger).toHaveTextContent('Drum Cam')
    expect(trigger).not.toHaveTextContent('id-2')
  })

  it('filters the list as you type in the embedded search box', async () => {
    const user = userEvent.setup()
    render(<Controlled />)

    await user.click(screen.getByRole('combobox', { name: 'Source stream' }))
    await user.type(screen.getByPlaceholderText('Search streams…'), 'drum')

    expect(screen.getByText('Drum Cam')).toBeInTheDocument()
    expect(screen.queryByText('Front Row Cam')).not.toBeInTheDocument()
    expect(screen.queryByText('Wide Shot')).not.toBeInTheDocument()
  })

  it('shows an empty-state message when nothing matches the filter', async () => {
    const user = userEvent.setup()
    render(<Controlled />)

    await user.click(screen.getByRole('combobox', { name: 'Source stream' }))
    await user.type(screen.getByPlaceholderText('Search streams…'), 'nonexistent')

    expect(screen.getByText('No matches.')).toBeInTheDocument()
  })

  it('marks the currently selected option with a check when reopened', async () => {
    const user = userEvent.setup()
    render(<Controlled />)

    await user.click(screen.getByRole('combobox', { name: 'Source stream' }))
    await user.click(screen.getByRole('option', { name: 'Wide Shot' }))
    await user.click(screen.getByRole('combobox', { name: 'Source stream' }))

    expect(screen.getByRole('option', { name: 'Wide Shot' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Front Row Cam' })).toHaveAttribute('aria-selected', 'false')
  })
})
