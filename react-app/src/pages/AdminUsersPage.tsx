import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, VenetianMask } from 'lucide-react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { Role, User } from '../api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const ROLES: Role[] = ['viewer', 'streamer', 'admin']

function RoleSelect({ value, onChange, label }: { value: Role; onChange: (role: Role) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)}>
      <SelectTrigger aria-label={label} className="w-32">
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
  )
}

export function AdminUsersPage() {
  const { user: currentUser, refresh } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [streamQuota, setStreamQuota] = useState(0)
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const data = await api.get<{ users: User[] }>('/api/admin/users')
      setUsers(data.users)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load users.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCreating(true)
    try {
      await api.post('/api/admin/users', { username, password, role, streamQuota: role === 'streamer' ? streamQuota : undefined })
      setUsername('')
      setPassword('')
      setRole('viewer')
      setStreamQuota(0)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the user.')
    } finally {
      setCreating(false)
    }
  }

  async function updateRole(id: string, nextRole: Role) {
    setError(null)
    try {
      await api.patch(`/api/admin/users/${id}`, { role: nextRole })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the role.')
    }
  }

  async function updateQuota(id: string, quota: number) {
    setError(null)
    try {
      await api.patch(`/api/admin/users/${id}`, { streamQuota: quota })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the quota.')
    }
  }

  async function toggleCompositor(id: string, canUseCompositor: boolean) {
    setError(null)
    try {
      await api.patch(`/api/admin/users/${id}`, { canUseCompositor })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change compositor access.')
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this user?')) return
    setError(null)
    try {
      await api.delete(`/api/admin/users/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the user.')
    }
  }

  async function impersonate(id: string) {
    setError(null)
    try {
      await api.post(`/api/admin/users/${id}/impersonate`)
      await refresh()
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not impersonate this user.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate} aria-label="Add a user">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-username">Username</Label>
            <Input id="new-username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">Password</Label>
            <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <RoleSelect value={role} onChange={setRole} label="Role for the new user" />
          </div>
          {role === 'streamer' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-quota">Stream quota</Label>
              <Input
                id="new-quota"
                type="number"
                min={0}
                max={1000}
                className="w-24"
                value={streamQuota}
                onChange={(e) => setStreamQuota(Number(e.target.value))}
              />
            </div>
          )}
          <Button type="submit" variant="outline" disabled={creating}>
            Add user
          </Button>
        </form>

        {users === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Stream quota</TableHead>
                <TableHead>Compositor</TableHead>
                <TableHead>Last signed in</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.username}</TableCell>
                  <TableCell>
                    <RoleSelect value={u.role} onChange={(next) => updateRole(u.id, next)} label={`Role for ${u.username}`} />
                  </TableCell>
                  <TableCell>
                    {u.role === 'streamer' ? (
                      <Input
                        type="number"
                        min={0}
                        max={1000}
                        className="w-24"
                        defaultValue={u.streamQuota}
                        onBlur={(e) => {
                          const next = Number(e.target.value)
                          if (next !== u.streamQuota) updateQuota(u.id, next)
                        }}
                        aria-label={`Stream quota for ${u.username}`}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={u.canUseCompositor}
                      onCheckedChange={(checked) => toggleCompositor(u.id, checked)}
                      aria-label={`Compositor access for ${u.username}`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => impersonate(u.id)}
                      disabled={u.id === currentUser?.id}
                      title={u.id === currentUser?.id ? 'You are already signed in as yourself.' : `Impersonate ${u.username}`}
                    >
                      <VenetianMask className="h-4 w-4" />
                      <span className="sr-only">Impersonate {u.username}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(u.id)}
                      disabled={u.id === currentUser?.id}
                      title={u.id === currentUser?.id ? 'You cannot delete the account you are signed in with.' : 'Delete'}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
