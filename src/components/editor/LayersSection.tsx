import { useEffect, useMemo, useState } from 'react'
import { documentBandElementsFromFirstPage, findElementByIdInDocument } from '../../lib/documentPageMerge'
import { editorDiagLogOnce } from '../../lib/editorDiagnostics'
import { selectActivePageElements, useEditorStore } from '../../stores/editorStore'
import type { LayoutElement } from '../../types/layout'

const LAYER_DRAG_TYPE = 'text/plain'

function formatLayerPt(el: LayoutElement): string {
  const x = el.x as unknown
  const y = el.y as unknown
  const okX = typeof x === 'number' && Number.isFinite(x)
  const okY = typeof y === 'number' && Number.isFinite(y)
  if (!okX || !okY) {
    editorDiagLogOnce(
      `layers-subtitle-nan:${el.id}`,
      'layers',
      'Layer row showed "NaN, NaN pt" because layerSubtitle used Math.round(el.x) and Math.round(el.y). When x or y is undefined, null, or not a finite number (e.g. partial JSON, migration bug, or a deserialized object missing fields), Math.round yields NaN. Band children should use band-local pt; fix the layout data so x and y are numbers.',
      {
        elementId: el.id,
        type: el.type,
        rawX: x,
        rawY: y,
        typeofX: typeof x,
        typeofY: typeof y,
      }
    )
  }
  const rx = okX ? Math.round(x as number) : '—'
  const ry = okY ? Math.round(y as number) : '—'
  return `${rx}, ${ry} pt`
}

function layerSubtitle(el: LayoutElement): string {
  switch (el.type) {
    case 'TABLE':
      return el.dataKey ? `{{${el.dataKey}}}` : 'Table'
    case 'IMAGE':
      return el.src ? truncateMiddle(el.src, 28) : 'Image'
    case 'MERGED_SHAPE':
      return 'Merged outline'
    case 'RING':
      return 'Ring (annulus)'
    case 'TEXT':
    case 'HEADER':
    case 'FOOTER':
      return formatLayerPt(el)
    default:
      return formatLayerPt(el)
  }
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s
  const half = Math.floor((max - 1) / 2)
  return `${s.slice(0, half)}…${s.slice(-half)}`
}

const typeStyle: Record<LayoutElement['type'], string> = {
  TEXT: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200',
  HEADER: 'bg-sky-200 text-sky-950 dark:bg-sky-900/60 dark:text-sky-100',
  FOOTER: 'bg-amber-200 text-amber-950 dark:bg-amber-900/55 dark:text-amber-50',
  TABLE: 'bg-emerald-200 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-100',
  IMAGE: 'bg-violet-200 text-violet-950 dark:bg-violet-900/50 dark:text-violet-100',
  LINE: 'bg-orange-200 text-orange-950 dark:bg-orange-900/50 dark:text-orange-100',
  BOX: 'bg-pink-200 text-pink-950 dark:bg-pink-900/50 dark:text-pink-100',
  ELLIPSE: 'bg-indigo-200 text-indigo-950 dark:bg-indigo-900/50 dark:text-indigo-100',
  TRIANGLE: 'bg-cyan-200 text-cyan-950 dark:bg-cyan-900/50 dark:text-cyan-100',
  ARROW: 'bg-purple-200 text-purple-950 dark:bg-purple-900/50 dark:text-purple-100',
  DIAMOND: 'bg-rose-200 text-rose-950 dark:bg-rose-900/50 dark:text-rose-100',
  STAR: 'bg-yellow-200 text-yellow-950 dark:bg-yellow-900/50 dark:text-yellow-100',
  MERGED_SHAPE: 'bg-teal-200 text-teal-950 dark:bg-teal-900/50 dark:text-teal-100',
  RING: 'bg-cyan-200 text-cyan-950 dark:bg-cyan-900/50 dark:text-cyan-100',
}

type DropHint = { targetId: string; side: 'before' | 'after' }

/** Page index where document HEADER/FOOTER bands are stored. */
const DOCUMENT_BAND_PAGE_INDEX = 0

export function LayersSection() {
  const pages = useEditorStore((s) => s.pages)
  const bandCanvasEditElementId = useEditorStore((s) => s.bandCanvasEditElementId)
  const bandNestedEditorMounted = useEditorStore((s) => s.bandNestedEditorMounted)
  const bandEditorMode = bandCanvasEditElementId != null
  const activePageElements = useEditorStore(selectActivePageElements)
  const bandsOnPage1 = documentBandElementsFromFirstPage(pages)
  const bandNestedMode = bandEditorMode && bandNestedEditorMounted && bandCanvasEditElementId != null
  const bandContainer = bandNestedMode
    ? findElementByIdInDocument(pages, bandCanvasEditElementId)
    : undefined
  const elements = bandNestedMode
    ? bandContainer?.bandElements ?? []
    : bandEditorMode
      ? bandsOnPage1.filter((e) => e.id !== bandCanvasEditElementId)
      : activePageElements
  const layerPageIndex = bandEditorMode && !bandNestedMode ? DOCUMENT_BAND_PAGE_INDEX : undefined
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const select = useEditorStore((s) => s.select)
  const moveLayer = useEditorStore((s) => s.moveLayer)
  const moveBandNestedLayer = useEditorStore((s) => s.moveBandNestedLayer)
  const bringLayerToFront = useEditorStore((s) => s.bringLayerToFront)
  const bringBandNestedLayerToFront = useEditorStore((s) => s.bringBandNestedLayerToFront)
  const sendLayerToBack = useEditorStore((s) => s.sendLayerToBack)
  const sendBandNestedLayerToBack = useEditorStore((s) => s.sendBandNestedLayerToBack)
  const reorderLayerDrop = useEditorStore((s) => s.reorderLayerDrop)
  const reorderBandNestedLayerDrop = useEditorStore((s) => s.reorderBandNestedLayerDrop)
  const removeElement = useEditorStore((s) => s.removeElement)
  const updateElement = useEditorStore((s) => s.updateElement)

  const [dropHint, setDropHint] = useState<DropHint | null>(null)

  useEffect(() => {
    const clear = () => setDropHint(null)
    document.addEventListener('dragend', clear)
    return () => document.removeEventListener('dragend', clear)
  }, [])

  /** Front (top) → back (bottom), matching design tools. */
  const frontToBack = [...elements].reverse()

  const [layerSearch, setLayerSearch] = useState('')
  const filteredLayers = useMemo(() => {
    const q = layerSearch.trim().toLowerCase()
    if (!q) return frontToBack
    return frontToBack.filter(
      (el) =>
        el.id.toLowerCase().includes(q) ||
        el.type.toLowerCase().includes(q) ||
        (el.content ?? '').toLowerCase().includes(q) ||
        (el.dataKey ?? '').toLowerCase().includes(q)
    )
  }, [frontToBack, layerSearch])

  if (elements.length === 0) {
    return (
      <div className="p-3 text-sm text-zinc-500 dark:text-zinc-400">
        {!bandEditorMode
          ? 'No elements yet. Drag blocks, shapes, or components from the left palette onto the page.'
          : bandNestedMode
            ? 'Nothing inside this band yet. Use the band canvas and the left palette to add text, tables, shapes, and images.'
            : bandsOnPage1.length === 0
              ? 'No header or footer block on page 1 yet. Add a Header or Footer from the left palette on the main page canvas.'
              : 'The band you’re editing is omitted from this list. When another header or footer exists on page 1, it will appear here for order, lock, and delete.'}
      </div>
    )
  }

  const handleRowDragOver = (el: LayoutElement, e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const side = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
    setDropHint({ targetId: el.id, side })
  }

  const handleRowDrop = (el: LayoutElement, e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const draggedId = e.dataTransfer.getData(LAYER_DRAG_TYPE).trim()
    setDropHint(null)
    if (!draggedId || draggedId === el.id) return
    const r = e.currentTarget.getBoundingClientRect()
    const position = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
    if (bandNestedMode) reorderBandNestedLayerDrop(draggedId, el.id, position)
    else reorderLayerDrop(draggedId, el.id, position, layerPageIndex)
  }

  const handleTailDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const last = frontToBack[frontToBack.length - 1]
    if (last) setDropHint({ targetId: last.id, side: 'after' })
  }

  const handleTailDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const draggedId = e.dataTransfer.getData(LAYER_DRAG_TYPE).trim()
    setDropHint(null)
    const last = frontToBack[frontToBack.length - 1]
    if (!draggedId || !last || draggedId === last.id) return
    if (bandNestedMode) reorderBandNestedLayerDrop(draggedId, last.id, 'after')
    else reorderLayerDrop(draggedId, last.id, 'after', layerPageIndex)
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {elements.length > 4 && (
        <input
          type="text"
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] placeholder-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:placeholder-zinc-500"
          placeholder="Search layers (type, id, content)…"
          value={layerSearch}
          onChange={(e) => setLayerSearch(e.target.value)}
        />
      )}
      {bandNestedMode ? (
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          Layers inside the band you’re editing (band coordinates). Top draws{' '}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">in front</span>.
        </p>
      ) : bandEditorMode ? (
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Other</span> header / footer layers on
          page 1 (document-wide). The band you’re editing is not listed here. Order applies to the saved template and
          every page preview.
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          Top of the list draws <span className="font-medium text-zinc-700 dark:text-zinc-300">in front</span>.
          Drag the grip to reorder, or use the arrows. Order is saved with the template.
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {filteredLayers.map((el) => {
          const stackIndex = elements.findIndex((e) => e.id === el.id)
          const isFront = stackIndex === elements.length - 1
          const isBack = stackIndex === 0
          const isSelected = selectedIds.includes(el.id)
          const locked = !!el.locked
          return (
            <li key={el.id}>
              <div
                className={`relative flex flex-col rounded-lg border transition-colors ${
                  isSelected
                    ? 'border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/40'
                    : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800/50 dark:hover:border-zinc-500'
                }`}
                onDragOver={(e) => handleRowDragOver(el, e)}
                onDrop={(e) => handleRowDrop(el, e)}
              >
                {dropHint?.targetId === el.id && dropHint.side === 'before' && (
                  <div
                    className="pointer-events-none absolute left-1 right-1 top-0 z-20 h-0.5 -translate-y-1 rounded-full bg-violet-500"
                    aria-hidden
                  />
                )}
                {dropHint?.targetId === el.id && dropHint.side === 'after' && (
                  <div
                    className="pointer-events-none absolute bottom-0 left-1 right-1 z-20 h-0.5 translate-y-1 rounded-full bg-violet-500"
                    aria-hidden
                  />
                )}
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <div
                    draggable
                    title="Drag to reorder"
                    aria-label="Drag to reorder layer"
                    className="flex shrink-0 cursor-grab touch-none flex-col justify-center gap-0.5 rounded px-0.5 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 active:cursor-grabbing dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                    onDragStart={(e) => {
                      e.dataTransfer.setData(LAYER_DRAG_TYPE, el.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="block h-0.5 w-3 rounded-full bg-current" />
                    <span className="block h-0.5 w-3 rounded-full bg-current" />
                    <span className="block h-0.5 w-3 rounded-full bg-current" />
                  </div>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={(e) =>
                      bandEditorMode
                        ? select(el.id)
                        : select(el.id, e.metaKey || e.ctrlKey || e.shiftKey ? { additive: true } : undefined)
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${typeStyle[el.type]}`}
                      >
                        {el.type}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {el.id}
                          {locked ? (
                            <span className="ml-1.5 text-[10px] font-normal text-amber-700 dark:text-amber-300">
                              (locked)
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                          {layerSubtitle(el)}
                        </div>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    title={locked ? 'Unlock layer' : 'Lock layer'}
                    className={`shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 ${
                      locked ? 'text-amber-700 dark:text-amber-300' : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      select(el.id)
                      updateElement(el.id, { locked: locked ? false : true })
                    }}
                  >
                    {locked ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M18 10h-1V7c0-3.31-2.69-6-6-6S5 3.69 5 7v3H4c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2zm-6 7c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-7H8.9V7c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v3z" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66 1.34-3 3-3s3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    title="Delete layer"
                    className="shrink-0 rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-700 dark:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeElement(el.id)
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                  <div className="flex shrink-0 flex-col gap-0.5 border-l border-zinc-200 pl-1 dark:border-zinc-600">
                    <button
                      type="button"
                      title="Bring forward (one step)"
                      disabled={isFront}
                      className="rounded px-1 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (bandNestedMode) moveBandNestedLayer(el.id, 'forward')
                        else moveLayer(el.id, 'forward', layerPageIndex)
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="Send backward (one step)"
                      disabled={isBack}
                      className="rounded px-1 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (bandNestedMode) moveBandNestedLayer(el.id, 'backward')
                        else moveLayer(el.id, 'backward', layerPageIndex)
                      }}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              </div>
              {isSelected && (
                <div className="mt-1 flex flex-wrap gap-1 px-0.5">
                  <button
                    type="button"
                    className="rounded border border-zinc-300 bg-white px-2 py-1 text-[10px] font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                    disabled={isFront}
                    onClick={() =>
                      bandNestedMode ? bringBandNestedLayerToFront(el.id) : bringLayerToFront(el.id, layerPageIndex)
                    }
                  >
                    To front
                  </button>
                  <button
                    type="button"
                    className="rounded border border-zinc-300 bg-white px-2 py-1 text-[10px] font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                    disabled={isBack}
                    onClick={() =>
                      bandNestedMode ? sendBandNestedLayerToBack(el.id) : sendLayerToBack(el.id, layerPageIndex)
                    }
                  >
                    To back
                  </button>
                </div>
              )}
            </li>
          )
        })}
        <li
          className="min-h-3 rounded-md border border-dashed border-transparent hover:border-zinc-300 dark:hover:border-zinc-600"
          onDragOver={handleTailDragOver}
          onDrop={handleTailDrop}
          aria-label="Drop layer at the back of the stack"
        />
      </ul>
    </div>
  )
}
