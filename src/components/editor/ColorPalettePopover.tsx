import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pickerHexFromCssColor } from '../../lib/cssColor'
import { DOCUMENT_COLOR_PALETTE_HEX } from '../../lib/docColorPalette'

const PANEL_W = 200
const PANEL_EST_H = 260

type ColorToolbarSwatchProps = {
  title: string
  /** Current CSS color (hex, rgb, …) or empty */
  value: string | undefined
  onChange: (cssColor: string) => void
  onClear?: () => void
  /** Compact trigger for dense toolbars */
  size?: 'sm' | 'md'
}

export function ColorToolbarSwatch({
  title,
  value,
  onChange,
  onClear,
  size = 'sm',
}: ColorToolbarSwatchProps) {
  const panelId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [customHex, setCustomHex] = useState(() => pickerHexFromCssColor(value))
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 })

  const updatePanelPosition = useCallback(() => {
    const btn = triggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const flipUp = spaceBelow < PANEL_EST_H && rect.top > PANEL_EST_H
    const top = flipUp ? Math.max(8, rect.top - PANEL_EST_H - 4) : rect.bottom + 4
    let left = rect.left
    left = Math.max(8, Math.min(left, window.innerWidth - PANEL_W - 8))
    setPanelPos({ top, left })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePanelPosition()
    window.addEventListener('scroll', updatePanelPosition, true)
    window.addEventListener('resize', updatePanelPosition)
    return () => {
      window.removeEventListener('scroll', updatePanelPosition, true)
      window.removeEventListener('resize', updatePanelPosition)
    }
  }, [open, updatePanelPosition])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node
      if (wrapRef.current?.contains(n) || panelRef.current?.contains(n)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const applyHex = useCallback(
    (hex: string) => {
      onChange(hex)
      setOpen(false)
    },
    [onChange]
  )

  const hasValue = Boolean(value?.trim())
  const swatchSize = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'
  const border = 'border border-zinc-400 dark:border-zinc-500'

  const panel =
    open && typeof document !== 'undefined' ? (
      <div
        ref={panelRef}
        id={panelId}
        role="listbox"
        aria-label={title}
        data-agreemint-skip-canvas-inline-commit
        className="fixed z-[10050] w-[200px] rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
        style={{ top: panelPos.top, left: panelPos.left }}
      >
        <div className="grid grid-cols-6 gap-1">
          {DOCUMENT_COLOR_PALETTE_HEX.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex}
              className={`h-6 w-6 shrink-0 rounded border ${border} hover:scale-105 hover:ring-2 hover:ring-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500`}
              style={{ backgroundColor: hex }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyHex(hex)}
            />
          ))}
        </div>
        <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-600">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Custom color
          </p>
          <div className="flex items-center gap-2">
            <label className="shrink-0 cursor-pointer">
              <span className="sr-only">Pick with system dialog</span>
              <input
                id={`${panelId}-color-native`}
                name={`${panelId}-color-native`}
                type="color"
                value={customHex}
                className="h-7 w-10 cursor-pointer rounded border border-zinc-300 bg-white p-0 dark:border-zinc-600"
                onChange={(e) => {
                  const v = e.target.value
                  setCustomHex(v)
                  onChange(v)
                }}
              />
            </label>
            <input
              id={`${panelId}-color-hex`}
              name={`${panelId}-color-hex`}
              type="text"
              className="min-w-0 flex-1 rounded border border-zinc-300 px-1.5 py-1 font-mono text-[10px] dark:border-zinc-600 dark:bg-zinc-800"
              placeholder="#rrggbb"
              value={customHex}
              onChange={(e) => {
                const v = e.target.value
                setCustomHex(v)
                if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v)
              }}
              onBlur={() => {
                if (/^#[0-9A-Fa-f]{6}$/i.test(customHex.trim())) {
                  const v =
                    customHex.trim().length === 7 ? customHex.trim() : pickerHexFromCssColor(customHex)
                  onChange(v)
                }
              }}
            />
          </div>
          <button
            type="button"
            className="mt-2 w-full rounded border border-zinc-200 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen(false)}
          >
            Done
          </button>
        </div>
      </div>
    ) : null

  return (
    <div ref={wrapRef} className="relative inline-flex items-center gap-0.5">
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? panelId : undefined}
        className={`flex shrink-0 items-center gap-0.5 rounded border border-zinc-300 bg-white px-0.5 py-0.5 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setOpen((prev) => {
            if (!prev) {
              queueMicrotask(() => setCustomHex(pickerHexFromCssColor(value)))
            }
            return !prev
          })
        }}
      >
        <span
          className={`${swatchSize} shrink-0 rounded-sm ${border}`}
          style={{ backgroundColor: hasValue ? value : 'transparent' }}
        />
        <span className="px-0.5 text-[9px] leading-none text-zinc-500 dark:text-zinc-400" aria-hidden>
          ▾
        </span>
      </button>
      {onClear && hasValue ? (
        <button
          type="button"
          title={`Clear ${title.toLowerCase()}`}
          className="rounded px-0.5 text-[11px] leading-none text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-600 dark:hover:text-zinc-100"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onClear()}
        >
          ×
        </button>
      ) : null}
      {panel ? createPortal(panel, document.body) : null}
    </div>
  )
}
