import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useViewerState } from './useViewerState'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('useViewerState', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the state from GET /api/state', async () => {
    const state = {
      settings: { publicViewing: false, homepageChannelSlug: '' },
      program: { mode: 'web', ready: false, width: 1920, height: 1080, gapPx: 4 },
      layout: null,
      onAir: [],
      streams: [],
      serverTime: '2026-01-01T00:00:00Z',
    }
    const fetchMock = vi.fn(() => jsonResponse(state))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useViewerState())

    await waitFor(() => expect(result.current.state).not.toBeNull())
    expect(result.current.state).toEqual(state)
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/state', { credentials: 'include' })
  })

  it('surfaces an error and keeps polling when the request fails', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 503 })))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useViewerState())

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.state).toBeNull()
  })
})
