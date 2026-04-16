import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { API_BASE } from '../../lib/api'
import { Button } from '../../components/ui/Button'
import { Input, PasswordStrength } from '../../components/ui/Input'

export function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: 'Reset failed' }))
        throw new Error(data.message || 'Reset failed')
      }
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <AuthLayout>
        <div className="page-enter text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <svg className="h-7 w-7 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Invalid reset link</h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            This password reset link is missing a token. Please request a new one.
          </p>
          <Link to="/forgot-password">
            <Button variant="primary" size="sm" className="mt-5">
              Request new link
            </Button>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="page-enter">
        {success ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <svg className="h-7 w-7 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Password reset!</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Your password has been updated. Redirecting to sign in...
            </p>
          </div>
        ) : (
          <>
            <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Back to sign in
            </Link>

            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Set new password</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Choose a strong password for your account
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

              <div className="space-y-4">
                <div>
                  <Input
                    label="New password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                  <PasswordStrength password={password} />
                </div>

                <Input
                  label="Confirm password"
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  error={confirm && confirm !== password ? 'Passwords do not match' : undefined}
                  autoComplete="new-password"
                />
              </div>

              <Button type="submit" loading={loading} className="mt-5 w-full">
                Reset password
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthLayout>
  )
}
