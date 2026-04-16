import { useRef, useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { API_BASE } from '../../lib/api'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

export function OtpLogin() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000)
    return () => clearInterval(timer)
  }, [countdown])

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSending(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: 'Failed to send code' }))
        throw new Error(data.message || data.error || 'Failed to send code')
      }
      setStep('code')
      setCountdown(60)
      // Focus first code input
      setTimeout(() => inputRefs.current[0]?.focus(), 100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setSending(false)
    }
  }

  async function handleVerifyOtp() {
    const fullCode = code.join('')
    if (fullCode.length !== 6) return

    setError('')
    setVerifying(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: fullCode }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: 'Invalid code' }))
        throw new Error(data.message || data.error || 'Invalid code')
      }
      const data = await res.json()

      // Store tokens in auth store (same as login)
      localStorage.setItem('agreemint-access-token', data.accessToken)
      localStorage.setItem('agreemint-refresh-token', data.refreshToken)
      if (data.org?.id) localStorage.setItem('agreemint-org-id', data.org.id)
      useAuthStore.setState({
        user: data.user,
        org: data.org,
        orgs: data.org ? [{ org: data.org, role: data.role ?? 'ADMIN' }] : [],
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        isAuthenticated: true,
      })

      navigate('/')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code')
      // Clear code inputs
      setCode(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setVerifying(false)
    }
  }

  function handleCodeChange(index: number, value: string) {
    // Only accept digits
    const digit = value.replace(/\D/g, '').slice(-1)
    const newCode = [...code]
    newCode[index] = digit
    setCode(newCode)

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-submit when all 6 digits entered
    if (digit && index === 5 && newCode.every((d) => d)) {
      // Slight delay to let state update
      setTimeout(() => handleVerifyOtp(), 50)
    }
  }

  function handleCodeKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  function handleCodePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 6) {
      setCode(pasted.split(''))
      inputRefs.current[5]?.focus()
      setTimeout(() => handleVerifyOtp(), 50)
    }
  }

  return (
    <AuthLayout>
      <div className="page-enter">
        <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to sign in
        </Link>

        {step === 'email' ? (
          <>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Sign in with OTP</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              We'll send a 6-digit code to your email
            </p>

            <form onSubmit={handleSendOtp} className="mt-6">
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
              <Button type="submit" loading={sending} className="mt-5 w-full">
                Send code
              </Button>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Enter your code</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              We sent a 6-digit code to <span className="font-medium text-zinc-700 dark:text-zinc-300">{email}</span>
            </p>

            {error && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                {error}
              </div>
            )}

            {/* 6-digit OTP input */}
            <div className="mt-8 flex justify-center gap-3" onPaste={handleCodePaste}>
              {code.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(i, e.target.value)}
                  onKeyDown={(e) => handleCodeKeyDown(i, e)}
                  className="h-14 w-12 rounded-lg border-2 border-zinc-300 bg-white text-center text-2xl font-bold text-zinc-900 outline-none transition-colors
                    focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20
                    dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  autoComplete="one-time-code"
                />
              ))}
            </div>

            <div className="mt-6 text-center">
              <Button
                type="button"
                loading={verifying}
                disabled={code.some((d) => !d)}
                onClick={() => void handleVerifyOtp()}
                className="w-full"
              >
                Verify & sign in
              </Button>
            </div>

            {/* Resend */}
            <div className="mt-4 text-center">
              {countdown > 0 ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-500">
                  Resend code in <span className="font-medium">{countdown}s</span>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { setStep('email'); handleSendOtp(e as unknown as React.FormEvent) }}
                  className="text-sm font-medium text-violet-600 hover:text-violet-700 hover:underline dark:text-violet-400"
                >
                  Resend code
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => { setStep('email'); setError(''); setCode(['', '', '', '', '', '']) }}
              className="mt-2 block w-full text-center text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Use a different email
            </button>
          </>
        )}
      </div>
    </AuthLayout>
  )
}
