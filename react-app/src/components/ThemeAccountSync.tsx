import { useEffect, useRef } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'

// No visual output — applies a signed-in account's stored theme (if it
// has one) once per sign-in, so the preference follows the account
// across devices/browsers rather than only living in this browser's
// localStorage. Fires once per distinct user id, not on every render, so
// it never fights a theme the user picks again later in the same
// session — ThemeSwitcher owns persisting further changes back to the
// account from that point on.
export function ThemeAccountSync() {
  const { user } = useAuth()
  const { theme, setTheme } = useTheme()
  const syncedUserId = useRef<string | null>(null)

  useEffect(() => {
    if (!user) {
      syncedUserId.current = null
      return
    }
    if (syncedUserId.current === user.id) return
    syncedUserId.current = user.id
    if (user.theme && user.theme !== theme) {
      setTheme(user.theme)
    }
    // Only re-run when the signed-in user identity changes — theme/setTheme
    // intentionally excluded so a later manual switch doesn't re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  return null
}
