import { useAuth } from '../auth/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Placeholder for the viewer page — see the open questions this phase
// ends on. Confirms auth wiring is real without pretending playback exists
// yet.
export function HomePage() {
  const { user, loading } = useAuth()

  if (loading) return <p className="p-8 text-center text-muted-foreground">Loading…</p>

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Stream Composer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {user ? (
            <p>
              Signed in as {user.username} ({user.role}).
            </p>
          ) : (
            <p>Not signed in.</p>
          )}
          <p className="text-sm text-muted-foreground">The viewer/player page is not built yet — see the open questions.</p>
        </CardContent>
      </Card>
    </main>
  )
}
