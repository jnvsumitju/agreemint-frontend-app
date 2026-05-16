import { Link, NavLink, Outlet } from 'react-router-dom'
import { NotificationBell } from './NotificationBell'
import { OrgSwitcher } from './OrgSwitcher'
import { UserMenu } from './UserMenu'
import { Breadcrumb } from './Breadcrumb'
import { CommandPalette } from './CommandPalette'
import { AnnouncementBanner } from '../AnnouncementBanner'

const navLinks = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/products', label: 'Products' },
  { to: '/', label: 'Templates' },
  { to: '/documents', label: 'Documents' },
  { to: '/marketplace', label: 'Marketplace' },
]

export function AppLayout() {
  return (
    <div className="flex h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Top navigation bar */}
      <header className="flex h-14 shrink-0 items-center border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
        {/* Left: logo */}
        <Link to="/" className="mr-8 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
          </div>
          <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Crixaa</span>
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

        {/* Right: search hint + notifications + org + user */}
        <div className="ml-auto flex items-center gap-3">
          {/* Cmd+K shortcut hint */}
          <button
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
            }}
            className="hidden items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:border-zinc-300 hover:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600 sm:flex"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <span>Search</span>
            <kbd className="rounded border border-zinc-300 px-1 py-0.5 text-[10px] font-medium dark:border-zinc-600">
              ⌘K
            </kbd>
          </button>

          <NotificationBell />
          <OrgSwitcher />
          <UserMenu />
        </div>
      </header>

      {/* Staff-authored announcements — rendered just below the header
          so they're the first thing users see. Dismissed IDs persist in
          localStorage so acknowledging a banner sticks across reloads. */}
      <AnnouncementBanner />

      {/* Breadcrumb */}
      <Breadcrumb />

      {/* Main content area */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {/* Command Palette (rendered globally, opens with Cmd+K) */}
      <CommandPalette />
    </div>
  )
}
