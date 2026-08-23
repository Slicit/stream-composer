import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ChannelEditForm } from './ChannelEditForm'
import type { Channel } from '@/api/types'

const channel: Channel = {
  id: 'c1',
  name: 'My Channel',
  slug: 'my-channel',
  visibility: 'private',
  ownerId: 'owner-1',
  backgroundImage: null,
  streamIds: ['s1'],
  sharedWith: [],
  description: 'Old description',
  currentTopic: 'Old topic',
  featuredGameId: null,
  featuredGameName: null,
  layoutMode: null,
  createdAt: '2026-01-01',
}

const streams = [
  { id: 's1', name: 'Included Cam', nickname: '' },
  { id: 's2', name: 'Other Cam', nickname: '' },
]

const games = [{ id: 'g1', name: 'Celeste' }]

function renderForm(overrides: Partial<Parameters<typeof ChannelEditForm>[0]> = {}) {
  const onUpdate = vi.fn()
  const onUploadBackground = vi.fn()
  const onDelete = vi.fn()
  render(
    <MemoryRouter>
      <ChannelEditForm
        channel={channel}
        streams={streams}
        games={games}
        onUpdate={onUpdate}
        onUploadBackground={onUploadBackground}
        uploadingBackground={false}
        onDelete={onDelete}
        listPath="/channels"
        {...overrides}
      />
    </MemoryRouter>,
  )
  return { onUpdate, onUploadBackground, onDelete }
}

describe('ChannelEditForm', () => {
  it('saves the name on blur only when it changed', async () => {
    const { onUpdate } = renderForm()
    const user = userEvent.setup()

    const name = screen.getByLabelText('Name')
    await user.click(name)
    await user.tab()
    expect(onUpdate).not.toHaveBeenCalled()

    await user.clear(name)
    await user.type(name, 'New Name')
    await user.tab()
    expect(onUpdate).toHaveBeenCalledWith({ name: 'New Name' })
  })

  it('saves description and current topic on blur', async () => {
    const { onUpdate } = renderForm()
    const user = userEvent.setup()

    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'New description')
    await user.tab()
    expect(onUpdate).toHaveBeenCalledWith({ description: 'New description' })
  })

  it('updates visibility immediately on change', async () => {
    const { onUpdate } = renderForm()
    const user = userEvent.setup()

    await user.click(screen.getByRole('combobox', { name: 'Visibility' }))
    await user.click(screen.getByRole('option', { name: 'Public' }))
    expect(onUpdate).toHaveBeenCalledWith({ visibility: 'public' })
  })

  it('offers "use platform default" alongside fixed/maximize for layout mode, mapping it to null', async () => {
    const { onUpdate } = renderForm()
    const user = userEvent.setup()

    await user.click(screen.getByRole('combobox', { name: 'Grid layout' }))
    expect(screen.getByRole('option', { name: 'Use platform default' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Maximize page space' }))
    expect(onUpdate).toHaveBeenCalledWith({ layoutMode: 'maximize' })
  })

  it('resolves the featured-game picker to a game id, or null for "None"', async () => {
    const { onUpdate } = renderForm()
    const user = userEvent.setup()

    await user.click(screen.getByRole('combobox', { name: 'Featured game' }))
    await user.click(screen.getByRole('option', { name: 'Celeste' }))
    expect(onUpdate).toHaveBeenCalledWith({ featuredGameId: 'g1' })
  })

  it('toggles stream membership by clicking a badge', async () => {
    const { onUpdate } = renderForm()
    const user = userEvent.setup()

    await user.click(screen.getByText('Other Cam'))
    expect(onUpdate).toHaveBeenCalledWith({ streamIds: ['s1', 's2'] })

    await user.click(screen.getByText('Included Cam'))
    expect(onUpdate).toHaveBeenCalledWith({ streamIds: [] })
  })

  it('shows the owner field only when users are provided (admin only)', () => {
    renderForm()
    expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument()

    renderForm({ users: [{ id: 'owner-1', username: 'alice' }, { id: 'owner-2', username: 'bob' }] })
    expect(screen.getByLabelText('Owner')).toBeInTheDocument()
  })

  it('reassigns the owner immediately on change', async () => {
    const { onUpdate } = renderForm({ users: [{ id: 'owner-1', username: 'alice' }, { id: 'owner-2', username: 'bob' }] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('combobox', { name: 'Owner' }))
    await user.click(screen.getByRole('option', { name: 'bob' }))
    expect(onUpdate).toHaveBeenCalledWith({ ownerId: 'owner-2' })
  })

  it('calls onDelete when Delete channel is clicked', async () => {
    const { onDelete } = renderForm()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /delete channel/i }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
