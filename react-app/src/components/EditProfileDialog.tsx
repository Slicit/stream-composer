import { useState, type FormEvent } from 'react'
import { api, ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { AvatarCropField } from '@/components/AvatarCropField'
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

// The account dropdown's "Edit" action: an avatar upload (see
// AvatarCropField), two-factor setup/disable, and a password change (see
// Api::AuthController#update_me — username/role/quota stay
// administrator-only).
export function EditProfileDialog({ open, onOpenChange }: EditProfileDialogProps) {
  const { user, refresh } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [otpSecret, setOtpSecret] = useState<string | null>(null)
  const [qrCodeSvg, setQrCodeSvg] = useState<string | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpSubmitting, setOtpSubmitting] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [disableError, setDisableError] = useState<string | null>(null)
  const [disabling, setDisabling] = useState(false)

  // Set once right after #enable or a regenerate succeeds — the only
  // time these are ever shown in plaintext, so this dialog is the one
  // place in the app that ever holds them.
  const [revealedBackupCodes, setRevealedBackupCodes] = useState<string[] | null>(null)
  const [regeneratingCodes, setRegeneratingCodes] = useState(false)
  const [regeneratePassword, setRegeneratePassword] = useState('')
  const [regenerateError, setRegenerateError] = useState<string | null>(null)
  const [regenerateSubmitting, setRegenerateSubmitting] = useState(false)

  function reset() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setSuccess(false)
    resetTwoFactorSetup()
    setDisablePassword('')
    setDisableError(null)
    setRevealedBackupCodes(null)
    setRegeneratingCodes(false)
    setRegeneratePassword('')
    setRegenerateError(null)
  }

  function resetTwoFactorSetup() {
    setOtpSecret(null)
    setQrCodeSvg(null)
    setOtpCode('')
    setOtpError(null)
  }

  async function startTwoFactorSetup() {
    setOtpError(null)
    try {
      const data = await api.post<{ otpSecret: string; qrCodeSvg: string }>('/api/two-factor/setup')
      setOtpSecret(data.otpSecret)
      setQrCodeSvg(data.qrCodeSvg)
    } catch (err) {
      setOtpError(err instanceof ApiError ? err.message : 'Could not start two-factor setup.')
    }
  }

  async function enableTwoFactor(e: FormEvent) {
    e.preventDefault()
    setOtpError(null)
    setOtpSubmitting(true)
    try {
      const data = await api.post<{ backupCodes: string[] }>('/api/two-factor/enable', { code: otpCode })
      await refresh()
      resetTwoFactorSetup()
      setRevealedBackupCodes(data.backupCodes)
    } catch (err) {
      setOtpError(err instanceof ApiError ? err.message : 'Could not enable two-factor authentication.')
    } finally {
      setOtpSubmitting(false)
    }
  }

  async function regenerateBackupCodes(e: FormEvent) {
    e.preventDefault()
    setRegenerateError(null)
    setRegenerateSubmitting(true)
    try {
      const data = await api.post<{ backupCodes: string[] }>('/api/two-factor/backup-codes', { currentPassword: regeneratePassword })
      await refresh()
      setRegeneratingCodes(false)
      setRegeneratePassword('')
      setRevealedBackupCodes(data.backupCodes)
    } catch (err) {
      setRegenerateError(err instanceof ApiError ? err.message : 'Could not regenerate backup codes.')
    } finally {
      setRegenerateSubmitting(false)
    }
  }

  async function disableTwoFactor(e: FormEvent) {
    e.preventDefault()
    setDisableError(null)
    setDisabling(true)
    try {
      await api.post('/api/two-factor/disable', { currentPassword: disablePassword })
      await refresh()
      setDisablePassword('')
    } catch (err) {
      setDisableError(err instanceof ApiError ? err.message : 'Could not disable two-factor authentication.')
    } finally {
      setDisabling(false)
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
          <DialogDescription>Avatar, two-factor authentication and password.</DialogDescription>
        </DialogHeader>

        <div className="border-b pb-4">
          {user && (
            <AvatarCropField
              avatarUrl={user.avatar}
              username={user.username}
              uploadUrl="/api/auth/me/avatar"
              onUploaded={() => refresh()}
            />
          )}
        </div>

        <div className="flex flex-col gap-3 border-b pb-4">
          <Label>Two-factor authentication</Label>
          {revealedBackupCodes ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Save these backup codes somewhere safe — each one signs you in once if you lose access to your authenticator app.
                They won't be shown again.
              </p>
              <div className="grid grid-cols-2 gap-1.5 rounded-md bg-muted p-3 font-mono text-sm">
                {revealedBackupCodes.map((code) => (
                  <code key={code}>{code}</code>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setRevealedBackupCodes(null)} className="self-start">
                I've saved these
              </Button>
            </div>
          ) : user?.otpEnabled ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Two-factor authentication is on. {user.otpBackupCodesRemaining} backup {user.otpBackupCodesRemaining === 1 ? 'code' : 'codes'}{' '}
                remaining.
              </p>
              {regeneratingCodes ? (
                <form className="flex flex-col gap-3" onSubmit={regenerateBackupCodes}>
                  {regenerateError && (
                    <p className="text-sm text-destructive" role="alert">
                      {regenerateError}
                    </p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="regenerate-codes-password">Confirm your password to regenerate backup codes</Label>
                    <Input
                      id="regenerate-codes-password"
                      type="password"
                      value={regeneratePassword}
                      onChange={(e) => setRegeneratePassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">This replaces all existing backup codes — old ones stop working.</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRegeneratingCodes(false)
                        setRegeneratePassword('')
                        setRegenerateError(null)
                      }}
                      disabled={regenerateSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" variant="outline" size="sm" disabled={regenerateSubmitting}>
                      {regenerateSubmitting ? 'Regenerating…' : 'Regenerate'}
                    </Button>
                  </div>
                </form>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => setRegeneratingCodes(true)} className="self-start">
                  Regenerate backup codes
                </Button>
              )}
              <form className="flex flex-col gap-3 border-t pt-3" onSubmit={disableTwoFactor}>
                {disableError && (
                  <p className="text-sm text-destructive" role="alert">
                    {disableError}
                  </p>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="disable-2fa-password">Confirm your password to disable it</Label>
                  <Input
                    id="disable-2fa-password"
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <Button type="submit" variant="outline" size="sm" disabled={disabling} className="self-start">
                  {disabling ? 'Disabling…' : 'Disable two-factor authentication'}
                </Button>
              </form>
            </div>
          ) : otpSecret ? (
            <form className="flex flex-col gap-3" onSubmit={enableTwoFactor}>
              <p className="text-sm text-muted-foreground">Scan this code with your authenticator app, or enter the secret manually.</p>
              {qrCodeSvg && (
                <div
                  className="h-40 w-40 self-center [&_svg]:h-full [&_svg]:w-full"
                  // The server (rqrcode) renders a plain, non-interactive
                  // QR SVG from this account's own just-generated secret —
                  // no user-authored content ever reaches this markup.
                  dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
                />
              )}
              <code className="self-center rounded bg-muted px-2 py-1 text-xs">{otpSecret}</code>
              {otpError && (
                <p className="text-sm text-destructive" role="alert">
                  {otpError}
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="otp-code">6-digit code</Label>
                <Input
                  id="otp-code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={resetTwoFactorSetup} disabled={otpSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" variant="outline" size="sm" disabled={otpSubmitting}>
                  {otpSubmitting ? 'Enabling…' : 'Enable'}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Two-factor authentication is off.</p>
              {otpError && (
                <p className="text-sm text-destructive" role="alert">
                  {otpError}
                </p>
              )}
              <Button type="button" variant="outline" size="sm" onClick={startTwoFactorSetup} className="self-start">
                Enable two-factor authentication
              </Button>
            </>
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
