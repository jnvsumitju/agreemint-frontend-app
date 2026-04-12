import { useEditorStore } from '../../stores/editorStore'
import { pageDimensionsPt } from '../../types/layout'

const marginInputClass =
  'w-10 rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px] tabular-nums dark:border-zinc-600 dark:bg-zinc-800'

export function EditorStatusBar() {
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const setPageMargins = useEditorStore((s) => s.setPageMargins)
  const canvasPointerPt = useEditorStore((s) => s.canvasPointerPt)
  const snapToGrid = useEditorStore((s) => s.snapToGrid)
  const smartGuidesEnabled = useEditorStore((s) => s.smartGuidesEnabled)
  const setSnapToGrid = useEditorStore((s) => s.setSnapToGrid)
  const setSmartGuidesEnabled = useEditorStore((s) => s.setSmartGuidesEnabled)
  const canvasZoom = useEditorStore((s) => s.canvasZoom)
  const adjustCanvasZoom = useEditorStore((s) => s.adjustCanvasZoom)
  const setCanvasZoom = useEditorStore((s) => s.setCanvasZoom)

  const { width: pw, height: ph } = pageDimensionsPt(pageSpec)
  const { margins: m } = pageSpec
  const pointer =
    canvasPointerPt != null ? `${canvasPointerPt.x} pt, ${canvasPointerPt.y} pt` : '—'

  const chip =
    'rounded border px-2 py-0.5 text-[11px] font-medium transition-colors dark:border-zinc-600'
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
    <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      <span className="font-semibold text-zinc-800 dark:text-zinc-200">
        {pages[activePageIndex]?.name ?? 'Page'} ({activePageIndex + 1}/{pages.length}) · {pageSpec.size}{' '}
        {pw}×{ph} pt
      </span>
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-l border-zinc-200 pl-3 dark:border-zinc-600"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Margins (pt)
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {marginField('left', 'L')}
          {marginField('top', 'T')}
          {marginField('right', 'R')}
          {marginField('bottom', 'B')}
        </div>
      </div>
      <span className="hidden sm:inline">Grid 10 pt</span>
      <span className="tabular-nums">Pointer: {pointer}</span>
      <div
        className="flex flex-wrap items-center gap-1 border-l border-zinc-200 pl-3 dark:border-zinc-600"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Canvas zoom
        </span>
        <div className="flex items-center gap-0.5 rounded border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-800">
          <button
            type="button"
            className="px-2 py-0.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={canvasZoom <= 0.26}
            onClick={() => adjustCanvasZoom(1 / 1.15)}
          >
            −
          </button>
          <button
            type="button"
            className="min-w-[2.75rem] px-1 py-0.5 text-center text-[11px] font-medium tabular-nums text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-700"
            title="Reset zoom to 100%"
            onClick={() => setCanvasZoom(1)}
          >
            {Math.round(canvasZoom * 100)}%
          </button>
          <button
            type="button"
            className="px-2 py-0.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={canvasZoom >= 2.99}
            onClick={() => adjustCanvasZoom(1.15)}
          >
            +
          </button>
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={`${chip} ${snapToGrid ? chipOn : chipOff}`}
          onClick={() => setSnapToGrid(!snapToGrid)}
          title="Snap moves and resizes to the 10 pt grid when not aligned to a guide"
        >
          Snap to grid
        </button>
        <button
          type="button"
          className={`${chip} ${smartGuidesEnabled ? chipOn : chipOff}`}
          onClick={() => setSmartGuidesEnabled(!smartGuidesEnabled)}
          title="Magenta guides to margins, page center, and other elements"
        >
          Smart guides
        </button>
      </div>
    </footer>
  )
}
