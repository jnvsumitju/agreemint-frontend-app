import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

/* ── Types ── */

type ToastVariant = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (variant: ToastVariant, message: string) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

/* ── Context ── */

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 0
const TOAST_DURATION = 3500
const MAX_TOASTS = 5

/* ── Provider ── */

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = ++nextId
      setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { id, message, variant }])
      setTimeout(() => removeToast(id), TOAST_DURATION)
    },
    [removeToast],
  )

  const value: ToastContextValue = {
    toast: addToast,
    success: (msg) => addToast('success', msg),
    error: (msg) => addToast('error', msg),
    info: (msg) => addToast('info', msg),
    warning: (msg) => addToast('warning', msg),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Toast Container */}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 top-4 z-[9999] flex flex-col items-end gap-2"
      >
        {toasts.map((t, i) => (
          <div
            key={t.id}
            style={{ animationDelay: `${i * 30}ms` }}
            className={`pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg
              animate-in slide-in-from-right fade-in duration-300
              ${variantStyles[t.variant]}`}
          >
            <span className="shrink-0">{variantIcons[t.variant]}</span>
            <span className="max-w-xs">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="ml-1 shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/* ── Hook ── */

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

/* ── Variant Styles ── */

const variantStyles: Record<ToastVariant, string> = {
  success: 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/40 dark:text-green-200 dark:border-green-800',
  error: 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800',
  info: 'bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800',
  warning: 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800',
}

/* ── Variant Icons ── */

const variantIcons: Record<ToastVariant, ReactNode> = {
  success: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  error: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  info: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  warning: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  ),
}
