/**
 * Left-palette symbol picker — one trigger tile that opens a portal popover
 * with a grid of glyphs. Used for {@code <SymbolPickerPopover kind="math" />}
 * and {@code kind="emoji"}, each backed by a different curated catalog.
 *
 * Behavior on click:
 *   - The popover closes.
 *   - A fresh {@code TEXT} element is created at a sensible position on the
 *     active page, pre-filled with the chosen glyph. The element is added
 *     via the editor store — same code path as dragging a "Text" block from
 *     the palette, just with pre-populated content.
 *   - The new element is selected so the user can immediately drag it or
 *     keep typing.
 *
 * Styling + portal positioning mirror {@link ColorPalettePopover} so the two
 * feel consistent.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { createDefaultElement, useEditorStore } from '../../stores/editorStore'
import type { RichRun } from '../../lib/richContent'
import { serializeRunsToContent } from '../../lib/richContent'
import {
  EMOJI_SYMBOLS,
  MATH_SYMBOLS,
  filterSymbols,
  groupByCategory,
  type SymbolEntry,
} from '../../lib/symbolCatalog'

const PANEL_W = 300
const PANEL_EST_H = 380

export type SymbolPickerKind = 'math' | 'emoji'

interface SymbolPickerPopoverProps {
  kind: SymbolPickerKind
  /** Shown as the tile label + popover header. */
  label: string
  /** Glyph rendered on the tile itself (e.g. "∑" or "😀"). */
  triggerGlyph: string
  /** When true, the tile is disabled (view-only / band editor restrictions). */
  disabled?: boolean
  /** Passed through to the tile's {@code title} attribute for hover. */
  tooltip?: string
}

export function SymbolPickerPopover({
  kind,
  label,
  triggerGlyph,
  disabled,
  tooltip,
}: SymbolPickerPopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 })
  const [query, setQuery] = useState('')

  const addElement = useEditorStore((s) => s.addElement)

  const entries = kind === 'math' ? MATH_SYMBOLS : EMOJI_SYMBOLS
  const filtered = useMemo(() => filterSymbols(entries, query), [entries, query])
  const grouped = useMemo(() => groupByCategory(filtered), [filtered])

  const updatePanelPosition = useCallback(() => {
    const btn = triggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const flipUp = spaceBelow < PANEL_EST_H && rect.top > PANEL_EST_H
    const top = flipUp
      ? Math.max(8, rect.top - PANEL_EST_H - 4)
      : rect.bottom + 4
    let left = rect.right + 8
    // If the panel would overflow, fall back to aligning with the trigger's
    // left edge (matches ColorPalettePopover behaviour).
    if (left + PANEL_W > window.innerWidth - 8) {
      left = Math.max(8, rect.left)
    }
    if (left + PANEL_W > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - PANEL_W - 8)
    }
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

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node
      if (triggerRef.current?.contains(n) || panelRef.current?.contains(n)) return
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

  // Reset search when closing so reopening shows everything.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const handlePick = useCallback(
    (entry: SymbolEntry) => {
      insertSymbolAsTextElement(entry.char, addElement)
      setOpen(false)
    },
    [addElement],
  )

  // Enter while the search has a single result picks it — a small QoL nod
  // to users who type "pi" and expect to hit enter.
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      handlePick(filtered[0])
    }
  }

  const tileBaseCls =
    'flex min-h-[2.75rem] flex-col items-center justify-center gap-0.5 rounded-md border px-0.5 py-1 text-center text-[9px] font-medium leading-tight transition-colors lg:min-h-[3.5rem] lg:px-1 lg:py-1.5 lg:text-[10px]'
  const tileCls = disabled
    ? `${tileBaseCls} cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-500`
    : `${tileBaseCls} cursor-pointer border-zinc-200 bg-white text-zinc-800 hover:border-violet-300 hover:bg-violet-50/80 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-violet-500 ${
        open ? 'ring-2 ring-violet-300 dark:ring-violet-600' : ''
      }`

  const panel =
    open && typeof document !== 'undefined' ? (
      <div
        ref={panelRef}
        role="dialog"
        aria-label={`${label} picker`}
        data-agreemint-skip-canvas-inline-commit
        className="fixed z-[10050] flex w-[300px] flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
        style={{ top: panelPos.top, left: panelPos.left, maxHeight: PANEL_EST_H }}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">{label}</p>
          <button
            type="button"
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={`Search ${label.toLowerCase()}…`}
          className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {grouped.length === 0 ? (
            <p className="px-1 py-2 text-center text-[10px] text-zinc-500 dark:text-zinc-400">
              No matches
            </p>
          ) : (
            grouped.map(({ category, items }) => (
              <section key={category} className="mb-2">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {category}
                </p>
                <div className={`grid gap-0.5 ${kind === 'math' ? 'grid-cols-8' : 'grid-cols-7'}`}>
                  {items.map((entry) => (
                    <button
                      key={entry.char + entry.label}
                      type="button"
                      title={entry.label}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handlePick(entry)}
                      className="flex aspect-square items-center justify-center rounded border border-transparent text-base transition-colors hover:border-violet-300 hover:bg-violet-50 dark:hover:border-violet-500 dark:hover:bg-violet-950/40"
                    >
                      <span aria-hidden className="leading-none">{entry.char}</span>
                      <span className="sr-only">{entry.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
        <p className="border-t border-zinc-200 pt-1 text-[9px] leading-snug text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Click a glyph to drop a text block at the top-left of the page. Drag it wherever
          you need.
        </p>
      </div>
    ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={tooltip ?? label}
        className={tileCls}
      >
        <span className="shrink-0 text-base leading-none" aria-hidden>{triggerGlyph}</span>
        <span className="w-full break-words hyphens-auto">{label}</span>
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </>
  )
}

/**
 * Spawn a fresh TEXT element carrying `char` as its content. Landing spot is
 * a small offset from the page origin — users drag it into place from there.
 * A monotonically-increasing offset stops successive insertions from all
 * stacking on the exact same coordinates.
 */
let INSERTION_OFFSET = 0

function insertSymbolAsTextElement(
  char: string,
  addElement: (el: ReturnType<typeof createDefaultElement>) => void,
) {
  INSERTION_OFFSET = (INSERTION_OFFSET + 12) % 120
  const base = createDefaultElement('TEXT', {
    x: 80 + INSERTION_OFFSET,
    y: 80 + INSERTION_OFFSET,
  })
  if (base.type !== 'TEXT') return // defensive; the factory always returns TEXT here
  const runs: RichRun[] = [{ type: 'text', text: char }]
  const el = {
    ...base,
    // Size the element to the glyph — a narrow, short box reads as "inline
    // typography" rather than a full text block.
    width: Math.max(48, char.length * 24),
    height: 40,
    content: serializeRunsToContent(runs),
    style: { ...base.style, fontSize: 28, align: 'left' as const },
  }
  // addElement auto-selects the new element (see editorStore.ts), so there's
  // no need to poke selectedIds ourselves.
  addElement(el)
}

/**
 * Named re-export so LeftPalette can do `{ SymbolPickerTile }` without having
 * to care whether this module is the trigger or the popover — it's a single
 * self-contained tile + portal.
 */
export const SymbolPickerTile: (props: SymbolPickerPopoverProps) => ReactNode = SymbolPickerPopover
