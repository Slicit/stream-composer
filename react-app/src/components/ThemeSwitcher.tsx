import { Palette } from 'lucide-react'
import { THEMES, type Theme } from '@/api/types'
import { THEME_LABELS, useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/auth/AuthContext'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// A visual preference, not a security-sensitive account setting —
// available to anyone, signed in or not, so it lives directly in NavBar
// rather than inside UserMenu (which renders nothing when signed out).
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const { user, refresh } = useAuth()

  async function handleChange(next: Theme) {
    setTheme(next)
    if (!user) return
    // Best-effort: the theme has already applied locally regardless of
    // whether this succeeds, so a transient failure here just means the
    // choice doesn't follow this account to another device yet — not
    // worth interrupting the UI over.
    try {
      await api.patch('/api/auth/me/theme', { theme: next })
      await refresh()
    } catch {
      /* applied locally either way */
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="Theme">
          <Palette className="h-4 w-4" />
          <span className="sr-only">Theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => handleChange(v as Theme)}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t} value={t}>
              {THEME_LABELS[t]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
