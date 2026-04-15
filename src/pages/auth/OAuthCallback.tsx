import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'

export function OAuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    const accessToken = searchParams.get('access_token')
    const refreshToken = searchParams.get('refresh_token')

    if (accessToken && refreshToken) {
      localStorage.setItem('agreemint-access-token', accessToken)
      localStorage.setItem('agreemint-refresh-token', refreshToken)
      useAuthStore.getState().init().then(() => {
        navigate('/', { replace: true })
      })
    } else {
      setError('OAuth callback missing tokens')
    }
  }, [searchParams, navigate])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">Completing sign in...</span>
      </div>
    </div>
  )
}
