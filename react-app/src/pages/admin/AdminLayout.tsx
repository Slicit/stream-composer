import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/admin', label: 'Users', end: true },
  { to: '/admin/streams', label: 'Streams' },
  { to: '/admin/relays', label: 'Relays' },
  { to: '/admin/channels', label: 'Channels' },
  { to: '/admin/stats', label: 'Server & Stats' },
]

export function AdminLayout() {
  return (
    <div className="w-full">
      <nav className="mb-4 flex gap-1 border-b">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
