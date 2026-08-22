import { VenetianMask } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'

// Fixed to the bottom of every page, always visible, whenever an admin
// is impersonating someone — the one thing that must never be easy to
// miss, since it's the only visual cue distinguishing "I am this user"
// from "I am an admin looking at my own account". Uses the existing
// --success token (soft tint, not the saturated full-strength fill) —
// green reads as "safe/reversible", which is exactly what this is: one
// click undoes it.
export function ImpersonationBanner() {
  const { impersonatedBy, user, stopImpersonating } = useAuth()

  if (!impersonatedBy || !user) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 border-t border-success/30 bg-success/15 px-4 py-2 text-sm text-success">
      <VenetianMask className="h-4 w-4 shrink-0" />
      <span>
        Impersonating <strong className="font-semibold">{user.username}</strong>
        <span className="text-success/70"> — signed in as {impersonatedBy.username}</span>
      </span>
      <Button type="button" variant="outline" size="sm" className="border-success/40 text-success hover:bg-success/10" onClick={() => stopImpersonating()}>
        Stop impersonating
      </Button>
    </div>
  )
}
