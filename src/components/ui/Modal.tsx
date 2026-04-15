import { useEffect, useRef, type ReactNode } from 'react'

/* ── Props ── */

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** When true, clicking backdrop doesn't close the modal. */
  persistent?: boolean
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
}

/* ── Component ── */

export function Modal({ open, onClose, title, description, children, size = 'md', persistent }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Escape key
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Focus trap
  useEffect(() => {
    if (!open || !contentRef.current) return
    const el = contentRef.current
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length > 0) focusable[0].focus()

    function trapFocus(e: KeyboardEvent) {
      if (e.key !== 'Tab' || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    el.addEventListener('keydown', trapFocus)
    return () => el.removeEventListener('keydown', trapFocus)
  }, [open])

  // Lock body scroll
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={() => { if (!persistent) onClose() }}
        aria-hidden="true"
      />

      {/* Content */}
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        aria-describedby={description ? 'modal-desc' : undefined}
        className={`relative w-full rounded-xl border border-zinc-200 bg-white shadow-xl
          dark:border-zinc-700 dark:bg-zinc-900
          animate-in zoom-in-95 fade-in duration-200 ${sizeClasses[size]}`}
      >
        {/* Header */}
        {(title || description) && (
          <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
            {title && (
              <h2 id="modal-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {title}
              </h2>
            )}
            {description && (
              <p id="modal-desc" className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                {description}
              </p>
            )}

            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute right-4 top-4 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

/* ── Modal Footer Helper ── */

export function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-end gap-2 border-t border-zinc-100 px-6 py-3 dark:border-zinc-800 -mx-6 -mb-4 mt-4 rounded-b-xl ${className ?? ''}`}>
      {children}
    </div>
  )
}
