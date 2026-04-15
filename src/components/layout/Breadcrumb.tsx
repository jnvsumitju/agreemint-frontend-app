import { Link, useLocation } from 'react-router-dom'

const routeLabels: Record<string, string> = {
  '/': 'Templates',
  '/dashboard': 'Dashboard',
  '/profile': 'Profile',
  '/settings': 'Settings',
  '/marketplace': 'Marketplace',
  '/notifications': 'Notifications',
}

export function Breadcrumb() {
  const { pathname, search } = useLocation()

  const label = routeLabels[pathname]
  if (!label) return null // don't show for unknown routes

  // Settings sub-tabs
  const params = new URLSearchParams(search)
  const tab = params.get('tab')
  const tabLabel = tab === 'members' ? 'Members' : tab === 'org' ? 'Organization' : tab === 'preferences' ? 'Preferences' : null

  return (
    <nav aria-label="Breadcrumb" className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
      <ol className="mx-auto flex max-w-6xl items-center gap-1.5 text-sm">
        <li>
          <Link to="/" className="text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
          </Link>
        </li>

        <li className="text-zinc-300 dark:text-zinc-600">/</li>

        {tabLabel ? (
          <>
            <li>
              <Link to={pathname} className="text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
                {label}
              </Link>
            </li>
            <li className="text-zinc-300 dark:text-zinc-600">/</li>
            <li className="font-medium text-zinc-700 dark:text-zinc-200">{tabLabel}</li>
          </>
        ) : (
          <li className="font-medium text-zinc-700 dark:text-zinc-200">{label}</li>
        )}
      </ol>
    </nav>
  )
}
