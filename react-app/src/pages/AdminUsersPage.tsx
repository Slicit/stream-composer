import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { Role, User } from '../api/types'

const ROLES: Role[] = ['viewer', 'streamer', 'admin']

export function AdminUsersPage() {
  const { user: currentUser } = useAuth()
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

  return (
    <section className="card">
      <h2>Users</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <form className="row" onSubmit={handleCreate} aria-label="Add a user">
        <label className="field">
          <span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {role === 'streamer' && (
          <label className="field">
            <span>Stream quota</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={streamQuota}
              onChange={(e) => setStreamQuota(Number(e.target.value))}
            />
          </label>
        )}
        <button type="submit" className="primary" disabled={creating}>
          Add user
        </button>
      </form>

      {users === null ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Stream quota</th>
              <th>Last signed in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>
                  <select value={u.role} onChange={(e) => updateRole(u.id, e.target.value as Role)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {u.role === 'streamer' ? (
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      defaultValue={u.streamQuota}
                      onBlur={(e) => {
                        const next = Number(e.target.value)
                        if (next !== u.streamQuota) updateQuota(u.id, next)
                      }}
                      aria-label={`Stream quota for ${u.username}`}
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}</td>
                <td>
                  <button
                    className="ghost danger"
                    onClick={() => remove(u.id)}
                    disabled={u.id === currentUser?.id}
                    title={u.id === currentUser?.id ? 'You cannot delete the account you are signed in with.' : 'Delete'}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
