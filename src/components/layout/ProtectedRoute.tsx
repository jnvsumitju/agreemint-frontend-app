import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { ClaimTryTemplate } from '../try/ClaimTryTemplate'

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading...</span>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // Mounted here, once, rather than on a dedicated route: a template edited
  // anonymously has to be rescued whichever way the visitor ended up with a
  // session, and registration, email verification, OAuth and plain login all
  // land somewhere different. It renders nothing unless there is a claim
  // waiting on disk.
  return (
    <>
      <ClaimTryTemplate />
      <Outlet />
    </>
  )
}
