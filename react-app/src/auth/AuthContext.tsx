import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { User } from '../api/types'

interface AuthState {
  user: User | null
  // Set only while an admin is impersonating this session's user — the
  // admin who started it (Api::AuthController#me's impersonatedBy).
  impersonatedBy: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  stopImpersonating: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [impersonatedBy, setImpersonatedBy] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const data = await api.get<{ user: User | null; impersonatedBy: User | null }>('/api/auth/me')
    setUser(data.user)
    setImpersonatedBy(data.impersonatedBy ?? null)
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post<{ user: User }>('/api/auth/login', { username, password })
    setUser(data.user)
    setImpersonatedBy(null) // a fresh login is never mid-impersonation
  }, [])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    setUser(null)
    setImpersonatedBy(null)
  }, [])

  const stopImpersonating = useCallback(async () => {
    const data = await api.delete<{ user: User }>('/api/auth/impersonate')
    setUser(data.user)
    setImpersonatedBy(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, impersonatedBy, loading, login, logout, refresh, stopImpersonating }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
