import { useState } from 'react'
import { Pencil, LogOut } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EditProfileDialog } from '@/components/EditProfileDialog'

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

// The top-right account control: avatar + name, opening a dropdown with
// a small user card (username/role), an edit action (password change —
// see EditProfileDialog), and sign out.
export function UserMenu() {
  const { user, logout } = useAuth()
  const [editOpen, setEditOpen] = useState(false)

  if (!user) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm hover:bg-accent">
            <Avatar className="h-7 w-7">
              <AvatarFallback>{initials(user.username)}</AvatarFallback>
            </Avatar>
            <span className="max-w-32 truncate">{user.username}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
            <Avatar className="h-9 w-9">
              <AvatarFallback>{initials(user.username)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{user.username}</span>
              <span className="text-xs capitalize text-muted-foreground">{user.role}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => logout()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditProfileDialog open={editOpen} onOpenChange={setEditOpen} />
    </>
  )
}
