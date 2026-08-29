import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2, VenetianMask } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { Role, User } from '@/api/types'
import { AvatarCropField } from '@/components/AvatarCropField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

const ROLES: Role[] = ['viewer', 'streamer', 'admin']

// The admin full edit page for any user — /admin/users/:id. Mirrors
// AdminChannelEditPage's shape (load, PATCH-on-change, a delete action).
export function AdminUserEditPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)

  const [resettingTwoFactor, setResettingTwoFactor] = useState(false)

  async function load() {
    try {
      const data = await api.get<{ user: User }>(`/api/admin/users/${id}`)
      setUser(data.user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this user.')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function update(patch: Record<string, unknown>) {
    setError(null)
    try {
      const data = await api.patch<{ user: User }>(`/api/admin/users/${id}`, patch)
      setUser(data.user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this user.')
    }
  }

  async function setPassword() {
    if (!newPassword) return
    setError(null)
    setPasswordMessage(null)
    setSettingPassword(true)
    try {
      await api.patch(`/api/admin/users/${id}`, { password: newPassword })
      setNewPassword('')
      setPasswordMessage('Password changed.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password.')
    } finally {
      setSettingPassword(false)
    }
  }

  async function resetTwoFactor() {
    if (!confirm(`Reset two-factor authentication for ${user?.username}? They will be able to sign in without a code until they set it up again.`)) return
    setError(null)
    setResettingTwoFactor(true)
    try {
      const data = await api.post<{ user: User }>(`/api/admin/users/${id}/reset-2fa`)
      setUser(data.user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset two-factor authentication.')
    } finally {
      setResettingTwoFactor(false)
    }
  }

  async function impersonate() {
    setError(null)
    try {
      await api.post(`/api/admin/users/${id}/impersonate`)
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not impersonate this user.')
    }
  }

  async function remove() {
    if (!confirm('Delete this user?')) return
    setError(null)
    try {
      await api.delete(`/api/admin/users/${id}`)
      navigate('/admin')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the user.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{user?.username ?? 'User'}</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {!user ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <h3 className="text-lg font-semibold">Identity & access</h3>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-role">Role</Label>
                  <Select value={user.role} onValueChange={(next) => update({ role: next })}>
                    <SelectTrigger id="edit-role" aria-label={`Role for ${user.username}`} className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {user.role === 'streamer' && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-stream-quota">Stream quota</Label>
                    <Input
                      id="edit-stream-quota"
                      type="number"
                      min={0}
                      max={1000}
                      className="w-24"
                      defaultValue={user.streamQuota}
                      onBlur={(e) => {
                        const next = Number(e.target.value)
                        if (next !== user.streamQuota) update({ streamQuota: next })
                      }}
                    />
                  </div>
                )}
                {user.role !== 'admin' && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-compositor-quota">Compositor quota</Label>
                    <Input
                      id="edit-compositor-quota"
                      type="number"
                      min={0}
                      max={20}
                      className="w-24"
                      defaultValue={user.compositorQuota}
                      onBlur={(e) => {
                        const next = Number(e.target.value)
                        if (next !== user.compositorQuota) update({ compositorQuota: next })
                      }}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label>Email</Label>
                  {user.email ? (
                    <div className="flex h-9 items-center gap-2">
                      <span>{user.email}</span>
                      <Badge variant={user.emailConfirmed ? 'default' : 'secondary'}>{user.emailConfirmed ? 'confirmed' : 'unconfirmed'}</Badge>
                    </div>
                  ) : (
                    <span className="flex h-9 items-center text-muted-foreground">—</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3 border-t pt-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-new-password">Reset password</Label>
                  <Input
                    id="edit-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    className="w-64"
                  />
                </div>
                <Button type="button" variant="outline" onClick={setPassword} disabled={settingPassword || !newPassword}>
                  {settingPassword ? 'Saving…' : 'Set password'}
                </Button>
                {passwordMessage && <span className="text-sm text-success">{passwordMessage}</span>}
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="mb-4 text-lg font-semibold">Avatar</h3>
              <AvatarCropField
                avatarUrl={user.avatar}
                username={user.username}
                uploadUrl={`/api/admin/users/${id}/avatar`}
                onUploaded={(updated) => setUser(updated)}
              />
            </div>

            <div className="flex flex-col gap-3 border-t pt-6">
              <h3 className="text-lg font-semibold">Two-factor authentication</h3>
              <div className="flex items-center gap-3">
                <Badge variant={user.otpEnabled ? 'default' : 'secondary'}>{user.otpEnabled ? 'on' : 'off'}</Badge>
                <Button type="button" variant="outline" size="sm" onClick={resetTwoFactor} disabled={!user.otpEnabled || resettingTwoFactor}>
                  {resettingTwoFactor ? 'Resetting…' : 'Reset two-factor authentication'}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">Clears their code and unlocks sign-in without one — use this if they're locked out.</p>
            </div>

            <div className="flex items-center gap-2 border-t pt-6">
              <Button variant="outline" onClick={impersonate}>
                <VenetianMask className="mr-2 h-4 w-4" />
                Impersonate this user
              </Button>
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={remove}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete user
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
