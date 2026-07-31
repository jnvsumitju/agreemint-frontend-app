import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PdfFullscreenOverlayProps {
  onClose: () => void
  /**
   * True while a dialog inside the overlay owns Escape. The overlay stands
   * down rather than closing underneath it.
   */
  suppressEscape?: boolean
  children: ReactNode
}

/**
 * Full-window viewer, as a portal rather than the Fullscreen API.
 *
 * <p>`element.requestFullscreen()` is refused or behaves inconsistently when the
 * element is inside another modal, cannot be styled to match the app, and puts
 * the browser's own exit affordance on top of ours. A portalled fixed overlay is
 * already this codebase's idiom for every other layer.
 *
 * <p>Three things here exist purely to coexist with `PreviewModal`, which is one
 * of the two call sites and is itself a hand-rolled `fixed inset-0 z-50` layer:
 *
 * <ol>
 *   <li><b>Click containment.</b> A React portal renders into `document.body`
 *       but its events still propagate through the <i>React</i> tree, so a click
 *       anywhere in here would reach `PreviewModal`'s root `onClick={handleClose}`
 *       (`PreviewModal.tsx:145`) and close the entire modal. The overlay stops
 *       propagation at its root.</li>
 *   <li><b>Escape arbitration.</b> The shared `Modal` binds Escape on `window`
 *       (`Modal.tsx:35`). With the properties dialog open, one press would
 *       otherwise close both it and fullscreen.</li>
 *   <li><b>Scroll lock ownership.</b> Only one layer may own `body.overflow`.
 *       This one saves and restores whatever it found, so `Modal`'s own lock
 *       nests correctly instead of clobbering it.</li>
 * </ol>
 */
export function PdfFullscreenOverlay({
  onClose,
  suppressEscape,
  children,
}: PdfFullscreenOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  // Read through a ref so toggling the properties dialog does not rebind the
  // key listener — a rebind between keydown and keyup drops the press.
  const suppressRef = useRef(suppressEscape)
  suppressRef.current = suppressEscape

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || suppressRef.current) return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  // Move focus in, so the scroller's own keyboard shortcuts work without a
  // click first, and so Tab starts inside the overlay rather than behind it.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const target = el.querySelector<HTMLElement>('[data-pdf-scroller]') ?? el
    target.focus({ preventScroll: true })
    return () => previouslyFocused?.focus?.({ preventScroll: true })
  }, [])

  return createPortal(
    <div
      ref={rootRef}
      // z-[70] clears PreviewModal's z-50 and the shared Modal's z-50.
      className="fixed inset-0 z-[70] flex flex-col bg-zinc-100 dark:bg-zinc-950"
      role="dialog"
      aria-modal="true"
      aria-label="Document, full screen"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}
