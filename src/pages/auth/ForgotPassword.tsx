import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error('Request failed')
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="page-enter">
        {sent ? (
          <div className="text-center">
            {/* Success icon */}
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <svg className="h-7 w-7 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>

            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Check your email</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              If an account exists for <span className="font-medium text-zinc-700 dark:text-zinc-300">{email}</span>,
              we've sent a password reset link.
            </p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              Didn't get it? Check your spam folder or try again.
            </p>

            <div className="mt-6 flex flex-col gap-2">
              <Button variant="secondary" className="w-full" onClick={() => setSent(false)}>
                Try a different email
              </Button>
              <Link to="/login">
                <Button variant="ghost" className="w-full">
                  Back to sign in
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Back link */}
            <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Back to sign in
            </Link>

            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Forgot password?</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              No worries, we'll send you a reset link.
            </p>

            <form onSubmit={handleSubmit} className="mt-6">
              {error && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  {error}
                </div>
              )}

              <Input
                label="Email address"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />

              <Button type="submit" loading={loading} className="mt-5 w-full">
                Send reset link
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthLayout>
  )
}
