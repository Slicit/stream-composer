import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { User } from '../api/types'

// Either a completed sign-in (twoFactorRequired: false, user state is
// already updated) or a pending second factor (twoFactorRequired: true,
// challengeToken to pass to verifyTwoFactor) — see
// Api::AuthController#login's own two-shape response.
export type LoginResult = { twoFactorRequired: false } | { twoFactorRequired: true; challengeToken: string }

interface AuthState {
  user: User | null
  // Set only while an admin is impersonating this session's user — the
  // admin who started it (Api::AuthController#me's impersonatedBy).
  impersonatedBy: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<LoginResult>
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<void>
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

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const data = await api.post<{ user?: User; twoFactorRequired?: boolean; challengeToken?: string }>('/api/auth/login', {
      username,
      password,
    })
    if (data.twoFactorRequired) {
      return { twoFactorRequired: true, challengeToken: data.challengeToken! }
    }
    setUser(data.user!)
    setImpersonatedBy(null) // a fresh login is never mid-impersonation
    return { twoFactorRequired: false }
  }, [])

  const verifyTwoFactor = useCallback(async (challengeToken: string, code: string) => {
    const data = await api.post<{ user: User }>('/api/auth/login/verify-2fa', { challengeToken, code })
    setUser(data.user)
    setImpersonatedBy(null)
  }, [])

  const logout = useCallback(async () => {
    await api.delete('/api/auth/logout')
    setUser(null)
    setImpersonatedBy(null)
  }, [])

  const stopImpersonating = useCallback(async () => {
    const data = await api.delete<{ user: User }>('/api/auth/impersonate')
    setUser(data.user)
    setImpersonatedBy(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, impersonatedBy, loading, login, verifyTwoFactor, logout, refresh, stopImpersonating }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
