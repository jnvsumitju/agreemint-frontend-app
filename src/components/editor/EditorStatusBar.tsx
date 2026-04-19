import { useState, useEffect, useRef } from 'react'
import { CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX } from '../../lib/editorConstants'
import type { EditorCanvasTool } from '../../stores/editorStore'
import { useEditorStore } from '../../stores/editorStore'
import { pageDimensionsPt } from '../../types/layout'
import { Badge } from '../ui/Badge'
import { ToggleSwitch } from './ui/ToggleSwitch'
import { Tooltip } from './ui/Tooltip'

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const

const TOOL_LABELS: Record<EditorCanvasTool, string> = {
  select: 'Select',
  move: 'Move',
  draw: 'Place',
  pan: 'Pan',
  rotate: 'Rotate',
}

/* ── Zoom Pill ── */

function ZoomPill({ zoom, setZoom }: { zoom: number; setZoom: (v: number) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const current = Math.round(zoom * 100)
  const atMin = zoom <= CANVAS_ZOOM_MIN + 0.01
  const atMax = zoom >= CANVAS_ZOOM_MAX - 0.01

  return (
    <div
      ref={ref}
      className="relative flex items-center rounded-full border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-l-full text-xs font-bold text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700"
        aria-label="Zoom out"
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
        className="min-w-[2.5rem] px-1 text-center text-[10px] font-semibold tabular-nums text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-700"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        {current}%
      </button>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-r-full text-xs font-bold text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700"
        aria-label="Zoom in"
        disabled={atMax}
        onClick={() => {
          const higher = ZOOM_PRESETS.filter((p) => p > zoom + 0.01)
          if (higher.length) setZoom(higher[0])
        }}
      >
        +
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-[200] mb-1 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800 animate-in fade-in zoom-in-95 duration-150" role="menu">
          {ZOOM_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              className={`block w-full px-4 py-1 text-left text-[11px] font-medium tabular-nums transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                Math.round(p * 100) === current
                  ? 'text-violet-700 dark:text-violet-300'
                  : 'text-zinc-700 dark:text-zinc-200'
              }`}
              onClick={() => { setZoom(p); setOpen(false) }}
            >
              {Math.round(p * 100)}%
            </button>
          ))}
          <div className="my-0.5 border-t border-zinc-100 dark:border-zinc-700" />
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-1 text-left text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
            onClick={() => { setZoom(1); setOpen(false) }}
          >
            Reset to 100%
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Margin Input ── */

function MarginInput({ side, letter, value, onChange }: {
  side: string; letter: string; value: number; onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-0.5" title={`${side} margin (pt)`}>
      <span className="w-2.5 text-[9px] font-semibold text-zinc-400 dark:text-zinc-500">{letter}</span>
      <input
        type="number"
        min={0}
        className="w-8 rounded border border-zinc-200 bg-white px-1 py-0.5 text-[9px] tabular-nums text-zinc-700 outline-none transition-colors focus:border-violet-500 lg:w-10 lg:text-[10px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </label>
  )
}

/* ── Main Status Bar ── */

export function EditorStatusBar() {
  const viewOnly = useEditorStore((s) => s.viewOnly)
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const setPageMargins = useEditorStore((s) => s.setPageMargins)
  const canvasPointerPt = useEditorStore((s) => s.canvasPointerPt)
  const showGrid = useEditorStore((s) => s.showGrid)
  const showRulers = useEditorStore((s) => s.showRulers)
  const gridSize = useEditorStore((s) => s.gridSize)
  const smartGuidesEnabled = useEditorStore((s) => s.smartGuidesEnabled)
  const setShowGrid = useEditorStore((s) => s.setShowGrid)
  const setShowRulers = useEditorStore((s) => s.setShowRulers)
  const setGridSize = useEditorStore((s) => s.setGridSize)
  const setSmartGuidesEnabled = useEditorStore((s) => s.setSmartGuidesEnabled)
  const canvasZoom = useEditorStore((s) => s.canvasZoom)
  const setCanvasZoom = useEditorStore((s) => s.setCanvasZoom)
  const canvasTool = useEditorStore((s) => s.canvasTool)

  const { width: pw, height: ph } = pageDimensionsPt(pageSpec)
  const { margins: m } = pageSpec
  const pointer = canvasPointerPt != null ? `${canvasPointerPt.x}, ${canvasPointerPt.y}` : '—'

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-200 bg-zinc-50/80 px-3 py-1 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/80">
      {/* Page info */}
      <div className="flex items-center gap-2">
        <Badge variant="default" size="sm">
          {pages[activePageIndex]?.name ?? 'Page'} {activePageIndex + 1}/{pages.length}
        </Badge>
        <span className="text-[9px] text-zinc-400 dark:text-zinc-500 lg:text-[10px]">
          {pageSpec.size} · {pw}×{ph} pt
        </span>
      </div>

      {!viewOnly && (
        <>
          {/* Separator */}
          <div className="h-3 w-px bg-zinc-200 dark:bg-zinc-700" />

          {/* Margins */}
          <div
            className="flex items-center gap-1.5"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span className="hidden text-[9px] font-medium text-zinc-400 dark:text-zinc-500 lg:inline">Margins</span>
            <MarginInput side="left" letter="L" value={m.left} onChange={(v) => setPageMargins({ left: v })} />
            <MarginInput side="top" letter="T" value={m.top} onChange={(v) => setPageMargins({ top: v })} />
            <MarginInput side="right" letter="R" value={m.right} onChange={(v) => setPageMargins({ right: v })} />
            <MarginInput side="bottom" letter="B" value={m.bottom} onChange={(v) => setPageMargins({ bottom: v })} />
          </div>
        </>
      )}

      {/* Separator */}
      <div className="h-3 w-px bg-zinc-200 dark:bg-zinc-700" />

      {/* Pointer + Tool */}
      <span className="hidden text-[9px] tabular-nums text-zinc-400 dark:text-zinc-500 lg:inline">{pointer}</span>
      {!viewOnly && (
        <Tooltip content={`Current tool: ${TOOL_LABELS[canvasTool]}`}>
          <Badge variant="primary" size="sm">{TOOL_LABELS[canvasTool]}</Badge>
        </Tooltip>
      )}

      {/* Right section */}
      <div className="ml-auto flex items-center gap-3">
        {/* Zoom pill */}
        <ZoomPill zoom={canvasZoom} setZoom={setCanvasZoom} />

        {/* Separator */}
        <div className="h-3 w-px bg-zinc-200 dark:bg-zinc-700" />

        {/* Grid + Guides toggles */}
        <div className="flex items-center gap-3" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <ToggleSwitch checked={showRulers} onChange={setShowRulers} label="Rulers" />
          <ToggleSwitch checked={showGrid} onChange={setShowGrid} label="Grid" />
          {showGrid && (
            <select
              className="h-5 rounded border border-zinc-200 bg-white px-1 text-[9px] font-medium tabular-nums text-zinc-600 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 lg:text-[10px]"
              value={gridSize}
              onChange={(e) => setGridSize(Number(e.target.value))}
            >
              {[5, 8, 10, 15, 20, 25, 50].map((s) => (
                <option key={s} value={s}>{s}pt</option>
              ))}
            </select>
          )}
          <ToggleSwitch checked={smartGuidesEnabled} onChange={setSmartGuidesEnabled} label="Guides" />
        </div>
      </div>
    </footer>
  )
}
