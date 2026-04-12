import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { findElementByIdInDocumentDeep } from '../../lib/bandNestedLayout'
import { richTextDebugLog } from '../../lib/richTextDebugLog'
import { useEditorStore } from '../../stores/editorStore'
import type { ElementStyle, LayoutElement } from '../../types/layout'
import { isRichTextElement, normalizeColumnWidths } from '../../types/layout'
import {
  type RichRun,
  type TextRunFormatKey,
  parseContentToRuns,
  serializeRunsToContent,
} from '../../lib/richContent'
import { normalizeVariableIdentifier } from '../../lib/variables'
import {
  duplicateColumnBackgroundMap,
  duplicateCellBackgroundColumn,
  reindexColumnBackgroundsAfterDelete,
  reindexCellBackgroundsAfterColumnDelete,
  reindexRowBackgroundsAfterDelete,
  reindexCellBackgroundsAfterRowDelete,
  shiftColumnBackgroundsAfterInsert,
  shiftCellBackgroundsAfterColumnInsert,
  shiftRowBackgroundsAfterInsert,
  shiftCellBackgroundsAfterRowInsert,
  swapColumnBackgroundKeys,
  swapCellBackgroundColumns,
} from '../../lib/tableBackgroundMaps'
import { deleteRowsAt, insertRowAt } from '../../lib/tableDataEdit'
import { TABLE_HEADER_ROW, tableSelectionSummary } from '../../types/tableSelection'
import { RichTextFormatToolbar } from './RichTextFormatToolbar'
import { RichTextTipTapToolbar } from './RichTextTipTapToolbar'
import { ColorToolbarSwatch } from './ColorPalettePopover'

function patchTextRunColor(
  el: LayoutElement,
  runIndex: number,
  key: 'color' | 'highlightColor',
  value: string | undefined,
  updateElement: (id: string, patch: Partial<LayoutElement>) => void
) {
  if (!isRichTextElement(el)) return
  const runs = parseContentToRuns(el.content)
  const r = runs[runIndex]
  if (!r || r.type !== 'text') return
  const next: Extract<RichRun, { type: 'text' }> = { ...r }
  const v = value?.trim()
  if (!v) {
    if (key === 'color') delete next.color
    else delete next.highlightColor
  } else {
    next[key] = v
  }
  runs[runIndex] = next
  updateElement(el.id, { content: serializeRunsToContent(runs) })
}

function mergeElementStyle(
  base: ElementStyle | undefined,
  patch: Partial<ElementStyle>
): ElementStyle | undefined {
  const next: ElementStyle = { ...(base ?? {}), ...patch }
  if (next.color !== undefined && String(next.color).trim() === '') delete next.color
  if (next.backgroundColor !== undefined && String(next.backgroundColor).trim() === '')
    delete next.backgroundColor
  return Object.keys(next).length > 0 ? next : undefined
}

function omitStyleKey(style: ElementStyle | undefined, key: 'color' | 'backgroundColor'): ElementStyle | undefined {
  if (!style) return undefined
  const rest: ElementStyle = { ...style }
  delete rest[key]
  return Object.keys(rest).length > 0 ? rest : undefined
}

function patchTextRunFormat(
  el: LayoutElement,
  runIndex: number,
  key: TextRunFormatKey,
  updateElement: (id: string, patch: Partial<LayoutElement>) => void
) {
  if (!isRichTextElement(el)) return
  const runs = parseContentToRuns(el.content)
  const r = runs[runIndex]
  if (!r || r.type !== 'text') return
  const next = { ...r, type: 'text' as const }
  if (key === 'superscript') {
    next.superscript = !r.superscript
    if (next.superscript) next.subscript = false
  } else if (key === 'subscript') {
    next.subscript = !r.subscript
    if (next.subscript) next.superscript = false
  } else if (key === 'bold') {
    next.bold = !next.bold
  } else if (key === 'italic') {
    next.italic = !next.italic
  } else if (key === 'underline') {
    next.underline = !next.underline
  } else if (key === 'strikethrough') {
    next.strikethrough = !next.strikethrough
  }
  runs[runIndex] = next
  updateElement(el.id, { content: serializeRunsToContent(runs) })
}

const RICH_TEXT_CANVAS_HINT_LONG =
  'Double-click the text on the page to edit inline. While editing, use the top bar for bold, italic, underline, strikethrough, super/subscript, text color, and highlight. Press Escape to cancel or ⌘/Ctrl+Enter to finish.'

const RICH_TEXT_FIELD_SEGMENT_HINT_LONG =
  'A merge field is selected. Double-click the text to edit; bold, italic, and colors apply to text runs, not to merge fields.'

/** Which help copy to show when ⌘/Ctrl+Shift+H is pressed with a rich-text element in context. */
function richTextHelpVariantFromStore(): 'canvas' | 'merge-field' | null {
  const s = useEditorStore.getState()
  const ids = s.selectedIds
  if (ids.length !== 1) return null
  const el = findElementByIdInDocumentDeep(s.pages, ids[0])
  if (!el || !isRichTextElement(el)) return null
  if (s.canvasInlineEditId === el.id) return 'canvas'
  const idx = s.focusedTextRunIndex
  if (idx != null) {
    const runs = parseContentToRuns(el.content)
    const r = runs[idx]
    if (r?.type === 'var') return 'merge-field'
  }
  return 'canvas'
}

/**
 * ⌘/Ctrl+Shift+H only when focus is on the canvas, top header (incl. context toolbar), or the help dialog —
 * not in sidebars (aside), status bar (footer), or form fields.
 */
function isRichTextHelpShortcutFocusAllowed(): boolean {
  const ae = document.activeElement
  if (ae == null || ae === document.body || ae === document.documentElement) return true
  if (!(ae instanceof Element)) return false
  if (ae.closest('aside') || ae.closest('footer')) return false
  if (ae.closest('input, textarea, select')) return false
  if (ae.closest('[data-agreemint-rich-text-help-dialog]')) return true
  if (ae.closest('header') || ae.closest('[data-agreemint-canvas-root]')) return true
  return false
}

function TextElementChrome({
  el,
  updateElement,
}: {
  el: LayoutElement
  updateElement: (id: string, patch: Partial<LayoutElement>) => void
}) {
  if (!isRichTextElement(el)) return null
  const style = el.style ?? {}
  const align = style.align ?? 'left'
  const fs = Math.round(style.fontSize ?? 12)
  const patchStyle = (s: Partial<ElementStyle>) =>
    updateElement(el.id, { style: mergeElementStyle(style, s) })

  const chip = (active: boolean) =>
    `min-w-[1.75rem] rounded border px-2 py-1 text-xs font-medium transition-colors ${
      active
        ? 'border-violet-600 bg-violet-100 text-violet-900 dark:border-violet-500 dark:bg-violet-950/60 dark:text-violet-100'
        : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'
    }`

  return (
    <div
      className="flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-zinc-200 bg-zinc-50/80 px-1 py-1 dark:border-zinc-600 dark:bg-zinc-800/50"
      onMouseDownCapture={(e) => e.button === 0 && e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      role="group"
      aria-label={
        el.type === 'HEADER' ? 'Header block' : el.type === 'FOOTER' ? 'Footer block' : 'Text block'
      }
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Align
      </span>
      {(['left', 'center', 'right'] as const).map((a) => (
        <button
          key={a}
          type="button"
          title={`Align ${a}`}
          className={chip(align === a)}
          onMouseDown={(e) => {
            e.preventDefault()
            patchStyle({ align: a })
          }}
        >
          {a === 'left' ? '◀' : a === 'center' ? '◆' : '▶'}
        </button>
      ))}
      <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Size
      </span>
      <button
        type="button"
        title="Smaller font"
        className={chip(false)}
        onMouseDown={(e) => {
          e.preventDefault()
          patchStyle({ fontSize: Math.max(6, fs - 1) })
        }}
      >
        −
      </button>
      <span className="min-w-[1.5rem] text-center text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
        {fs}
      </span>
      <button
        type="button"
        title="Larger font"
        className={chip(false)}
        onMouseDown={(e) => {
          e.preventDefault()
          patchStyle({ fontSize: Math.min(96, fs + 1) })
        }}
      >
        +
      </button>
      <span className="ml-1 hidden h-4 w-px shrink-0 bg-zinc-300 dark:bg-zinc-600 sm:block" aria-hidden />
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Color
      </span>
      <ColorToolbarSwatch
        title="Text color"
        value={style.color}
        onChange={(v) => patchStyle({ color: v })}
        onClear={() => updateElement(el.id, { style: omitStyleKey(style, 'color') })}
      />
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Bg</span>
      <ColorToolbarSwatch
        title="Background color"
        value={style.backgroundColor}
        onChange={(v) => patchStyle({ backgroundColor: v })}
        onClear={() => updateElement(el.id, { style: omitStyleKey(style, 'backgroundColor') })}
      />
    </div>
  )
}

export function EditorContextToolbar({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const [textHelpOpen, setTextHelpOpen] = useState(false)
  const [textHelpVariant, setTextHelpVariant] = useState<'canvas' | 'merge-field'>('canvas')

  const selectedIds = useEditorStore((s) => s.selectedIds)
  const pages = useEditorStore((s) => s.pages)
  const canvasInlineEditId = useEditorStore((s) => s.canvasInlineEditId)
  const focusedTextRunIndex = useEditorStore((s) => s.focusedTextRunIndex)
  const tableSelection = useEditorStore((s) => s.tableSelection)
  const setTableSelection = useEditorStore((s) => s.setTableSelection)
  const setEditorSidebarTab = useEditorStore((s) => s.setEditorSidebarTab)
  const updateElement = useEditorStore((s) => s.updateElement)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)
  const variableValues = useEditorStore((s) => s.variableValues)
  const inlineTipTapRaw = useEditorStore((s) => s.inlineTipTapEditor)
  const setInlineTipTapEditor = useEditorStore((s) => s.setInlineTipTapEditor)

  /** TipTap can destroy the instance in-place; Zustand still holds the same ref → clear so onReady can re-register. */
  useLayoutEffect(() => {
    const raw = inlineTipTapRaw
    if (!raw?.isDestroyed) return
    if (useEditorStore.getState().inlineTipTapEditor !== raw) return
    setInlineTipTapEditor(null)
  }, [inlineTipTapRaw, setInlineTipTapEditor])

  const tipTapToolbarEditor =
    inlineTipTapRaw && !inlineTipTapRaw.isDestroyed ? inlineTipTapRaw : null

  const onRichTextHelpShortcut = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'h' && e.key !== 'H') return
    if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return
    if (e.repeat) return
    if (!isRichTextHelpShortcutFocusAllowed()) return

    const variant = richTextHelpVariantFromStore()
    if (variant == null) return

    e.preventDefault()
    setTextHelpOpen((open) => {
      if (open) return false
      setTextHelpVariant(variant)
      return true
    })
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onRichTextHelpShortcut, true)
    return () => window.removeEventListener('keydown', onRichTextHelpShortcut, true)
  }, [onRichTextHelpShortcut])

  useEffect(() => {
    if (!textHelpOpen) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setTextHelpOpen(false)
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [textHelpOpen])

  useEffect(() => {
    if (!textHelpOpen) return
    if (richTextHelpVariantFromStore() == null) setTextHelpOpen(false)
  }, [textHelpOpen, selectedIds, canvasInlineEditId, focusedTextRunIndex])

  const primary = selectedIds.length === 1 ? selectedIds[0] : null
  const el = primary ? findElementByIdInDocumentDeep(pages, primary) : undefined

  useEffect(() => {
    if (!primary) return
    const e = findElementByIdInDocumentDeep(pages, primary)
    if (!e || !isRichTextElement(e)) return
    if (canvasInlineEditId !== e.id) return
    richTextDebugLog('context-toolbar', 'canvas inline + TipTap toolbar wiring', {
      elId: e.id,
      elType: e.type,
      canvasInlineEditId,
      hasInlineTipTapEditor: !!inlineTipTapRaw,
      inlineEditorDestroyed: inlineTipTapRaw?.isDestroyed,
    })
  }, [primary, pages, canvasInlineEditId, inlineTipTapRaw])

  const textHelpDialog =
    textHelpOpen &&
    createPortal(
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4"
        role="presentation"
        onClick={() => setTextHelpOpen(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ag-rich-text-help-title"
          data-agreemint-rich-text-help-dialog
          className="max-h-[min(90vh,28rem)] max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-600 dark:bg-zinc-900"
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id="ag-rich-text-help-title"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {textHelpVariant === 'merge-field' ? 'Merge fields on canvas' : 'Editing text on canvas'}
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            {textHelpVariant === 'merge-field' ? RICH_TEXT_FIELD_SEGMENT_HINT_LONG : RICH_TEXT_CANVAS_HINT_LONG}
          </p>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Shortcut: <span className="font-mono">⌘/Ctrl+Shift+H</span> toggles this window when focus is on the
            canvas or top toolbar (not the side panels or status bar). Press Escape or click outside to close.
          </p>
          <button
            type="button"
            className="mt-4 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            onClick={() => setTextHelpOpen(false)}
          >
            Close
          </button>
        </div>
      </div>,
      document.body
    )

  let body: ReactNode = null

  if (el && isRichTextElement(el)) {
    const runs = parseContentToRuns(el.content)
    const isCanvasEditing = canvasInlineEditId === el.id
    const chrome = <TextElementChrome el={el} updateElement={updateElement} />

    let formatSection: ReactNode
    if (isCanvasEditing) {
      formatSection = (
        <RichTextTipTapToolbar editor={tipTapToolbarEditor} canvasEditing={isCanvasEditing} />
      )
    } else if (focusedTextRunIndex != null && focusedTextRunIndex < runs.length) {
      const r = runs[focusedTextRunIndex]
      if (r?.type === 'text') {
        formatSection = (
          <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
            <RichTextFormatToolbar
              bold={!!r.bold}
              italic={!!r.italic}
              underline={!!r.underline}
              strikethrough={!!r.strikethrough}
              superscript={!!r.superscript}
              subscript={!!r.subscript}
              onToggle={(key) => patchTextRunFormat(el, focusedTextRunIndex, key, updateElement)}
            />
            <div
              className="flex shrink-0 flex-nowrap items-center gap-1 border-b border-zinc-200 bg-zinc-50/90 px-1 py-1 dark:border-zinc-600 dark:bg-zinc-800/60"
              onMouseDown={(e) => e.preventDefault()}
            >
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Selection</span>
              <ColorToolbarSwatch
                title="Text color (this segment)"
                value={r.color}
                onChange={(v) =>
                  patchTextRunColor(el, focusedTextRunIndex, 'color', v, updateElement)
                }
                onClear={() =>
                  patchTextRunColor(el, focusedTextRunIndex, 'color', undefined, updateElement)
                }
              />
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">HL</span>
              <ColorToolbarSwatch
                title="Highlight (this segment)"
                value={r.highlightColor}
                onChange={(v) =>
                  patchTextRunColor(el, focusedTextRunIndex, 'highlightColor', v, updateElement)
                }
                onClear={() =>
                  patchTextRunColor(
                    el,
                    focusedTextRunIndex,
                    'highlightColor',
                    undefined,
                    updateElement
                  )
                }
              />
            </div>
          </div>
        )
      } else {
        formatSection = null
      }
    } else {
      formatSection = null
    }

    body = (
      <div
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-x-3"
        onMouseDownCapture={(e) => isCanvasEditing && e.button === 0 && e.preventDefault()}
      >
        {formatSection ? (
          <>
            <div className="flex min-h-0 min-w-0 flex-1 items-center overflow-x-auto">{formatSection}</div>
            <div className="hidden h-6 shrink-0 self-center sm:block sm:w-px sm:bg-zinc-300 dark:sm:bg-zinc-600" />
          </>
        ) : null}
        <div className={`min-w-0 overflow-x-auto ${formatSection ? 'sm:shrink-0' : 'flex-1'}`}>{chrome}</div>
      </div>
    )
  } else if (el?.type === 'TABLE') {
    const cols = el.columns ?? []
    const HEADER_ROW = TABLE_HEADER_ROW
    const dk = el.dataKey ?? 'items'
    const rawJson = variableValues[dk] ?? ''

    const ts = tableSelection?.tableId === el.id ? tableSelection : null

    const activeColIndices =
      ts?.mode === 'columns'
        ? [...new Set(ts.cols)].sort((a, b) => a - b)
        : ts?.mode === 'cell' && ts.col >= 0
          ? [ts.col]
          : []
    const minCol = activeColIndices.length ? activeColIndices[0] : null
    const maxCol = activeColIndices.length ? activeColIndices[activeColIndices.length - 1] : null
    const singleCol = activeColIndices.length === 1 ? activeColIndices[0] : null

    const dataRowIndices =
      ts?.mode === 'rows'
        ? [...new Set(ts.rows)].filter((r) => r >= 0).sort((a, b) => a - b)
        : ts?.mode === 'cell' && ts.row >= 0
          ? [ts.row]
          : []

    const insertColumnAt = (index: number) => {
      const next = [...cols]
      const n = next.length + 1
      const insertAt = Math.max(0, Math.min(index, next.length))
      next.splice(insertAt, 0, { header: `Column ${n}`, key: `col_${n}` })
      const weights = normalizeColumnWidths(cols.length, el.columnWidths)
      weights.splice(insertAt, 0, 1)
      updateElement(el.id, {
        columns: next,
        columnWidths: weights,
        tableColumnBackgrounds: shiftColumnBackgroundsAfterInsert(el.tableColumnBackgrounds, insertAt),
        tableCellBackgrounds: shiftCellBackgroundsAfterColumnInsert(el.tableCellBackgrounds, insertAt),
      })
    }

    const deleteActiveColumns = () => {
      if (!activeColIndices.length) return
      if (cols.length <= activeColIndices.length) return
      const toRemove = [...activeColIndices].sort((a, b) => b - a)
      const removedAsc = [...activeColIndices].sort((a, b) => a - b)
      const next = [...cols]
      const w = normalizeColumnWidths(cols.length, el.columnWidths)
      for (const c of toRemove) {
        if (next.length <= 1) break
        next.splice(c, 1)
        w.splice(c, 1)
      }
      updateElement(el.id, {
        columns: next,
        columnWidths: w,
        tableColumnBackgrounds: reindexColumnBackgroundsAfterDelete(el.tableColumnBackgrounds, removedAsc),
        tableCellBackgrounds: reindexCellBackgroundsAfterColumnDelete(el.tableCellBackgrounds, removedAsc),
      })
      setTableSelection(null)
    }

    const moveColumn = (dir: -1 | 1) => {
      if (singleCol == null) return
      const i = singleCol
      const j = i + dir
      if (j < 0 || j >= cols.length) return
      const next = [...cols]
      const w = normalizeColumnWidths(cols.length, el.columnWidths)
      ;[next[i], next[j]] = [next[j], next[i]]
      ;[w[i], w[j]] = [w[j], w[i]]
      updateElement(el.id, {
        columns: next,
        columnWidths: w,
        tableColumnBackgrounds: swapColumnBackgroundKeys(el.tableColumnBackgrounds, i, j),
        tableCellBackgrounds: swapCellBackgroundColumns(el.tableCellBackgrounds, i, j),
      })
      const row =
        ts?.mode === 'cell' ? ts.row : HEADER_ROW
      setTableSelection({ tableId: el.id, mode: 'cell', row, col: j })
    }

    const duplicateColumn = () => {
      const src = maxCol ?? singleCol
      if (src == null) return
      const c = cols[src]
      const next = [...cols]
      const w = normalizeColumnWidths(cols.length, el.columnWidths)
      const newKey = normalizeVariableIdentifier(`${c.key}_2`)
      next.splice(src + 1, 0, { header: c.header, key: newKey })
      w.splice(src + 1, 0, w[src])
      updateElement(el.id, {
        columns: next,
        columnWidths: w,
        tableColumnBackgrounds: duplicateColumnBackgroundMap(el.tableColumnBackgrounds, src),
        tableCellBackgrounds: duplicateCellBackgroundColumn(el.tableCellBackgrounds, src),
      })
      const row = ts?.mode === 'cell' ? ts.row : HEADER_ROW
      setTableSelection({ tableId: el.id, mode: 'cell', row, col: src + 1 })
    }

    const deleteDataRows = () => {
      if (!dataRowIndices.length) return
      const removedAsc = [...new Set(dataRowIndices)].sort((a, b) => a - b)
      const next = deleteRowsAt(rawJson, dataRowIndices)
      setVariableValue(dk, next)
      updateElement(el.id, {
        tableRowBackgrounds: reindexRowBackgroundsAfterDelete(el.tableRowBackgrounds, removedAsc),
        tableCellBackgrounds: reindexCellBackgroundsAfterRowDelete(el.tableCellBackgrounds, removedAsc),
      })
      setTableSelection(null)
    }

    const insertOneRowAfterSelection = () => {
      let at = 0
      if (dataRowIndices.length > 0) {
        at = dataRowIndices[dataRowIndices.length - 1] + 1
      } else if (ts?.mode === 'cell' && ts.row >= 0) {
        at = ts.row + 1
      } else if (ts?.mode === 'cell' && ts.row === HEADER_ROW) {
        at = 0
      }
      const next = insertRowAt(rawJson, at)
      setVariableValue(dk, next)
      updateElement(el.id, {
        tableRowBackgrounds: shiftRowBackgroundsAfterInsert(el.tableRowBackgrounds, at),
        tableCellBackgrounds: shiftCellBackgroundsAfterRowInsert(el.tableCellBackgrounds, at),
      })
    }

    const barBtn =
      'rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700'
    const barBtnHi =
      'rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/40'

    const summaryBtn =
      `${barBtn} flex cursor-pointer list-none items-center gap-0.5 [&::-webkit-details-marker]:hidden`

    const selectionHint = ts ? tableSelectionSummary(ts) : 'Nothing selected on table'
    const kindLine =
      ts == null
        ? 'Click a column letter, row number, or a cell. ⌘/Ctrl+click extends column or row selection.'
        : ts.mode === 'cell'
          ? ts.row === HEADER_ROW
            ? 'Header cell — double-click the cell on the canvas to edit plain text (variables preserved in Properties).'
            : 'Data cell — double-click to edit the preview value (updates Variables JSON).'
          : ts.mode === 'columns'
            ? activeColIndices.length > 1
              ? `${activeColIndices.length} columns — insert wraps selection; remove deletes all selected.`
              : 'One column — move/duplicate apply to that column.'
            : ts.mode === 'rows'
              ? dataRowIndices.length > 0
                ? `${dataRowIndices.length} data row(s) in selection — remove deletes those rows from JSON.`
                : 'Header row only — use column tools or cells to edit headers.'
              : ''

    body = (
      <div className="flex min-w-0 flex-col gap-1 px-1 py-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Table</span>
          <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Text</span>
          <ColorToolbarSwatch
            title="Cell text color"
            value={el.style?.color}
            onChange={(v) =>
              updateElement(el.id, {
                style: mergeElementStyle(el.style, { color: v }),
              })
            }
            onClear={() => updateElement(el.id, { style: omitStyleKey(el.style, 'color') })}
          />
          {ts && ts.mode === 'cell' ? (
            <>
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Cell fill</span>
              <ColorToolbarSwatch
                title="Background for selected cell"
                value={el.tableCellBackgrounds?.[`${ts.row},${ts.col}`]?.trim()}
                onChange={(hex) => {
                  const next = { ...(el.tableCellBackgrounds ?? {}) }
                  next[`${ts.row},${ts.col}`] = hex
                  updateElement(el.id, { tableCellBackgrounds: next })
                }}
                onClear={
                  el.tableCellBackgrounds?.[`${ts.row},${ts.col}`]?.trim()
                    ? () => {
                        const next = { ...(el.tableCellBackgrounds ?? {}) }
                        delete next[`${ts.row},${ts.col}`]
                        updateElement(el.id, {
                          tableCellBackgrounds: Object.keys(next).length ? next : undefined,
                        })
                      }
                    : undefined
                }
              />
            </>
          ) : null}
          {ts && ts.mode === 'rows' && ts.rows.length > 0 ? (
            <>
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Row fill</span>
              <ColorToolbarSwatch
                title="Background for selected row(s)"
                value={el.tableRowBackgrounds?.[String(ts.rows[0])]?.trim()}
                onChange={(hex) => {
                  const next = { ...(el.tableRowBackgrounds ?? {}) }
                  for (const r of ts.rows) next[String(r)] = hex
                  updateElement(el.id, { tableRowBackgrounds: next })
                }}
                onClear={
                  ts.rows.some((r) => el.tableRowBackgrounds?.[String(r)]?.trim())
                    ? () => {
                        const next = { ...(el.tableRowBackgrounds ?? {}) }
                        for (const r of ts.rows) delete next[String(r)]
                        updateElement(el.id, {
                          tableRowBackgrounds: Object.keys(next).length ? next : undefined,
                        })
                      }
                    : undefined
                }
              />
            </>
          ) : null}
          {ts && ts.mode === 'columns' && ts.cols.length > 0 ? (
            <>
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Col fill</span>
              <ColorToolbarSwatch
                title="Background for selected column(s)"
                value={el.tableColumnBackgrounds?.[String(ts.cols[0])]?.trim()}
                onChange={(hex) => {
                  const next = { ...(el.tableColumnBackgrounds ?? {}) }
                  for (const c of ts.cols) next[String(c)] = hex
                  updateElement(el.id, { tableColumnBackgrounds: next })
                }}
                onClear={
                  ts.cols.some((c) => el.tableColumnBackgrounds?.[String(c)]?.trim())
                    ? () => {
                        const next = { ...(el.tableColumnBackgrounds ?? {}) }
                        for (const c of ts.cols) delete next[String(c)]
                        updateElement(el.id, {
                          tableColumnBackgrounds: Object.keys(next).length ? next : undefined,
                        })
                      }
                    : undefined
                }
              />
            </>
          ) : null}
          <span
            className="max-w-[14rem] truncate text-[10px] font-medium text-violet-700 dark:text-violet-300"
            title={selectionHint}
          >
            {selectionHint}
          </span>
          <button
            type="button"
            className={barBtnHi}
            title="Edit JSON row data in Variables tab"
            onClick={() => setEditorSidebarTab('variables')}
          >
            Row data
          </button>
          <button
            type="button"
            className={barBtn}
            disabled={!dataRowIndices.length}
            title="Remove selected data rows from JSON"
            onClick={deleteDataRows}
          >
            Remove row(s)
          </button>
          <button
            type="button"
            className={barBtn}
            title="Insert a row (after last selected data row, after focused cell, or at start)"
            onClick={insertOneRowAfterSelection}
          >
            + Row
          </button>
          <details className="relative">
            <summary className={summaryBtn}>
              Columns <span className="text-zinc-400">▾</span>
            </summary>
            <div className="absolute left-0 top-[calc(100%+6px)] z-[200] flex w-max min-w-[14rem] flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-600 dark:bg-zinc-800">
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                {activeColIndices.length
                  ? `${activeColIndices.length} column(s) targeted.`
                  : 'Select a column (letter or header) or a cell.'}
              </p>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className={barBtn}
                  title="Insert column before leftmost selected"
                  onClick={() => insertColumnAt(minCol ?? 0)}
                >
                  + Before
                </button>
                <button
                  type="button"
                  className={barBtn}
                  title="Insert column after rightmost selected"
                  onClick={() => insertColumnAt(maxCol != null ? maxCol + 1 : cols.length)}
                >
                  + After
                </button>
                <button
                  type="button"
                  className={barBtn}
                  disabled={
                    !activeColIndices.length || cols.length <= activeColIndices.length
                  }
                  title="Delete selected column(s)"
                  onClick={deleteActiveColumns}
                >
                  Remove
                </button>
              </div>
              <div className="flex flex-wrap gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-700">
                <button
                  type="button"
                  className={barBtn}
                  disabled={singleCol == null || singleCol < 1}
                  title="Move column left"
                  onClick={() => moveColumn(-1)}
                >
                  ← Move
                </button>
                <button
                  type="button"
                  className={barBtn}
                  disabled={singleCol == null || singleCol >= cols.length - 1}
                  title="Move column right"
                  onClick={() => moveColumn(1)}
                >
                  Move →
                </button>
                <button
                  type="button"
                  className={barBtn}
                  disabled={maxCol == null && singleCol == null}
                  title="Duplicate rightmost selected column"
                  onClick={duplicateColumn}
                >
                  Duplicate
                </button>
              </div>
              <div className="flex flex-wrap gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-700">
                <button
                  type="button"
                  className={barBtn}
                  title="Reset all columns to equal width"
                  onClick={() => updateElement(el.id, { columnWidths: undefined })}
                >
                  Equal widths
                </button>
                <button
                  type="button"
                  className={barBtn}
                  title="Reset all body rows to equal height"
                  onClick={() => updateElement(el.id, { tableRowWeights: undefined })}
                >
                  Equal heights
                </button>
                <button
                  type="button"
                  className={barBtn}
                  title="Clear all row, column, and cell fill colors"
                  onClick={() => updateElement(el.id, {
                    tableRowBackgrounds: undefined,
                    tableColumnBackgrounds: undefined,
                    tableCellBackgrounds: undefined,
                  })}
                >
                  Clear fills
                </button>
              </div>
            </div>
          </details>
        </div>
        <p className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{kindLine}</p>
      </div>
    )
  } else if (el?.type === 'IMAGE') {
    const st = el.style
    body = (
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Image</span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Border</span>
        <ColorToolbarSwatch
          title="Border color"
          value={st?.color}
          onChange={(v) =>
            updateElement(el.id, { style: mergeElementStyle(st, { color: v }) })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'color') })}
        />
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Fill</span>
        <ColorToolbarSwatch
          title="Backdrop color"
          value={st?.backgroundColor}
          onChange={(v) =>
            updateElement(el.id, {
              style: mergeElementStyle(st, { backgroundColor: v }),
            })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'backgroundColor') })}
        />
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">· URL & size in Properties</span>
      </div>
    )
  } else if (el?.type === 'LINE') {
    const sw = el.strokeWidth ?? 1
    const st = el.style
    const setStroke = (next: number) =>
      updateElement(el.id, { strokeWidth: Math.max(0.5, next) })
    body = (
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Line</span>
        <button
          type="button"
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          onClick={() => setStroke(sw - 0.5)}
        >
          Thinner
        </button>
        <button
          type="button"
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          onClick={() => setStroke(sw + 0.5)}
        >
          Thicker
        </button>
        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{sw}px</span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Stroke</span>
        <ColorToolbarSwatch
          title="Line color"
          value={st?.color}
          onChange={(v) =>
            updateElement(el.id, { style: mergeElementStyle(st, { color: v }) })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'color') })}
        />
      </div>
    )
  } else if (el?.type === 'BOX') {
    const st = el.style
    body = (
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Box</span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Border</span>
        <ColorToolbarSwatch
          title="Border color"
          value={st?.color}
          onChange={(v) =>
            updateElement(el.id, { style: mergeElementStyle(st, { color: v }) })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'color') })}
        />
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Fill</span>
        <ColorToolbarSwatch
          title="Fill color"
          value={st?.backgroundColor}
          onChange={(v) =>
            updateElement(el.id, {
              style: mergeElementStyle(st, { backgroundColor: v }),
            })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'backgroundColor') })}
        />
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">· Layout in Properties</span>
      </div>
    )
  } else if (
    el &&
    (el.type === 'ELLIPSE' ||
      el.type === 'TRIANGLE' ||
      el.type === 'ARROW' ||
      el.type === 'DIAMOND' ||
      el.type === 'STAR' ||
      el.type === 'RING' ||
      el.type === 'MERGED_SHAPE')
  ) {
    const sw = el.strokeWidth ?? 2
    const st = el.style
    const setStroke = (next: number) =>
      updateElement(el.id, { strokeWidth: Math.max(0.5, next) })
    const label =
      el.type === 'MERGED_SHAPE'
        ? 'Merged'
        : el.type === 'ELLIPSE'
          ? 'Ellipse'
          : el.type === 'TRIANGLE'
            ? 'Triangle'
            : el.type === 'ARROW'
              ? 'Arrow'
              : el.type === 'DIAMOND'
                ? 'Diamond'
                : el.type === 'RING'
                  ? 'Ring'
                  : 'Star'
    body = (
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
        <button
          type="button"
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          onClick={() => setStroke(sw - 0.5)}
        >
          Thinner
        </button>
        <button
          type="button"
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          onClick={() => setStroke(sw + 0.5)}
        >
          Thicker
        </button>
        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{sw}px</span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Stroke</span>
        <ColorToolbarSwatch
          title="Outline color"
          value={st?.color}
          onChange={(v) =>
            updateElement(el.id, { style: mergeElementStyle(st, { color: v }) })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'color') })}
        />
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Fill</span>
        <ColorToolbarSwatch
          title="Fill color"
          value={st?.backgroundColor}
          onChange={(v) =>
            updateElement(el.id, {
              style: mergeElementStyle(st, { backgroundColor: v }),
            })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'backgroundColor') })}
        />
      </div>
    )
  }

  if (!el) {
    return (
      <>
        <div
          ref={containerRef}
          data-agreemint-context-toolbar
          className="flex min-h-[2.25rem] min-w-0 flex-1 items-center border-l border-zinc-200 pl-4 dark:border-zinc-600"
        >
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Select an element</p>
        </div>
        {textHelpDialog}
      </>
    )
  }

  const scrollClass =
    el.type === 'TABLE' ? 'min-w-0 flex-1 overflow-visible' : 'min-w-0 flex-1 overflow-x-auto'

  return (
    <>
      <div
        ref={containerRef}
        data-agreemint-context-toolbar
        className="flex min-h-[2.25rem] min-w-0 flex-1 items-center border-l border-zinc-200 py-0.5 pl-4 dark:border-zinc-600"
      >
        <div className={scrollClass}>{body}</div>
      </div>
      {textHelpDialog}
    </>
  )
}
