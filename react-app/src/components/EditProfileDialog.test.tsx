import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import { EditProfileDialog } from './EditProfileDialog'
import type { User } from '@/api/types'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const baseUser: User = {
  id: 'u1',
  username: 'alice',
  role: 'viewer',
  email: null,
  emailConfirmed: false,
  otpEnabled: false,
  otpBackupCodesRemaining: 0,
  theme: null,
  streamQuota: 0,
  compositorQuota: 0,
  avatar: null,
  createdAt: '2026-01-01',
  lastLoginAt: null,
}

function renderDialog(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <MemoryRouter>
      <AuthProvider>
        <EditProfileDialog open onOpenChange={() => {}} />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('EditProfileDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('changes the password when the current one is right', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me' && (!init || init.method === undefined)) return jsonResponse({ user: baseUser })
      if (url === '/api/auth/me' && init?.method === 'PATCH') return jsonResponse({ user: baseUser })
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderDialog(fetchMock)
    await waitFor(() => expect(screen.getByLabelText('Current password')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Current password'), 'correct-horse-1')
    await userEvent.type(screen.getByLabelText('New password'), 'new-horse-battery-2')
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'new-horse-battery-2')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Password changed.')).toBeInTheDocument()
  })

  it('starts two-factor setup, enables it with a real code, and reveals backup codes once', async () => {
    let currentUser = baseUser
    const backupCodes = Array.from({ length: 10 }, (_, i) => `code-${i}`)
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me' && (!init || init.method === undefined)) return jsonResponse({ user: currentUser })
      if (url === '/api/two-factor/setup' && init?.method === 'POST') {
        return jsonResponse({ otpSecret: 'ABCDEFGHIJKLMNOP', qrCodeSvg: '<svg data-testid="qr"></svg>' })
      }
      if (url === '/api/two-factor/enable' && init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({ code: '123456' })
        currentUser = { ...baseUser, otpEnabled: true, otpBackupCodesRemaining: 10 }
        return jsonResponse({ user: currentUser, backupCodes })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderDialog(fetchMock)
    await waitFor(() => expect(screen.getByText('Two-factor authentication is off.')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor authentication' }))
    expect(await screen.findByText('ABCDEFGHIJKLMNOP')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('6-digit code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }))

    // The reveal-once panel, not the normal "on" view, right after enabling.
    for (const code of backupCodes) {
      expect(await screen.findByText(code)).toBeInTheDocument()
    }
    expect(screen.queryByText(/backup codes remaining/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: "I've saved these" }))
    expect(await screen.findByText('10 backup codes remaining.', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText(backupCodes[0])).not.toBeInTheDocument()
  })

  it('shows the disable form when two-factor is already on, and requires the current password', async () => {
    const onUser = { ...baseUser, otpEnabled: true, otpBackupCodesRemaining: 7 }
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me' && (!init || init.method === undefined)) return jsonResponse({ user: onUser })
      if (url === '/api/two-factor/disable' && init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({ currentPassword: 'correct-horse-1' })
        return jsonResponse({ user: baseUser })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderDialog(fetchMock)
    await waitFor(() => expect(screen.getByText('7 backup codes remaining.', { exact: false })).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Confirm your password to disable it'), 'correct-horse-1')
    await userEvent.click(screen.getByRole('button', { name: 'Disable two-factor authentication' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/two-factor/disable')
      expect(call).toBeTruthy()
    })
  })

  it('regenerates backup codes with password confirmation, revealing the new set', async () => {
    const onUser = { ...baseUser, otpEnabled: true, otpBackupCodesRemaining: 3 }
    const newCodes = ['fresh-1', 'fresh-2']
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me' && (!init || init.method === undefined)) return jsonResponse({ user: onUser })
      if (url === '/api/two-factor/backup-codes' && init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({ currentPassword: 'correct-horse-1' })
        return jsonResponse({ user: { ...onUser, otpBackupCodesRemaining: 10 }, backupCodes: newCodes })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderDialog(fetchMock)
    await waitFor(() => expect(screen.getByText('3 backup codes remaining.', { exact: false })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate backup codes' }))
    await userEvent.type(screen.getByLabelText('Confirm your password to regenerate backup codes'), 'correct-horse-1')
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    for (const code of newCodes) {
      expect(await screen.findByText(code)).toBeInTheDocument()
    }
  })

  it('refuses to regenerate with the wrong password, without revealing anything', async () => {
    const onUser = { ...baseUser, otpEnabled: true, otpBackupCodesRemaining: 5 }
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me' && (!init || init.method === undefined)) return jsonResponse({ user: onUser })
      if (url === '/api/two-factor/backup-codes' && init?.method === 'POST') return jsonResponse({ error: 'Current password is incorrect.' }, 401)
      throw new Error(`unexpected fetch ${url} ${init?.method}`)
    })
    renderDialog(fetchMock)
    await waitFor(() => expect(screen.getByText('5 backup codes remaining.', { exact: false })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate backup codes' }))
    await userEvent.type(screen.getByLabelText('Confirm your password to regenerate backup codes'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.')
  })
})
