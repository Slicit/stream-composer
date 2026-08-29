import { useRef, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { api, ApiError } from '@/api/client'
import { cropImageToFile } from '@/lib/cropImage'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { User } from '@/api/types'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

interface AvatarCropFieldProps {
  avatarUrl: string | null
  username: string
  uploadUrl: string
  onUploaded: (user: User) => void
}

// The avatar picker/cropper, extracted out of EditProfileDialog so it can
// be reused for an admin uploading an avatar on someone else's behalf
// (AdminUserEditPage) — same cropping/upload logic either way, just a
// different target user and endpoint. Crops client-side with
// react-easy-crop so the server only ever receives a square image, never
// an arbitrary one it would have to reject or letterbox.
export function AvatarCropField({ avatarUrl, username, uploadUrl, onUploaded }: AvatarCropFieldProps) {
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  function resetPicker() {
    if (avatarSrc) URL.revokeObjectURL(avatarSrc)
    setAvatarSrc(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
    setError(null)
  }

  function pickFile(file: File) {
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError('Choose an image under 5MB.')
      return
    }
    if (avatarSrc) URL.revokeObjectURL(avatarSrc)
    setAvatarSrc(URL.createObjectURL(file))
    setCrop({ x: 0, y: 0 })
    setZoom(1)
  }

  async function save() {
    if (!avatarSrc || !croppedAreaPixels) return
    setError(null)
    setUploading(true)
    try {
      const cropped = await cropImageToFile(avatarSrc, croppedAreaPixels)
      if (cropped.size > MAX_AVATAR_BYTES) {
        setError('The cropped image is still over 5MB — try zooming in less.')
        return
      }
      const data = await api.putRaw<{ user: User }>(uploadUrl, cropped)
      onUploaded(data.user)
      resetPicker()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload the avatar.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Label>Avatar</Label>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {avatarSrc ? (
        <div className="flex flex-col gap-3">
          <div className="relative h-56 w-full overflow-hidden rounded-md bg-muted">
            <Cropper
              image={avatarSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_area, pixels) => setCroppedAreaPixels(pixels)}
            />
          </div>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="w-full"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={resetPicker} disabled={uploading}>
              Cancel
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={save} disabled={uploading || !croppedAreaPixels}>
              {uploading ? 'Uploading…' : 'Save avatar'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Avatar className="h-14 w-14">
            <AvatarImage src={avatarUrl ?? undefined} alt="" />
            <AvatarFallback>{initials(username)}</AvatarFallback>
          </Avatar>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) pickFile(file)
              e.target.value = ''
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            Change avatar
          </Button>
        </div>
      )}
    </div>
  )
}
