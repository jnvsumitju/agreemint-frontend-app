import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'

/* ── Props ── */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  helper?: string
  error?: string
  icon?: ReactNode
  suffix?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-9 px-3 text-sm',
  lg: 'h-10 px-3.5 text-base',
}

/* ── Component ── */

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, helper, error, icon, suffix, size = 'md', className, id, type, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    const [showPassword, setShowPassword] = useState(false)
    const isPassword = type === 'password'

    return (
      <div className={className}>
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {label}
          </label>
        )}

        <div className="relative">
          {icon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
              {icon}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            type={isPassword && showPassword ? 'text' : type}
            className={`w-full rounded-lg border bg-white text-zinc-900 outline-none transition-colors
              placeholder:text-zinc-400
              focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20
              dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500
              ${error
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                : 'border-zinc-300 dark:border-zinc-600'}
              ${icon ? 'pl-9' : ''}
              ${suffix || isPassword ? 'pr-9' : ''}
              ${sizeClasses[size]}
            `}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : helper ? `${inputId}-helper` : undefined}
            {...props}
          />

          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          )}

          {suffix && !isPassword && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">{suffix}</span>
          )}
        </div>

        {error && (
          <p id={`${inputId}-error`} className="mt-1 flex items-center gap-1 text-xs text-red-500">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {error}
          </p>
        )}

        {helper && !error && (
          <p id={`${inputId}-helper`} className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {helper}
          </p>
        )}
      </div>
    )
  },
)

Input.displayName = 'Input'

/* ── Password Strength Indicator ── */

function getStrength(password: string): { score: number; label: string; color: string } {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++

  if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' }
  if (score <= 2) return { score, label: 'Fair', color: 'bg-orange-500' }
  if (score <= 3) return { score, label: 'Good', color: 'bg-yellow-500' }
  return { score, label: 'Strong', color: 'bg-green-500' }
}

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null
  const { score, label, color } = getStrength(password)

  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= score ? color : 'bg-zinc-200 dark:bg-zinc-700'}`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Password strength: <span className="font-medium">{label}</span>
      </p>
    </div>
  )
}
