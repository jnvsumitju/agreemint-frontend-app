import type { HTMLAttributes, ReactNode } from 'react'

const variants = {
  default: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
  primary: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  success: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  danger: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
} as const

const sizes = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2.5 py-0.5 text-xs',
  lg: 'px-3 py-1 text-sm',
} as const

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  dot?: boolean
  icon?: ReactNode
}

export function Badge({ variant = 'default', size = 'md', dot, icon, children, className, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${variants[variant]} ${sizes[size]} ${className ?? ''}`}
      {...props}
    >
      {dot && (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            variant === 'success' ? 'bg-green-500' :
            variant === 'warning' ? 'bg-amber-500' :
            variant === 'danger' ? 'bg-red-500' :
            variant === 'info' ? 'bg-blue-500' :
            variant === 'primary' ? 'bg-violet-500' :
            'bg-zinc-400'
          }`}
        />
      )}
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </span>
  )
}
