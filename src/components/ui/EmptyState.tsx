import type { ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'

/* ── Props ── */

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
    variant?: ButtonProps['variant']
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  className?: string
}

/* ── Component ── */

export function EmptyState({ icon, title, description, action, secondaryAction, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700 ${className ?? ''}`}>
      {icon && (
        <div className="mb-3 text-zinc-300 dark:text-zinc-600">{icon}</div>
      )}

      <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</h3>

      {description && (
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      )}

      {(action || secondaryAction) && (
        <div className="mt-4 flex items-center gap-3">
          {action && (
            <Button variant={action.variant ?? 'primary'} size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="ghost" size="sm" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
