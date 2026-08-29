import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { RegisterPage } from './RegisterPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function renderPage(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthProvider>
        <RegisterPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('registers and shows the check-your-email message, without signing in', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return jsonResponse({ user: null })
      if (url === '/api/register') return jsonResponse({ message: 'Check newperson@example.com to confirm your account before signing in.' }, 201)
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock)
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Username'), 'newperson')
    await userEvent.type(screen.getByLabelText('Email'), 'newperson@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-1')
    await userEvent.type(screen.getByLabelText('Repeat password'), 'correct-horse-1')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Check newperson@example.com to confirm your account before signing in.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
  })

  it('refuses to submit when the passwords do not match, without calling the server', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return jsonResponse({ user: null })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock)
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Username'), 'newperson')
    await userEvent.type(screen.getByLabelText('Email'), 'newperson@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-1')
    await userEvent.type(screen.getByLabelText('Repeat password'), 'different-1')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.')
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/register')).toBe(false)
  })

  it('shows the server error on a duplicate username', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return jsonResponse({ user: null })
      if (url === '/api/register') return jsonResponse({ error: 'Username is already taken' }, 400)
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock)
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Username'), 'taken')
    await userEvent.type(screen.getByLabelText('Email'), 'taken@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-1')
    await userEvent.type(screen.getByLabelText('Repeat password'), 'correct-horse-1')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Username is already taken')
  })
})
