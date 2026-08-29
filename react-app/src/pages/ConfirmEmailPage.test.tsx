import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ConfirmEmailPage } from './ConfirmEmailPage'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function renderPage(fetchMock: ReturnType<typeof vi.fn>, path: string) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ConfirmEmailPage />
    </MemoryRouter>,
  )
}

describe('ConfirmEmailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('confirms the token from the URL and shows the success message', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/confirm-email' && init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({ token: 'real-token' })
        return jsonResponse({ message: 'Email confirmed — you can now sign in.' })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock, '/confirm-email?token=real-token')

    expect(await screen.findByText('Email confirmed — you can now sign in.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows an error and a resend form for an invalid token', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/confirm-email') return jsonResponse({ error: 'This confirmation link is invalid or has expired.' }, 400)
      if (url === '/api/confirm-email/resend' && init?.method === 'POST') {
        return jsonResponse({ message: 'If that email has a pending registration, a new confirmation link is on its way.' })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock, '/confirm-email?token=garbage')

    expect(await screen.findByRole('alert')).toHaveTextContent('This confirmation link is invalid or has expired.')

    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Resend confirmation email' }))

    expect(await screen.findByText('If that email has a pending registration, a new confirmation link is on its way.')).toBeInTheDocument()
  })

  it('shows an error immediately when there is no token in the URL, without calling the server', async () => {
    const fetchMock = vi.fn((url: string) => {
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPage(fetchMock, '/confirm-email')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This confirmation link is missing its token.'))
  })

  // Regression: under StrictMode's dev-only double-invoked effect, the
  // confirm POST fired twice — the token is single-use, so the second
  // call failed and its error raced to overwrite the first call's real
  // success. Caught live in the browser, not by the tests above (none of
  // which render under StrictMode).
  it('confirms only once even under StrictMode double-invocation, and keeps the success result', async () => {
    let calls = 0
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/confirm-email' && init?.method === 'POST') {
        calls += 1
        return calls === 1
          ? jsonResponse({ message: 'Email confirmed — you can now sign in.' })
          : jsonResponse({ error: 'This confirmation link is invalid or has expired.' }, 400)
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/confirm-email?token=real-token']}>
          <ConfirmEmailPage />
        </MemoryRouter>
      </StrictMode>,
    )

    expect(await screen.findByText('Email confirmed — you can now sign in.')).toBeInTheDocument()
    await waitFor(() => expect(calls).toBe(1))
  })
})
