import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

const TOKEN_KEY = 'agreemint-access-token'
const REFRESH_KEY = 'agreemint-refresh-token'

export function OAuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const processed = useRef(false)
  const init = useAuthStore((s) => s.init)

  useEffect(() => {
    if (processed.current) return
    processed.current = true

    const token = searchParams.get('token')
    const refreshToken = searchParams.get('refreshToken')

    if (!token || !refreshToken) {
      setError('Missing authentication tokens. Please try signing in again.')
      return
    }

    // Store tokens in localStorage (same keys the auth store reads)
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(REFRESH_KEY, refreshToken)

    // Re-initialize the auth store from the stored tokens, then navigate
    init().then(() => {
      navigate('/', { replace: true })
    }).catch(() => {
      setError('Failed to complete sign in. Please try again.')
    })
  }, [searchParams, navigate, init])

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        {/* Logo / Title */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-violet-600 dark:text-violet-400">
            Agreemint
          </h1>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {error ? (
            <div className="text-center">
              <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
              <a
                href="/login"
                className="text-sm font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
              >
                Back to sign in
              </a>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <svg className="h-6 w-6 animate-spin text-violet-600" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Completing sign in...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
