import { useRef, useState, type FormEvent } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { api, ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { cropImageToFile } from '@/lib/cropImage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface EditProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

// The account dropdown's "Edit" action: a password change (see
// Api::AuthController#update_me — username/role/quota stay
// administrator-only) plus a self-service avatar upload, cropped
// client-side with react-easy-crop so the server only ever receives a
// square image, never an arbitrary one it would have to reject or
// letterbox.
export function EditProfileDialog({ open, onOpenChange }: EditProfileDialogProps) {
  const { user, refresh } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  function reset() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setSuccess(false)
    resetAvatarPicker()
  }

  function resetAvatarPicker() {
    if (avatarSrc) URL.revokeObjectURL(avatarSrc)
    setAvatarSrc(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
    setAvatarError(null)
  }

  function pickAvatarFile(file: File) {
    setAvatarError(null)
    if (!file.type.startsWith('image/')) {
      setAvatarError('Choose an image file.')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('Choose an image under 5MB.')
      return
    }
    if (avatarSrc) URL.revokeObjectURL(avatarSrc)
    setAvatarSrc(URL.createObjectURL(file))
    setCrop({ x: 0, y: 0 })
    setZoom(1)
  }

  async function saveAvatar() {
    if (!avatarSrc || !croppedAreaPixels) return
    setAvatarError(null)
    setUploadingAvatar(true)
    try {
      const cropped = await cropImageToFile(avatarSrc, croppedAreaPixels)
      if (cropped.size > MAX_AVATAR_BYTES) {
        setAvatarError('The cropped image is still over 5MB — try zooming in less.')
        return
      }
      await api.putRaw('/api/auth/me/avatar', cropped)
      await refresh()
      resetAvatarPicker()
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : 'Could not upload the avatar.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      await api.patch('/api/auth/me', { currentPassword, newPassword })
      await refresh()
      setSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>Avatar and password.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 border-b pb-4">
          <Label>Avatar</Label>
          {avatarError && (
            <p className="text-sm text-destructive" role="alert">
              {avatarError}
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
                <Button type="button" variant="outline" size="sm" onClick={resetAvatarPicker} disabled={uploadingAvatar}>
                  Cancel
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={saveAvatar} disabled={uploadingAvatar || !croppedAreaPixels}>
                  {uploadingAvatar ? 'Uploading…' : 'Save avatar'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Avatar className="h-14 w-14">
                <AvatarImage src={user?.avatar ?? undefined} alt="" />
                <AvatarFallback>{user ? initials(user.username) : ''}</AvatarFallback>
              </Avatar>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) pickAvatarFile(file)
                  e.target.value = ''
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                Change avatar
              </Button>
            </div>
          )}
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <p className="text-sm font-medium">Change password</p>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {success && <p className="text-sm text-success">Password changed.</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-current-password">Current password</Label>
            <Input
              id="edit-current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-new-password">New password</Label>
            <Input
              id="edit-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-confirm-password">Repeat new password</Label>
            <Input
              id="edit-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <DialogFooter>
            <Button type="submit" variant="outline" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
