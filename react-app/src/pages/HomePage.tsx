import { useAuth } from '../auth/AuthContext'

// Placeholder for the viewer page — see the open questions this phase
// ends on. Confirms auth wiring is real without pretending playback exists
// yet.
export function HomePage() {
  const { user, loading } = useAuth()

  if (loading) return <p className="page-loading">Loading…</p>

  return (
    <main className="wrap">
      <div className="card">
        <h1>Stream Composer</h1>
        {user ? <p>Signed in as {user.username} ({user.role}).</p> : <p>Not signed in.</p>}
        <p className="hint">The viewer/player page is not built yet — see the open questions.</p>
      </div>
    </main>
  )
}
