import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, ChevronDownIcon } from './pdfIcons'
import { ZOOM_STEPS } from './pageLayout'
import type { ZoomMode } from './usePdfPageLayout'

/**
 * Zoom picker.
 *
 * <p>Deliberately not the shared `Dropdown`, for two reasons that are properties
 * of that component rather than preferences:
 *
 * <ol>
 *   <li>It renders its menu as `absolute … z-50` inside a `relative` wrapper, so
 *       it is clipped by any scrolling or `overflow-hidden` ancestor.
 *       `DocumentDetail` wraps this viewer in `overflow-hidden rounded-xl`, so
 *       the menu would be cut off at the toolbar's edge.</li>
 *   <li>Its `DropdownItem.label` is typed `string`, so an item cannot carry the
 *       tick that marks the current mode.</li>
 * </ol>
 *
 * <p>So the menu is portalled to `document.body` and positioned from the
 * trigger's rect. That also makes it work unchanged inside the fullscreen
 * overlay, where an in-flow menu would be trapped by the overlay's own
 * stacking context.
 */

export interface PdfZoomMenuProps {
  mode: ZoomMode
  percent: number
  onSelectMode: (mode: ZoomMode) => void
  onSelectPercent: (percent: number) => void
  disabled?: boolean
}

const MODES: Array<{ mode: ZoomMode; label: string; hint: string }> = [
  { mode: 'fit-width', label: 'Fit width', hint: '1' },
  { mode: 'fit-page', label: 'Fit page', hint: '9' },
  { mode: 'actual', label: 'Actual size', hint: '0' },
]

export function PdfZoomMenu({
  mode,
  percent,
  onSelectMode,
  onSelectPercent,
  disabled,
}: PdfZoomMenuProps) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Measured before paint so the menu never appears at the wrong place first.
  useLayoutEffect(() => {
    if (!open) return
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.bottom + 4, right: window.innerWidth - r.right })
  }, [open])

  useEffect(() => {
    if (!open) return

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Swallow it: without this the press also reaches the fullscreen
      // overlay's handler and closes the whole viewer, not just this menu.
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    // The menu is anchored to a rect taken once; any scroll or resize
    // invalidates it, and repositioning a menu under the pointer is worse than
    // dismissing it.
    const onMoved = () => setOpen(false)

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onMoved)
    window.addEventListener('scroll', onMoved, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onMoved)
      window.removeEventListener('scroll', onMoved, true)
    }
  }, [open])

  const itemClass =
    'flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Zoom, currently ${percent}%`}
        className="flex h-7 min-w-[4.25rem] items-center justify-center gap-1 rounded-md px-2 text-xs font-medium tabular-nums text-zinc-700 transition-colors hover:bg-white hover:shadow-sm disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        {percent}%
        <ChevronDownIcon className="h-3 w-3 opacity-60" />
      </button>

      {open && rect
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              // z-[80] clears the fullscreen overlay's z-[70], which in turn
              // clears the shared Modal's z-50.
              className="fixed z-[80] w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 animate-in fade-in zoom-in-95 duration-150"
              style={{ top: rect.top, right: rect.right }}
              onClick={(e) => e.stopPropagation()}
            >
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode === m.mode}
                  className={itemClass}
                  onClick={() => {
                    onSelectMode(m.mode)
                    setOpen(false)
                  }}
                >
                  <span className="flex items-center gap-2">
                    <CheckIcon
                      className={`h-3.5 w-3.5 ${mode === m.mode ? 'text-violet-600 dark:text-violet-400' : 'invisible'}`}
                    />
                    {m.label}
                  </span>
                  <kbd className="rounded border border-zinc-200 px-1 text-[10px] text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                    {m.hint}
                  </kbd>
                </button>
              ))}

              <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />

              {ZOOM_STEPS.map((step) => (
                <button
                  key={step}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode === 'custom' && percent === step}
                  className={itemClass}
                  onClick={() => {
                    onSelectPercent(step)
                    setOpen(false)
                  }}
                >
                  <span className="flex items-center gap-2">
                    <CheckIcon
                      className={`h-3.5 w-3.5 ${
                        mode === 'custom' && percent === step
                          ? 'text-violet-600 dark:text-violet-400'
                          : 'invisible'
                      }`}
                    />
                    {step}%
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
