import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button } from '@/components/ui/button'

export function NavBar() {
  const { user, logout } = useAuth()

  return (
    <header className="sticky top-0 z-40 flex items-center gap-4 border-b bg-background/95 px-5 py-3 backdrop-blur">
      <span className="font-semibold tracking-tight">Stream Composer</span>
      <span className="flex-1" />
      <nav className="flex items-center gap-3 text-sm">
        {user?.role === 'admin' && (
          <Link to="/admin" className="text-muted-foreground hover:text-foreground">
            Admin
          </Link>
        )}
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
        {user ? (
          <>
            <span className="text-muted-foreground">{user.username}</span>
            <Button variant="ghost" size="sm" onClick={() => logout()}>
              Sign out
            </Button>
          </>
        ) : (
          <Link to="/login" className="text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        )}
      </nav>
    </header>
  )
}
