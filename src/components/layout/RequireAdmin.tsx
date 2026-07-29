import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { usePermissions } from '../../hooks/usePermissions'

/**
 * Route guard for org-ADMIN-only pages. Sits inside ProtectedRoute, so the
 * caller is already authenticated by the time this renders.
 *
 * The role lives per-org (authStore.orgs[].role), so it isn't resolvable until
 * the store has hydrated — bounce only once loading has settled, otherwise a
 * refresh on an admin URL would redirect an admin away mid-hydration.
 */
export function RequireAdmin() {
  const isLoading = useAuthStore((s) => s.isLoading)
  const orgs = useAuthStore((s) => s.orgs)
  const { isAdmin } = usePermissions()

  if (isLoading || orgs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
      </div>
    )
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
