import { useState, type FormEvent } from 'react'
import { api, ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

// The account dropdown's "Edit" action. Deliberately narrow — a password
// change only, matching what Api::AuthController#update_me actually
// supports (username/role/quota stay administrator-only, see that
// controller's own comment).
export function EditProfileDialog({ open, onOpenChange }: EditProfileDialogProps) {
  const { refresh } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setSuccess(false)
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
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Requires your current password.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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
