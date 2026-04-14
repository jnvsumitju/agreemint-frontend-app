import { useState, useEffect, useRef } from 'react'
import { CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX } from '../../lib/editorConstants'
import type { EditorCanvasTool } from '../../stores/editorStore'
import { useEditorStore } from '../../stores/editorStore'
import { pageDimensionsPt } from '../../types/layout'

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const

const TOOL_LABELS: Record<EditorCanvasTool, string> = {
  select: 'Select',
  move: 'Move',
  draw: 'Place',
  pan: 'Pan',
  mergeShapes: 'Merge',
}

const marginInputClass =
  'w-8 rounded border border-zinc-300 bg-white px-0.5 py-0.5 text-[9px] tabular-nums lg:w-10 lg:px-1 lg:text-[11px] dark:border-zinc-600 dark:bg-zinc-800'

function ZoomDropdown({ zoom, setZoom }: { zoom: number; setZoom: (v: number) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = Math.round(zoom * 100)
  const atMin = zoom <= CANVAS_ZOOM_MIN + 0.01
  const atMax = zoom >= CANVAS_ZOOM_MAX - 0.01

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-0.5 border-l border-zinc-200 pl-3 dark:border-zinc-600"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="px-1 py-0.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={atMin}
        onClick={() => {
          const lower = ZOOM_PRESETS.filter((p) => p < zoom - 0.01)
          if (lower.length) setZoom(lower[lower.length - 1])
        }}
      >
        −
      </button>
      <button
        type="button"
        className="min-w-[2.75rem] rounded px-1 py-0.5 text-center text-[11px] font-medium tabular-nums text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
        title="Zoom presets"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        {current}%
      </button>
      <button
        type="button"
        className="px-1 py-0.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={atMax}
        onClick={() => {
          const higher = ZOOM_PRESETS.filter((p) => p > zoom + 0.01)
          if (higher.length) setZoom(higher[0])
        }}
      >
        +
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-[200] mb-1 min-w-[7rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-800">
          {ZOOM_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`block w-full px-3 py-1 text-left text-[11px] font-medium tabular-nums hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                Math.round(p * 100) === current
                  ? 'text-violet-700 dark:text-violet-300'
                  : 'text-zinc-700 dark:text-zinc-200'
              }`}
              onClick={() => {
                setZoom(p)
                setOpen(false)
              }}
            >
              {Math.round(p * 100)}%
            </button>
          ))}
          <div className="border-t border-zinc-100 dark:border-zinc-700" />
          <button
            type="button"
            className="block w-full px-3 py-1 text-left text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
            onClick={() => {
              setZoom(1)
              setOpen(false)
            }}
          >
            Reset to 100%
          </button>
        </div>
      )}
    </div>
  )
}

export function EditorStatusBar() {
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const setPageMargins = useEditorStore((s) => s.setPageMargins)
  const canvasPointerPt = useEditorStore((s) => s.canvasPointerPt)
  const showGrid = useEditorStore((s) => s.showGrid)
  const gridSize = useEditorStore((s) => s.gridSize)
  const smartGuidesEnabled = useEditorStore((s) => s.smartGuidesEnabled)
  const setShowGrid = useEditorStore((s) => s.setShowGrid)
  const setGridSize = useEditorStore((s) => s.setGridSize)
  const setSmartGuidesEnabled = useEditorStore((s) => s.setSmartGuidesEnabled)
  const canvasZoom = useEditorStore((s) => s.canvasZoom)
  const setCanvasZoom = useEditorStore((s) => s.setCanvasZoom)
  const canvasTool = useEditorStore((s) => s.canvasTool)

  const { width: pw, height: ph } = pageDimensionsPt(pageSpec)
  const { margins: m } = pageSpec
  const pointer =
    canvasPointerPt != null ? `${canvasPointerPt.x} pt, ${canvasPointerPt.y} pt` : '—'

  const chip =
    'rounded border px-1.5 py-0.5 text-[9px] font-medium transition-colors lg:px-2 lg:text-[11px] dark:border-zinc-600'
  const chipOn =
    'border-violet-500 bg-violet-100 text-violet-900 dark:border-violet-500 dark:bg-violet-950/60 dark:text-violet-100'
  const chipOff =
    'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'

  const marginField = (side: keyof typeof m, letter: string) => (
    <label key={side} className="flex items-center gap-0.5" title={`${side} margin (pt)`}>
      <span className="w-2.5 text-[9px] font-semibold text-zinc-500 dark:text-zinc-400">{letter}</span>
      <input
        id={`ag-status-margin-${side}`}
        name={`ag-status-margin-${side}`}
        type="number"
        min={0}
        className={marginInputClass}
        value={m[side]}
        onChange={(e) =>
          setPageMargins({
            [side]: Math.max(0, Math.round(Number(e.target.value) || 0)),
          })
        }
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </label>
  )

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-zinc-200 bg-zinc-50 px-2 py-1 text-[9px] text-zinc-600 lg:gap-x-3 lg:gap-y-1.5 lg:px-3 lg:py-1.5 lg:text-[11px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      <span className="font-semibold text-zinc-800 dark:text-zinc-200">
        {pages[activePageIndex]?.name ?? 'Page'} ({activePageIndex + 1}/{pages.length}) · {pageSpec.size}{' '}
        {pw}×{ph} pt
      </span>
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-l border-zinc-200 pl-3 dark:border-zinc-600"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-zinc-500 lg:inline dark:text-zinc-400">
          Margins (pt)
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {marginField('left', 'L')}
          {marginField('top', 'T')}
          {marginField('right', 'R')}
          {marginField('bottom', 'B')}
        </div>
      </div>
      <span className="hidden tabular-nums lg:inline">Pointer: {pointer}</span>
      <span className="border-l border-zinc-200 pl-3 text-[9px] font-semibold text-zinc-500 lg:text-[11px] dark:border-zinc-600 dark:text-zinc-400">
        {TOOL_LABELS[canvasTool]}
      </span>
      <ZoomDropdown zoom={canvasZoom} setZoom={setCanvasZoom} />
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={`${chip} ${showGrid ? chipOn : chipOff}`}
          onClick={() => setShowGrid(!showGrid)}
          title="Show / hide the grid lines on the canvas"
        >
          Grid
        </button>
        <label
          className="flex items-center gap-1"
          title="Grid spacing in pt"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <select
            className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-[9px] font-medium tabular-nums lg:text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            value={gridSize}
            onChange={(e) => setGridSize(Number(e.target.value))}
          >
            {[5, 8, 10, 15, 20, 25, 50].map((s) => (
              <option key={s} value={s}>{s} pt</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`${chip} ${smartGuidesEnabled ? chipOn : chipOff}`}
          onClick={() => setSmartGuidesEnabled(!smartGuidesEnabled)}
          title="Magenta guides to margins, page center, and other elements"
        >
          Guides
        </button>
      </div>
    </footer>
  )
}
