import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { claimImpersonationHandoff, useAuthStore } from '../stores/authStore'

/**
 * Landing page for a staff-started support session.
 *
 * <p>The admin portal opens `/impersonate#token=…&sid=…`. The credential rides
 * in the fragment rather than the query string on purpose: fragments are never
 * sent to the server, so the token stays out of access logs, the Referer
 * header, and any proxy in between. It is stripped from the address bar before
 * anything else happens, so it does not sit in browser history either.
 */
export function ImpersonateHandoff() {
  const navigate = useNavigate()
  const adopt = useAuthStore((s) => s.adoptImpersonation)
  const [error, setError] = useState<string | null>(null)
  // React 18 StrictMode double-invokes effects; the fragment is consumed and
  // cleared on the first pass, so the second would find nothing and error.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const hash = window.location.hash.replace(/^#/, '')
    const params = new URLSearchParams(hash)
    const token = params.get('token')

    // Claimed before the fragment is even cleared, so App's root init() — which
    // fires on this same mount — stands down instead of racing us and restoring
    // whoever last logged into this browser.
    if (token) claimImpersonationHandoff()

    // Clear it immediately, before any await — a failed adopt must not leave
    // the credential sitting in the URL.
    window.history.replaceState(null, '', '/impersonate')

    // authFetch redirects here when a live session starts 401ing, which means
    // it was ended from the admin portal or ran out.
    if (hash === 'ended') {
      setError('This support session has ended. Start a new one from the admin portal.')
      return
    }

    if (!token) {
      setError('This link carries no session token. Start the session again from the admin portal.')
      return
    }

    void adopt(token).then((ok) => {
      if (ok) navigate('/dashboard', { replace: true })
      else setError('This session has expired or been ended. Start a new one from the admin portal.')
    })
  }, [adopt, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-red-600 dark:text-red-400">
              Session not started
            </h1>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{error}</p>
          </>
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Starting support session…</p>
        )}
      </div>
    </div>
  )
}
