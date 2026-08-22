import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function NavBar() {
  const { user, logout } = useAuth()

  return (
    <header className="topbar">
      <div className="brand">
        <span>Stream Composer</span>
      </div>
      <span className="spacer" />
      <nav className="row">
        {user?.role === 'admin' && <Link to="/admin">Admin</Link>}
        {(user?.role === 'streamer' || user?.role === 'admin') && <Link to="/streamer">My streams</Link>}
        {user && <Link to="/channels">My channels</Link>}
        {user ? (
          <>
            <span className="username">{user.username}</span>
            <button className="ghost" onClick={() => logout()}>
              Sign out
            </button>
          </>
        ) : (
          <Link to="/login">Sign in</Link>
        )}
      </nav>
    </header>
  )
}
