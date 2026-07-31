import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { usePlan } from '../../hooks/usePlan'

/**
 * Route guard for pages that require Starter or above.
 *
 * <p>Sits inside ProtectedRoute, so the caller is already authenticated. It
 * exists because hiding a nav link is not hiding a page: the route stays
 * reachable by URL, by a bookmark, and by the command palette, so a link
 * removed from the header alone only stops people who were not looking.
 *
 * <p>Mirrors {@code RequireAdmin} in waiting for hydration first. The plan
 * comes from the current org, which is null until the store settles, so
 * bouncing early would redirect a paying customer away from their own page on
 * every refresh.
 */
export function RequirePaidPlan() {
  const isLoading = useAuthStore((s) => s.isLoading)
  const org = useAuthStore((s) => s.org)
  const { isFree } = usePlan()

  if (isLoading || !org) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
      </div>
    )
  }

  if (isFree) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
