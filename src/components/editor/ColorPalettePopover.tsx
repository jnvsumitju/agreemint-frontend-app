import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { normalizeHexInput, pickerHexFromCssColor } from '../../lib/cssColor'
import { DOCUMENT_COLOR_PALETTE_HEX } from '../../lib/docColorPalette'
import type { GradientDef, GradientStop } from '../../types/layout'
import {
  cloneGradient,
  gradientToCss,
  isValidGradient,
  makeLinearGradient,
  GRADIENT_PRESETS,
  sortStops,
} from '../../lib/gradientUtils'
import { IconNoColor, IconChevronDown } from './ToolbarIcons'

const PANEL_W = 260
const PANEL_EST_H = 420

const MAX_RECENT = 8
let recentColors: string[] = []
let recentListeners: Set<() => void> = new Set()

function pushRecentColor(hex: string) {
  const h = hex.toLowerCase()
  if (DOCUMENT_COLOR_PALETTE_HEX.includes(h)) return // skip palette colors
  recentColors = [h, ...recentColors.filter((c) => c !== h)].slice(0, MAX_RECENT)
  recentListeners.forEach((fn) => fn())
}

function useRecentColors() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const fn = () => setTick((t) => t + 1)
    recentListeners.add(fn)
    return () => { recentListeners.delete(fn) }
  }, [])
  return recentColors
}

/* ------------------------------------------------------------------ */
/*  Gradient editor sub-panel                                          */
/* ------------------------------------------------------------------ */

function GradientEditorPanel({
  gradient,
  onChange,
}: {
  gradient: GradientDef
  onChange: (g: GradientDef) => void
}) {
  const update = (patch: Partial<GradientDef>) => onChange({ ...gradient, ...patch })

  const updateStop = (idx: number, patch: Partial<GradientStop>) => {
    const next = gradient.stops.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    onChange({ ...gradient, stops: sortStops(next) })
  }

  const addStop = () => {
    const stops = [...gradient.stops]
    // Insert at midpoint
    const mid = stops.length >= 2
      ? (stops[Math.floor(stops.length / 2) - 1].position + stops[Math.floor(stops.length / 2)].position) / 2
      : 0.5
    stops.push({ color: '#888888', position: mid })
    onChange({ ...gradient, stops: sortStops(stops) })
  }

  const removeStop = (idx: number) => {
    if (gradient.stops.length <= 2) return
    onChange({ ...gradient, stops: gradient.stops.filter((_, i) => i !== idx) })
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Presets */}
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Presets
      </p>
      <div className="grid grid-cols-6 gap-1">
        {GRADIENT_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            title={p.label}
            className="h-6 w-full rounded border border-zinc-300 hover:scale-105 hover:ring-2 hover:ring-violet-400 focus:outline-none dark:border-zinc-600"
            style={{ background: gradientToCss(p.gradient) }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(cloneGradient(p.gradient))}
          />
        ))}
      </div>

      {/* Live preview */}
      <div
        className="h-6 w-full rounded border border-zinc-300 dark:border-zinc-600"
        style={{ background: gradientToCss(gradient) }}
      />

      {/* Type + Angle */}
      <div className="flex items-center gap-2">
        <select
          className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-[10px] dark:border-zinc-600 dark:bg-zinc-800"
          value={gradient.type}
          onChange={(e) => update({ type: e.target.value as 'linear' | 'radial' })}
        >
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
        {gradient.type === 'linear' && (
          <label className="flex flex-1 items-center gap-1">
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Angle</span>
            <input
              type="range"
              min={0}
              max={360}
              value={gradient.angle ?? 0}
              className="h-1 min-w-0 flex-1 cursor-pointer accent-violet-600"
              onChange={(e) => update({ angle: Number(e.target.value) })}
            />
            <span className="w-7 text-right text-[10px] tabular-nums text-zinc-600 dark:text-zinc-300">
              {gradient.angle ?? 0}&deg;
            </span>
          </label>
        )}
      </div>

      {/* Colour stops */}
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Stops
      </p>
      <div className="flex flex-col gap-1">
        {gradient.stops.map((stop, i) => (
          <div key={i} className="flex items-center gap-1">
            <label className="shrink-0 cursor-pointer">
              <span className="sr-only">Stop {i + 1} colour</span>
              <input
                type="color"
                value={pickerHexFromCssColor(stop.color)}
                className="h-5 w-6 cursor-pointer rounded border border-zinc-300 p-0 dark:border-zinc-600"
                onChange={(e) => updateStop(i, { color: e.target.value })}
              />
            </label>
            <input
              type="text"
              className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5 font-mono text-[10px] dark:border-zinc-600 dark:bg-zinc-800"
              value={stop.color}
              onChange={(e) => updateStop(i, { color: e.target.value })}
            />
            <input
              type="number"
              min={0}
              max={100}
              className="w-12 rounded border border-zinc-300 px-1 py-0.5 text-center text-[10px] tabular-nums dark:border-zinc-600 dark:bg-zinc-800"
              value={Math.round(stop.position * 100)}
              onChange={(e) =>
                updateStop(i, { position: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })
              }
            />
            <span className="text-[9px] text-zinc-400">%</span>
            {gradient.stops.length > 2 && (
              <button
                type="button"
                className="text-[10px] text-red-400 hover:text-red-600"
                title="Remove stop"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => removeStop(i)}
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="rounded border border-dashed border-zinc-300 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
        onMouseDown={(e) => e.preventDefault()}
        onClick={addStop}
      >
        + Add stop
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ColorToolbarSwatch — the trigger + popover                         */
/* ------------------------------------------------------------------ */

type ColorToolbarSwatchProps = {
  title: string
  /** Current CSS color (hex, rgb, …) or empty */
  value: string | undefined
  onChange: (cssColor: string) => void
  onClear?: () => void
  /** Compact trigger for dense toolbars */
  size?: 'sm' | 'md'
  /** Current gradient (takes visual precedence when set). */
  gradient?: GradientDef
  /** Called when gradient changes. If omitted, gradient tab is hidden. */
  onGradientChange?: (g: GradientDef | undefined) => void
}

export function ColorToolbarSwatch({
  title,
  value,
  onChange,
  onClear,
  size = 'sm',
  gradient,
  onGradientChange,
}: ColorToolbarSwatchProps) {
  const panelId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [customHex, setCustomHex] = useState(() => pickerHexFromCssColor(value))
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 })

  /**
   * Apply a hex the author has finished typing.
   *
   * <p>Shared by Enter and by blur so the two cannot drift — they are the same
   * decision made at two different moments, and the earlier version had the
   * expansion logic inline in one of them only.
   *
   * <p>Writes the canonical form back into the field, so a shorthand visibly
   * becomes the six-digit value that was actually stored rather than leaving
   * the author guessing which one the document has.
   */
  const commitCustomHex = useCallback(
    (hex: string) => {
      setCustomHex(hex)
      pushRecentColor(hex)
      if (onGradientChange) onGradientChange(undefined)
      onChange(hex)
    },
    [onChange, onGradientChange]
  )

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

  const recent = useRecentColors()

  const applyHex = useCallback(
    (hex: string) => {
      pushRecentColor(hex)
      onChange(hex)
      setOpen(false)
    },
    [onChange]
  )

  const hasGradient = isValidGradient(gradient)
  const showGradientTab = onGradientChange != null
  const [tab, setTab] = useState<'solid' | 'gradient'>(() => (hasGradient ? 'gradient' : 'solid'))
  const [editGrad, setEditGrad] = useState<GradientDef>(
    () => gradient ?? makeLinearGradient('#4f46e5', '#ec4899', 135),
  )

  // Sync edit gradient when prop changes externally
  useEffect(() => {
    if (gradient) setEditGrad(cloneGradient(gradient))
  }, [gradient])

  // When panel opens, pick the right tab
  useEffect(() => {
    if (open) setTab(hasGradient ? 'gradient' : 'solid')
  }, [open, hasGradient])

  const hasValue = Boolean(value?.trim())
  const swatchSize = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'
  const border = 'border border-zinc-400 dark:border-zinc-500'
  const swatchBg = hasGradient
    ? { background: gradientToCss(gradient!) }
    : { backgroundColor: hasValue ? value : 'transparent' }

  const tabCls = (active: boolean) =>
    `flex-1 py-1 text-center text-[10px] font-semibold uppercase tracking-wide rounded-md transition-colors ${
      active
        ? 'bg-white text-violet-700 shadow-sm dark:bg-zinc-700 dark:text-violet-300'
        : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`

  const panel =
    open && typeof document !== 'undefined' ? (
      <div
        ref={panelRef}
        id={panelId}
        role="listbox"
        aria-label={title}
        data-agreemint-skip-canvas-inline-commit
        className="fixed z-[10050] w-[260px] rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
        style={{ top: panelPos.top, left: panelPos.left }}
        /*
         * Stop the press here rather than letting it reach the toolbar.
         *
         * This panel is portaled to document.body, but React propagates
         * synthetic events up the REACT tree, not the DOM tree — so a mousedown
         * in here still arrives at the toolbar that rendered the trigger, and
         * those toolbars call preventDefault() to keep the text selection alive
         * while a button is pressed. preventDefault on mousedown also cancels
         * the browser's focus-on-click, which made the hex field impossible to
         * type into: the click landed, the caret stayed in the document, and
         * the keystrokes went there instead.
         *
         * stopPropagation, NOT preventDefault: the field needs the default to
         * happen. Every button inside this panel already calls preventDefault
         * on itself, so the selection is still protected where that matters.
         */
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* No Color. Historically this dispatched both `onClear()` and
            `onGradientChange(undefined)` back-to-back, but each handler
            captured the parent's `style` in a stale closure — the second
            call (merging colorGradient:undefined into old style) re-added
            the color the first call had just removed. All clear handlers
            already remove the paired gradient via `omitStyleKey`, so the
            second dispatch is redundant + buggy. Single call is enough. */}
        {onClear && (
          <button
            type="button"
            className="mb-2 flex w-full items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onClear()
              setOpen(false)
            }}
          >
            <IconNoColor size={14} />
            No Color
          </button>
        )}

        {/* Tab strip */}
        {showGradientTab && (
          <div className="mb-2 flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            <button
              type="button"
              className={tabCls(tab === 'solid')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab('solid')}
            >
              Solid
            </button>
            <button
              type="button"
              className={tabCls(tab === 'gradient')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab('gradient')}
            >
              Gradient
            </button>
          </div>
        )}

        {/* ── Solid tab ── */}
        {tab === 'solid' && (
          <>
            <div className="grid grid-cols-8 gap-1">
              {DOCUMENT_COLOR_PALETTE_HEX.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  className={`h-6 w-6 shrink-0 rounded border ${border} hover:scale-105 hover:ring-2 hover:ring-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500`}
                  style={{ backgroundColor: hex }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (onGradientChange) onGradientChange(undefined)
                    applyHex(hex)
                  }}
                />
              ))}
            </div>
            {recent.length > 0 && (
              <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-600">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Recent
                </p>
                <div className="flex gap-1">
                  {recent.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      title={hex}
                      className={`h-6 w-6 shrink-0 rounded border ${border} hover:scale-105 hover:ring-2 hover:ring-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500`}
                      style={{ backgroundColor: hex }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (onGradientChange) onGradientChange(undefined)
                        applyHex(hex)
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
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
                      pushRecentColor(v)
                      if (onGradientChange) onGradientChange(undefined)
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
                    // Live preview for a COMPLETE six-digit value only.
                    // Deliberately not the shorthand: typing "#1a2b3c" passes
                    // through "#1a2", which is itself a valid shorthand, so
                    // expanding here would flash #11aa22 onto the document
                    // mid-keystroke and push it into recent colours. Shorthand
                    // resolves when the author says they are done — Enter or
                    // blur.
                    if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                      if (onGradientChange) onGradientChange(undefined)
                      onChange(v)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    // Otherwise Enter would reach whatever the field sits in —
                    // and for the toolbar swatch that is the canvas.
                    e.preventDefault()
                    const v = normalizeHexInput(customHex)
                    // An unparseable value leaves the text alone rather than
                    // reverting it, so the author can see and correct the typo
                    // instead of watching their input vanish.
                    if (!v) return
                    commitCustomHex(v)
                    setOpen(false)
                  }}
                  onBlur={() => {
                    const v = normalizeHexInput(customHex)
                    if (v) commitCustomHex(v)
                  }}
                />
              </div>
            </div>
          </>
        )}

        {/* ── Gradient tab ── */}
        {tab === 'gradient' && showGradientTab && (
          <GradientEditorPanel
            gradient={editGrad}
            onChange={(g) => {
              setEditGrad(g)
              onGradientChange!(g)
            }}
          />
        )}

        {/* Done button */}
        <button
          type="button"
          className="mt-2 w-full rounded border border-zinc-200 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(false)}
        >
          Done
        </button>
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
          style={swatchBg}
        />
        <span className="px-0.5 text-zinc-400 dark:text-zinc-500" aria-hidden>
          <IconChevronDown size={10} />
        </span>
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </div>
  )
}
