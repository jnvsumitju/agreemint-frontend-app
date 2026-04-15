import type { HTMLAttributes, ReactNode } from 'react'

/* ── Card ── */

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${className ?? ''}`}
      {...props}
    >
      {children}
    </div>
  )
}

/* ── Card Header ── */

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  description?: string
  action?: ReactNode
}

export function CardHeader({ title, description, action, className, children, ...props }: CardHeaderProps) {
  return (
    <div
      className={`border-b border-zinc-100 px-6 py-4 dark:border-zinc-800 ${className ?? ''}`}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-center justify-between">
          <div>
            {title && <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>}
            {description && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

/* ── Card Content ── */

export function CardContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-6 py-4 ${className ?? ''}`} {...props}>
      {children}
    </div>
  )
}

/* ── Card Footer ── */

export function CardFooter({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`border-t border-zinc-100 px-6 py-3 dark:border-zinc-800 ${className ?? ''}`}
      {...props}
    >
      {children}
    </div>
  )
}
