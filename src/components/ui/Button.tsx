import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

/* ── Variants ── */

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ' +
  'dark:focus-visible:ring-offset-zinc-900 disabled:pointer-events-none disabled:opacity-50 select-none'

const variants = {
  primary:
    'bg-violet-600 text-white shadow-sm hover:bg-violet-700 active:bg-violet-800 dark:hover:bg-violet-500',
  secondary:
    'border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50 active:bg-zinc-100 ' +
    'dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:active:bg-zinc-600',
  ghost:
    'text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-700',
  danger:
    'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 dark:hover:bg-red-500',
  'danger-ghost':
    'text-red-600 hover:bg-red-50 active:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/20',
} as const

const sizes = {
  xs: 'h-7 px-2.5 text-xs',
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-5 text-base',
  icon: 'h-9 w-9 p-0',
  'icon-sm': 'h-8 w-8 p-0',
  'icon-xs': 'h-7 w-7 p-0',
} as const

/* ── Props ── */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  loading?: boolean
  icon?: ReactNode
}

/* ── Component ── */

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, children, className, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className ?? ''}`}
        {...props}
      >
        {loading ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'
