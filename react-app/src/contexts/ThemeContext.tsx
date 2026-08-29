import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { THEMES, type Theme } from '@/api/types'

export const THEME_LABELS: Record<Theme, string> = {
  studio: 'Studio',
  legacy: 'Legacy',
  aurora: 'Aurora',
  onair: 'On Air',
}

// This is a same-device *cache* used only to paint the right theme
// before hydration (see index.html's blocking inline script, which reads
// the same key). The account is the actual source of truth for a
// signed-in user — see ThemeAccountSync, which applies User.theme on
// login, and ThemeSwitcher, which PATCHes /api/auth/me/theme on change.
// Signed-out browsing has nowhere else to keep the choice, so this stays
// the only persistence for that case.
const STORAGE_KEY = 'sc:theme'
const DEFAULT_THEME: Theme = 'studio'

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(loadTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  function setTheme(next: Theme) {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage unavailable (private browsing, quota) — the switch still applies this session */
    }
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
