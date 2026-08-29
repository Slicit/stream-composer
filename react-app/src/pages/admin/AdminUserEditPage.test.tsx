import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useEffect } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AdminUserEditPage } from './AdminUserEditPage'
import type { User } from '@/api/types'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

// Same reasoning as AvatarCropField.test.tsx: react-easy-crop needs real
// layout jsdom never produces, and firing onCropComplete during render
// (rather than an effect) is an infinite render loop.
vi.mock('react-easy-crop', () => ({
  default: ({ onCropComplete }: { onCropComplete: (area: unknown, pixels: unknown) => void }) => {
    useEffect(() => {
      onCropComplete({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <div data-testid="mock-cropper" />
  },
}))
vi.mock('@/lib/cropImage', () => ({
  cropImageToFile: vi.fn(async () => new File(['cropped-bytes'], 'avatar.png', { type: 'image/png' })),
}))

const baseUser: User = {
  id: 'u1',
  username: 'target-user',
  role: 'streamer',
  email: 'target@example.com',
  emailConfirmed: true,
  otpEnabled: true,
  otpBackupCodesRemaining: 8,
  streamQuota: 5,
  compositorQuota: 0,
  avatar: null,
  createdAt: '2026-01-01',
  lastLoginAt: null,
}

function renderAt(id: string, fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <MemoryRouter initialEntries={[`/admin/users/${id}`]}>
      <Routes>
        <Route path="/admin/users/:id" element={<AdminUserEditPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminUserEditPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the user and shows their email/confirmation status', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/admin/users/u1') return jsonResponse({ user: baseUser })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderAt('u1', fetchMock)

    expect(await screen.findByText('target@example.com')).toBeInTheDocument()
    expect(screen.getByText('confirmed')).toBeInTheDocument()
  })

  it('changes the role and PATCHes the server', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/admin/users/u1' && (!init || init.method === undefined)) return jsonResponse({ user: baseUser })
      if (url === '/api/admin/users/u1' && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string)
        expect(body).toEqual({ role: 'viewer' })
        return jsonResponse({ user: { ...baseUser, role: 'viewer' } })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderAt('u1', fetchMock)
    await screen.findByLabelText('Role for target-user')

    await userEvent.click(screen.getByRole('combobox', { name: 'Role for target-user' }))
    await userEvent.click(await screen.findByRole('option', { name: 'viewer' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/admin/users/u1' && (init as RequestInit)?.method === 'PATCH')
      expect(call).toBeTruthy()
    })
  })

  it('resets the password, requiring a non-empty value', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/admin/users/u1' && (!init || init.method === undefined)) return jsonResponse({ user: baseUser })
      if (url === '/api/admin/users/u1' && init?.method === 'PATCH') {
        expect(JSON.parse(init.body as string)).toEqual({ password: 'new-horse-battery-2' })
        return jsonResponse({ user: baseUser })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderAt('u1', fetchMock)
    await screen.findByLabelText('Reset password')

    const setButton = screen.getByRole('button', { name: 'Set password' })
    expect(setButton).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Reset password'), 'new-horse-battery-2')
    expect(setButton).toBeEnabled()
    await userEvent.click(setButton)

    expect(await screen.findByText('Password changed.')).toBeInTheDocument()
  })

  it('force-resets two-factor authentication after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/admin/users/u1' && (!init || init.method === undefined)) return jsonResponse({ user: baseUser })
      if (url === '/api/admin/users/u1/reset-2fa' && init?.method === 'POST') {
        return jsonResponse({ user: { ...baseUser, otpEnabled: false } })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderAt('u1', fetchMock)
    await screen.findByRole('button', { name: 'Reset two-factor authentication' })

    await userEvent.click(screen.getByRole('button', { name: 'Reset two-factor authentication' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/admin/users/u1/reset-2fa')
      expect(call).toBeTruthy()
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset two-factor authentication' })).toBeDisabled())
  })

  it('disables the reset-2FA button once it is already off', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/admin/users/u1') return jsonResponse({ user: { ...baseUser, otpEnabled: false } })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderAt('u1', fetchMock)

    expect(await screen.findByRole('button', { name: 'Reset two-factor authentication' })).toBeDisabled()
  })

  it('uploads an avatar for this user to the admin endpoint', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/admin/users/u1' && (!init || init.method === undefined)) return jsonResponse({ user: baseUser })
      if (url === '/api/admin/users/u1/avatar' && init?.method === 'PUT') {
        return jsonResponse({ user: { ...baseUser, avatar: '/uploads/avatars/u1.png' } })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderAt('u1', fetchMock)
    await screen.findByRole('button', { name: 'Change avatar' })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File([new Uint8Array(100)], 'photo.png', { type: 'image/png' }))

    const saveButton = await screen.findByRole('button', { name: 'Save avatar' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    await userEvent.click(saveButton)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/admin/users/u1/avatar')
      expect(call).toBeTruthy()
    })
  })

  it('deletes the user after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/admin/users/u1' && (!init || init.method === undefined)) return jsonResponse({ user: baseUser })
      if (url === '/api/admin/users/u1' && init?.method === 'DELETE') return jsonResponse({ ok: true })
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderAt('u1', fetchMock)
    await screen.findByRole('button', { name: 'Delete user' })

    await userEvent.click(screen.getByRole('button', { name: 'Delete user' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/admin/users/u1' && (init as RequestInit)?.method === 'DELETE')
      expect(call).toBeTruthy()
    })
  })
})
