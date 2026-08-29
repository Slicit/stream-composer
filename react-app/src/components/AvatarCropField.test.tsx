import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AvatarCropField } from './AvatarCropField'
import type { User } from '@/api/types'

// react-easy-crop computes crop geometry off real layout (image
// dimensions, container size via ResizeObserver) that jsdom never
// produces, so onCropComplete never fires for real here — see
// browser-pane-no-render-frames: this class of thing needs a live
// browser, not a stubbed unit test, to verify the geometry itself. This
// mock instead fires it once on mount with a fixed area, so this file can
// verify the surrounding save/upload wiring, which is what actually
// matters at this layer.
//
// Must fire from an effect, not the render body: onCropComplete triggers
// a parent state update (setCroppedAreaPixels), which re-renders this
// mock — calling it unconditionally during render is an infinite
// render loop (caught live: it hung every test run and pegged a CPU
// core on the dev box until something killed it).
vi.mock('react-easy-crop', () => ({
  default: ({ onCropComplete }: { onCropComplete: (area: unknown, pixels: unknown) => void }) => {
    useEffect(() => {
      onCropComplete({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <div data-testid="mock-cropper" />
  },
}))

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const uploadedUser: User = {
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
  avatar: '/uploads/avatars/u1.png',
  createdAt: '2026-01-01',
  lastLoginAt: null,
}

// The actual pixel-cropping work (canvas draw + toBlob) needs a real
// canvas/image decode that jsdom doesn't provide — see cropImage.ts's own
// comment on why that logic is split out and separately unit-testable.
// Mocked here so this file can focus on the picker/upload wiring around it.
vi.mock('@/lib/cropImage', () => ({
  cropImageToFile: vi.fn(async () => new File(['cropped-bytes'], 'avatar.png', { type: 'image/png' })),
}))

function pngFile(name = 'photo.png', bytes = 100) {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

describe('AvatarCropField', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows initials when there is no avatar yet', () => {
    render(<AvatarCropField avatarUrl={null} username="alice" uploadUrl="/api/auth/me/avatar" onUploaded={vi.fn()} />)
    expect(screen.getByText('AL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change avatar' })).toBeInTheDocument()
  })

  it('rejects a non-image file without opening the cropper', async () => {
    render(<AvatarCropField avatarUrl={null} username="alice" uploadUrl="/api/auth/me/avatar" onUploaded={vi.fn()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    // userEvent.upload respects the input's own accept="image/*" and
    // would silently refuse to attach a non-matching file — firing the
    // change event directly exercises pickFile's own defense instead of
    // relying on the browser's file picker to have already filtered it.
    fireEvent.change(input, { target: { files: [new File(['not an image'], 'notes.txt', { type: 'text/plain' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an image file.')
  })

  it('rejects a file over 5MB without opening the cropper', async () => {
    render(<AvatarCropField avatarUrl={null} username="alice" uploadUrl="/api/auth/me/avatar" onUploaded={vi.fn()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, pngFile('huge.png', 5 * 1024 * 1024 + 1))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an image under 5MB.')
  })

  it('opens the cropper for a valid image and uploads to the given URL on save', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/admin/users/target-1/avatar' && init?.method === 'PUT') {
        return jsonResponse({ user: uploadedUser })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onUploaded = vi.fn()

    render(<AvatarCropField avatarUrl={null} username="alice" uploadUrl="/api/admin/users/target-1/avatar" onUploaded={onUploaded} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, pngFile())

    const saveButton = await screen.findByRole('button', { name: 'Save avatar' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    await userEvent.click(saveButton)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(uploadedUser))
  })
})
