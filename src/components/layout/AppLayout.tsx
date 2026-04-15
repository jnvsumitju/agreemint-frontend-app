import { Link, NavLink, Outlet } from 'react-router-dom'
import { NotificationBell } from './NotificationBell'
import { OrgSwitcher } from './OrgSwitcher'
import { UserMenu } from './UserMenu'

const navLinks = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/', label: 'Templates' },
  { to: '/marketplace', label: 'Marketplace' },
]

export function AppLayout() {
  return (
    <div className="flex h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Top navigation bar */}
      <header className="flex h-14 shrink-0 items-center border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
        {/* Left: logo */}
        <Link
          to="/"
          className="mr-8 text-lg font-bold text-violet-600 dark:text-violet-400"
        >
          Agreemint
        </Link>

        {/* Center: nav links */}
        <nav className="flex items-center gap-1">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        {/* Right: org switcher + user menu */}
        <div className="ml-auto flex items-center gap-3">
          <NotificationBell />
          <OrgSwitcher />
          <UserMenu />
        </div>
      </header>

      {/* Main content area */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
