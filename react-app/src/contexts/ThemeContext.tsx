import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// Keep in sync with index.css's [data-theme='...'] blocks and the
// blocking inline script in index.html (which reads the same storage key
// before first paint, to avoid a flash of the wrong theme).
export const THEMES = ['studio', 'legacy', 'aurora', 'onair'] as const
export type Theme = (typeof THEMES)[number]

export const THEME_LABELS: Record<Theme, string> = {
  studio: 'Studio',
  legacy: 'Legacy',
  aurora: 'Aurora',
  onair: 'On Air',
}

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
