import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { UserMenu } from '@/components/UserMenu'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'

export function NavBar() {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-40 flex items-center gap-4 border-b bg-nav/95 text-nav-foreground px-5 py-3 backdrop-blur">
      <span className="font-semibold tracking-tight">Stream Composer</span>
      <span className="flex-1" />
      <nav className="flex items-center gap-3 text-sm">
        {(user?.role === 'streamer' || user?.role === 'admin') && (
          <Link to="/streamer" className="text-muted-foreground hover:text-foreground">
            My streams
          </Link>
        )}
        {user && (
          <Link to="/channels" className="text-muted-foreground hover:text-foreground">
            My channels
          </Link>
        )}
        <ThemeSwitcher />
        {user ? (
          <UserMenu />
        ) : (
          <Link to="/login" className="text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        )}
      </nav>
    </header>
  )
}
