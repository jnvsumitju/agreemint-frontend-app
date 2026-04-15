import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Button } from '../../components/ui/Button'

export function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const email = searchParams.get('email') ?? ''

  const [status, setStatus] = useState<'pending' | 'verifying' | 'success' | 'error'>(
    token ? 'verifying' : 'pending'
  )
  const [errorMsg, setErrorMsg] = useState('')
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  // Auto-verify if token is present
  useEffect(() => {
    if (!token) return
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((res) => {
        if (res.ok) setStatus('success')
        else throw new Error('Invalid or expired token')
      })
      .catch((err) => {
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : 'Verification failed')
      })
  }, [token])

  async function handleResend() {
    if (!email) return
    setResending(true)
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setResent(true)
    } catch {
      // Silently handle — don't reveal if email exists
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthLayout>
      <div className="page-enter text-center">
        {status === 'verifying' && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            </div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Verifying your email...</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Please wait a moment.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <svg className="h-7 w-7 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Email verified!</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Your email has been confirmed. You can now sign in.
            </p>
            <Link to="/login">
              <Button variant="primary" className="mt-5">
                Go to Sign in
              </Button>
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <svg className="h-7 w-7 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Verification failed</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{errorMsg || 'The link may have expired.'}</p>
            <div className="mt-5 flex flex-col gap-2">
              <Link to="/login"><Button variant="primary" className="w-full">Go to Sign in</Button></Link>
            </div>
          </>
        )}

        {status === 'pending' && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
              <svg className="h-7 w-7 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Check your email</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              We've sent a verification link to your email address.
              Click the link to verify your account.
            </p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              Don't see it? Check your spam folder.
            </p>

            {email && (
              <div className="mt-5">
                {resent ? (
                  <p className="text-sm text-green-600 dark:text-green-400">Verification email resent!</p>
                ) : (
                  <Button variant="secondary" size="sm" loading={resending} onClick={handleResend}>
                    Resend verification email
                  </Button>
                )}
              </div>
            )}

            <Link to="/login" className="mt-4 inline-block text-sm text-violet-600 hover:underline dark:text-violet-400">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </AuthLayout>
  )
}
