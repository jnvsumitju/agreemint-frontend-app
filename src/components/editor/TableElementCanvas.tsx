import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import {
  activeCanvasTipTapEditorByElementId,
  registerActiveCanvasTipTapEditor,
  unregisterActiveCanvasTipTapEditor,
  useEditorStore,
} from '../../stores/editorStore'
import {
  normalizeColumnWidths,
  normalizeRowWeights,
  type LayoutElement,
} from '../../types/layout'
import {
  excelColumnLabel,
  formatPreviewCellValue,
  getTableDataSourceState,
  getVisibleTableBodyRows,
  tablePreviewBodyRowCount,
} from '../../lib/tablePreview'
import {
  tableCellBehaviourStyle,
  variableMergeFieldSurfaceLabel,
  variableValuesToDataTree,
} from '../../lib/layoutBehaviourResolve'
import { RichTextBlockPreview } from './RichTextBlockPreview'
import {
  TABLE_BLOCK_SELECTION_FILL,
  TABLE_HEADER_ROW,
  columnBlockSelectionClasses,
  columnLetterSelectionClasses,
  isCellHighlighted,
  rowBlockSelectionClasses,
  toggleColumnSelection,
  toggleRowSelection,
  type TableSelection,
} from '../../types/tableSelection'
import {
  shiftColumnBackgroundsAfterInsert,
  shiftRowBackgroundsAfterInsert,
  shiftCellBackgroundsAfterColumnInsert,
  shiftCellBackgroundsAfterRowInsert,
} from '../../lib/tableBackgroundMaps'
import {
  getDataCellStringValue,
  insertRowAt,
  setDataCellValue,
} from '../../lib/tableDataEdit'
import { TipTapRichEditor } from './TipTapRichEditor'
import type { VariableMentionItem } from '../../lib/layoutBehaviourResolve'
import {
  availableVariableMentionsForMentionSuggest,
  resolveVariableChipInfo,
} from '../../lib/layoutBehaviourResolve'

const HEADER_ROW = TABLE_HEADER_ROW

const BLOCK_SEL_INSET =
  'inset 0 0 0 100vmax rgba(139,92,246,0.14)' as const

function mergeBlockSelectionStyle(
  fillBg: string | undefined,
  hasBlockOutline: boolean
): CSSProperties | undefined {
  if (!hasBlockOutline) return fillBg ? { backgroundColor: fillBg } : undefined
  if (fillBg) {
    return { backgroundColor: fillBg, boxShadow: BLOCK_SEL_INSET }
  }
  return undefined
}

/** Effective background: cell fill > column fill > row fill. */
function tableCellEffectiveBackground(
  table: LayoutElement,
  row: number,
  col: number
): string | undefined {
  const cellBg = table.tableCellBackgrounds?.[`${row},${col}`]?.trim()
  if (cellBg) return cellBg
  const colBg = table.tableColumnBackgrounds?.[String(col)]?.trim()
  if (colBg) return colBg
  const rowBg = table.tableRowBackgrounds?.[String(row)]?.trim()
  return rowBg || undefined
}

/** TABLE row; caller must pass a table element (see `EditorCanvas`). */
export type LayoutTableElement = LayoutElement & { type: 'TABLE' }

export function TableElementCanvas({ el, locked = false }: { el: LayoutTableElement; locked?: boolean }) {
  const select = useEditorStore((s) => s.select)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const tableSelection = useEditorStore((s) => s.tableSelection)
  const setTableSelection = useEditorStore((s) => s.setTableSelection)
  const openTableCellEdit = useEditorStore((s) => s.openTableCellEdit)
  const setTableCellEdit = useEditorStore((s) => s.setTableCellEdit)
  const tableCellEdit = useEditorStore((s) => s.tableCellEdit)
  const updateElement = useEditorStore((s) => s.updateElement)
  const beginHistoryBatch = useEditorStore((s) => s.beginHistoryBatch)
  const endHistoryBatch = useEditorStore((s) => s.endHistoryBatch)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)
  const variableValues = useEditorStore((s) => s.variableValues)
  const setInlineTipTapEditor = useEditorStore((s) => s.setInlineTipTapEditor)
  const globalVariableDefinitions = useEditorStore((s) => s.globalVariableDefinitions)
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)

  const variableSurfaceLabelResolver = useMemo(
    () => (n: string) => variableMergeFieldSurfaceLabel(n, globalVariableDefinitions, pages[activePageIndex]),
    [globalVariableDefinitions, pages, activePageIndex]
  )

  const variableMentions: VariableMentionItem[] = useMemo(
    () => availableVariableMentionsForMentionSuggest(globalVariableDefinitions, pages, activePageIndex, variableValues),
    [globalVariableDefinitions, pages, activePageIndex, variableValues]
  )

  const resolveVariableChipDetail = useCallback(
    (name: string) => resolveVariableChipInfo(name, globalVariableDefinitions, pages[activePageIndex], variableValues),
    [globalVariableDefinitions, pages, activePageIndex, variableValues]
  )

  const selected = selectedIds.includes(el.id)
  const tableKeyboardFocus = selectedIds.length === 1 && selectedIds[0] === el.id
  const cols = el.columns?.length ? el.columns : [{ header: 'Column', key: 'col' }]
  const columnWidthsKey = useMemo(
    () => JSON.stringify(el.columnWidths ?? []),
    [el.columnWidths]
  )
  const rowWeightsKey = useMemo(
    () => JSON.stringify(el.tableRowWeights ?? []),
    [el.tableRowWeights]
  )
  const weights = useMemo(
    () => normalizeColumnWidths(cols.length, el.columnWidths),
    [cols.length, columnWidthsKey]
  )
  const colTemplate = weights.map((w) => `${w}fr`).join(' ')
  const previewDataTree = useMemo(
    () => variableValuesToDataTree(variableValues),
    [variableValues]
  )
  const previewBodyRows = useMemo(() => tablePreviewBodyRowCount(el), [el.id, el.tablePreviewBodyRows, el.type])
  const rowWeights = useMemo(
    () => normalizeRowWeights(previewBodyRows, el.tableRowWeights),
    [previewBodyRows, rowWeightsKey]
  )
  const visibleBodyRows = useMemo(
    () => getVisibleTableBodyRows(el, variableValues, previewBodyRows),
    [el, variableValues, previewBodyRows]
  )
  const dataState = getTableDataSourceState(el, variableValues)
  const pinnedLetters = el.tableShowColumnLetters === true
  const pinnedRows = el.tableShowRowNumbers === true
  const [peekLetters, setPeekLetters] = useState(false)
  const [peekRows, setPeekRows] = useState(false)
  const peekRef = useRef({ l: false, r: false })
  const showColLetters = pinnedLetters || peekLetters
  const showRowNumbers = pinnedRows || peekRows
  /** Cell grid only — letters/row gutters are absolutely positioned outside so toggles do not resize cells. */
  const gridTemplateColumns = colTemplate
  /** Header is content-sized (`auto`); extra height is split among body rows via `tableRowWeights` `fr`. */
  const gridTemplateRows =
    `minmax(20px, auto) ${rowWeights.map((w) => `minmax(10px, ${w}fr)`).join(' ')}`.trim()

  const gridRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const headerGutterRef = useRef<HTMLDivElement>(null)
  const dataGutterRefs = useRef<(HTMLDivElement | null)[]>([])
  /** Refs to one cell per grid row (first column) to measure actual row positions. */
  const headerRowRef = useRef<HTMLDivElement>(null)
  const bodyRowRefs = useRef<(HTMLDivElement | null)[]>([])
  const [gutterPositions, setGutterPositions] = useState<{ top: number; height: number }[]>([])
  const resizeRef = useRef<{
    index: number
    startX: number
    startWeights: number[]
    widthPx: number
  } | null>(null)
  const rowResizeRef = useRef<{
    index: number
    startY: number
    startWeights: number[]
    heightPx: number
  } | null>(null)

  const [rowInsertZones, setRowInsertZones] = useState<{ top: number; insertIndex: number }[]>([])

  const dk = el.dataKey ?? 'items'
  const rawJson = variableValues[dk] ?? ''

  const isEditing =
    tableCellEdit != null &&
    tableCellEdit.tableId === el.id &&
    selected &&
    tableSelection?.mode === 'cell' &&
    tableSelection.tableId === el.id &&
    tableSelection.row === tableCellEdit.row &&
    tableSelection.col === tableCellEdit.col

  const editingIsHeader = isEditing && tableCellEdit?.row === HEADER_ROW

  useEffect(() => {
    if (!isEditing || !tableCellEdit || tableCellEdit.tableId !== el.id) return
    // Both header and body use TipTap now — no draft needed
  }, [isEditing, tableCellEdit?.tableId, tableCellEdit?.row, tableCellEdit?.col, el.id, cols, rawJson, variableValues])

  const clearTablePeek = useCallback(() => {
    peekRef.current = { l: false, r: false }
    setPeekLetters(false)
    setPeekRows(false)
  }, [])

  useEffect(() => {
    clearTablePeek()
  }, [el.id, clearTablePeek])

  const handleTablePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const grid = gridRef.current
      if (!grid) return
      const pinL = el.tableShowColumnLetters === true
      const pinR = el.tableShowRowNumbers === true
      const gr = grid.getBoundingClientRect()
      const x = e.clientX - gr.left
      const y = e.clientY - gr.top
      const W = gr.width
      const H = gr.height
      const bandTop = 14
      const gutterLeft = 20
      const inCorner = x >= -gutterLeft && x < 0 && y >= -bandTop && y < 0
      const inTopBand = y >= -bandTop && y < 0 && x >= -gutterLeft && x <= W
      const inLeftStrip = x >= -gutterLeft && x < 0 && y >= 0 && y <= H
      const inCells = x >= 0 && y >= 0 && x <= W && y <= H
      const nextL = pinL || inTopBand || inCorner || inCells
      const nextR = pinR || inLeftStrip || inCorner || inCells
      const pr = peekRef.current
      if (pr.l === nextL && pr.r === nextR) return
      pr.l = nextL
      pr.r = nextR
      setPeekLetters(nextL)
      setPeekRows(nextR)
    },
    [el.tableShowColumnLetters, el.tableShowRowNumbers]
  )

  const handleTablePointerOut = useCallback(
    (e: React.PointerEvent) => {
      const rel = e.relatedTarget
      if (rel && e.currentTarget.contains(rel as Node)) return
      clearTablePeek()
    },
    [clearTablePeek]
  )

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) {
      setRowInsertZones((prev) => (prev.length ? [] : prev))
      setGutterPositions([])
      return
    }
    const gRect = grid.getBoundingClientRect()

    // Measure actual row positions from the first-column cells in the main grid
    const gp: { top: number; height: number }[] = []
    const hr = headerRowRef.current
    if (hr) {
      const b = hr.getBoundingClientRect()
      gp.push({ top: b.top - gRect.top, height: b.height })
    }
    for (let ri = 0; ri < previewBodyRows; ri++) {
      const br = bodyRowRefs.current[ri]
      if (br) {
        const b = br.getBoundingClientRect()
        gp.push({ top: b.top - gRect.top, height: b.height })
      }
    }
    setGutterPositions((prev) => {
      if (
        prev.length === gp.length &&
        prev.every((p, i) => Math.abs(p.top - gp[i].top) < 0.5 && Math.abs(p.height - gp[i].height) < 0.5)
      ) return prev
      return gp
    })

    const zones: { top: number; insertIndex: number }[] = []
    if (hr) {
      const b = hr.getBoundingClientRect()
      zones.push({ top: b.bottom - gRect.top - 3, insertIndex: 0 })
    }
    for (let ri = 0; ri < previewBodyRows; ri++) {
      const br = bodyRowRefs.current[ri]
      if (br) {
        const b = br.getBoundingClientRect()
        zones.push({ top: b.bottom - gRect.top - 3, insertIndex: ri + 1 })
      }
    }
    setRowInsertZones((prev) => {
      if (
        prev.length === zones.length &&
        prev.every(
          (p, i) =>
            zones[i] != null &&
            p.insertIndex === zones[i].insertIndex &&
            Math.abs(p.top - zones[i].top) < 0.5
        )
      ) {
        return prev
      }
      return zones
    })
  }, [
    cols.length,
    columnWidthsKey,
    rowWeightsKey,
    rawJson,
    el.id,
    selected,
    el.width,
    el.height,
    showColLetters,
    showRowNumbers,
    previewBodyRows,
  ])

  const onHeaderTipTapChange = useCallback(
    (serialized: string) => {
      if (!tableCellEdit || tableCellEdit.tableId !== el.id || tableCellEdit.row !== HEADER_ROW) return
      const c = cols[tableCellEdit.col]
      if (!c) return
      const nextCols = [...cols]
      nextCols[tableCellEdit.col] = { ...c, header: serialized }
      updateElement(el.id, { columns: nextCols })
    },
    [tableCellEdit, el.id, cols, updateElement]
  )

  const onBodyTipTapChange = useCallback(
    (serialized: string) => {
      if (!tableCellEdit || tableCellEdit.tableId !== el.id || tableCellEdit.row === HEADER_ROW) return
      const c = cols[tableCellEdit.col]
      if (!c) return
      const nextJson = setDataCellValue(rawJson, tableCellEdit.row, c.key, serialized)
      setVariableValue(dk, nextJson)
    },
    [tableCellEdit, el.id, cols, rawJson, dk, setVariableValue]
  )

  const tableCellEditorKey = tableCellEdit?.tableId === el.id ? `table-${el.id}-cell` : null

  const onTableCellTipTapReady = useCallback(
    (ed: import('@tiptap/core').Editor) => {
      if (!tableCellEditorKey) return
      registerActiveCanvasTipTapEditor(tableCellEditorKey, ed)
      setInlineTipTapEditor(ed)
    },
    [tableCellEditorKey, setInlineTipTapEditor]
  )

  const onTableCellTipTapUnmount = useCallback(
    (ed: import('@tiptap/core').Editor) => {
      if (!tableCellEditorKey) return
      unregisterActiveCanvasTipTapEditor(tableCellEditorKey, ed)
      const cur = useEditorStore.getState().inlineTipTapEditor
      if (cur === ed) setInlineTipTapEditor(null)
    },
    [tableCellEditorKey, setInlineTipTapEditor]
  )

  const commitCellEdit = useCallback(() => {
    setTableCellEdit(null)
  }, [setTableCellEdit])

  const cancelCellEdit = useCallback(() => {
    setTableCellEdit(null)
  }, [setTableCellEdit])


  const selectCell = useCallback(
    (row: number, col: number) => {
      select(el.id)
      setTableSelection({ tableId: el.id, mode: 'cell', row, col })
    },
    [el.id, select, setTableSelection]
  )

  const selectTableOnly = useCallback(() => {
    select(el.id)
    setTableSelection(null)
  }, [el.id, select, setTableSelection])

  /** 1× = select cell, 2× = edit (header + body cells with data). */
  const onGridCellClick = useCallback(
    (e: MouseEvent, row: number, col: number, allowCellSelect: boolean) => {
      if (locked) {
        select(el.id)
        return
      }
      e.stopPropagation()
      const d = e.detail
      if (d >= 2) {
        e.preventDefault()
        if (allowCellSelect) {
          select(el.id)
          openTableCellEdit({ tableId: el.id, row, col })
        } else {
          selectTableOnly()
        }
        return
      }
      if (d === 1) {
        if (allowCellSelect) {
          selectCell(row, col)
        } else {
          selectTableOnly()
        }
      }
    },
    [locked, el.id, select, selectCell, selectTableOnly, openTableCellEdit]
  )

  const onCornerChromeClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      if (locked) {
        select(el.id)
        return
      }
      selectTableOnly()
    },
    [locked, el.id, select, selectTableOnly]
  )

  const onColumnLetterClick = useCallback(
    (e: MouseEvent, ci: number) => {
      if (locked) {
        select(el.id)
        return
      }
      e.stopPropagation()
      select(el.id)
      const additive = e.metaKey || e.ctrlKey
      setTableSelection(toggleColumnSelection(tableSelection, el.id, ci, additive))
    },
    [el.id, locked, select, setTableSelection, tableSelection]
  )

  const onRowGutterClick = useCallback(
    (e: MouseEvent, rowIndex: number) => {
      if (locked) {
        select(el.id)
        return
      }
      e.stopPropagation()
      select(el.id)
      if (rowIndex === HEADER_ROW) {
        const additive = e.metaKey || e.ctrlKey
        setTableSelection(toggleRowSelection(tableSelection, el.id, HEADER_ROW, additive))
        return
      }
      if (rowIndex >= 0) {
        const additive = e.metaKey || e.ctrlKey
        setTableSelection(toggleRowSelection(tableSelection, el.id, rowIndex, additive))
      } else {
        selectTableOnly()
      }
    },
    [el.id, locked, select, setTableSelection, tableSelection, selectTableOnly]
  )

  useEffect(() => {
    if (locked) return
    if (!selected || tableSelection?.tableId !== el.id || tableSelection.mode !== 'cell') return

    const onKeyDown = (e: KeyboardEvent) => {
      if (!tableKeyboardFocus || !tableSelection || tableSelection.tableId !== el.id) return
      if (tableSelection.mode !== 'cell') return
      if (tableCellEdit?.tableId === el.id) return
      const { row, col } = tableSelection
      const nCol = cols.length
      const nRowBody = previewBodyRows
      const maxRow = nRowBody - 1

      const move = (nr: number, nc: number) => {
        const r = Math.max(HEADER_ROW, Math.min(maxRow, nr))
        const c = Math.max(0, Math.min(nCol - 1, nc))
        setTableSelection({ tableId: el.id, mode: 'cell', row: r, col: c })
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          if (col > 0) move(row, col - 1)
          else if (row > HEADER_ROW) move(row - 1, nCol - 1)
        } else {
          if (col < nCol - 1) move(row, col + 1)
          else if (row < maxRow) move(row + 1, 0)
        }
        return
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        move(row, col - 1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        move(row, col + 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        move(row - 1, col)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        move(row + 1, col)
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    selected,
    tableKeyboardFocus,
    el.id,
    tableSelection,
    cols.length,
    setTableSelection,
    tableCellEdit?.tableId,
    locked,
    previewBodyRows,
  ])

  const beginResize = (boundaryIndex: number, e: React.PointerEvent) => {
    if (locked) return
    e.stopPropagation()
    e.preventDefault()
    const root = gridRef.current
    if (!root) return
    if (rowResizeRef.current) {
      endHistoryBatch()
      rowResizeRef.current = null
    }
    beginHistoryBatch()
    const rect = root.getBoundingClientRect()
    resizeRef.current = {
      index: boundaryIndex,
      startX: e.clientX,
      startWeights: [...weights],
      widthPx: Math.max(1, rect.width),
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onResizePointerMove = (e: React.PointerEvent) => {
    const r = resizeRef.current
    if (!r) return
    const dx = e.clientX - r.startX
    const sum = r.startWeights.reduce((a, b) => a + b, 0)
    const deltaFr = (dx / r.widthPx) * sum
    const i = r.index
    const a = Math.max(0.12, r.startWeights[i] + deltaFr)
    const b = Math.max(0.12, r.startWeights[i + 1] - deltaFr)
    const next = [...r.startWeights]
    next[i] = a
    next[i + 1] = b
    updateElement(el.id, { columnWidths: next })
  }

  const endResize = (e: React.PointerEvent) => {
    if (resizeRef.current) {
      endHistoryBatch()
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      resizeRef.current = null
    }
  }

  const beginRowResize = (boundaryIndex: number, e: React.PointerEvent) => {
    if (locked) return
    e.stopPropagation()
    e.preventDefault()
    const root = gridRef.current
    if (!root) return
    if (resizeRef.current) {
      endHistoryBatch()
      resizeRef.current = null
    }
    beginHistoryBatch()
    const rect = root.getBoundingClientRect()
    rowResizeRef.current = {
      index: boundaryIndex,
      startY: e.clientY,
      startWeights: [...rowWeights],
      heightPx: Math.max(1, rect.height),
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onRowResizePointerMove = (e: React.PointerEvent) => {
    const r = rowResizeRef.current
    if (!r) return
    const dy = e.clientY - r.startY
    const sum = r.startWeights.reduce((a, b) => a + b, 0)
    const deltaFr = (dy / r.heightPx) * sum
    const i = r.index
    const lo = 0.12
    const a = Math.max(lo, r.startWeights[i] + deltaFr)
    const b = Math.max(lo, r.startWeights[i + 1] - deltaFr)
    const next = [...r.startWeights]
    next[i] = a
    next[i + 1] = b
    updateElement(el.id, { tableRowWeights: next })
  }

  const endRowResize = (e: React.PointerEvent) => {
    if (rowResizeRef.current) {
      endHistoryBatch()
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      rowResizeRef.current = null
    }
  }

  const insertColumnAt = (index: number) => {
    const next = [...cols]
    const n = next.length + 1
    const insertAt = Math.max(0, Math.min(index, next.length))
    next.splice(insertAt, 0, { header: `Column ${n}`, key: `col_${n}` })
    const w = [...weights]
    w.splice(insertAt, 0, 1)
    updateElement(el.id, {
      columns: next,
      columnWidths: w,
      tableColumnBackgrounds: shiftColumnBackgroundsAfterInsert(el.tableColumnBackgrounds, insertAt),
      tableCellBackgrounds: shiftCellBackgroundsAfterColumnInsert(el.tableCellBackgrounds, insertAt),
    })
  }

  const insertRowFromCanvas = (insertIndex: number) => {
    const next = insertRowAt(rawJson, insertIndex)
    setVariableValue(dk, next)
    updateElement(el.id, {
      tableRowBackgrounds: shiftRowBackgroundsAfterInsert(el.tableRowBackgrounds, insertIndex),
      tableCellBackgrounds: shiftCellBackgroundsAfterRowInsert(el.tableCellBackgrounds, insertIndex),
    })
  }

  const cellBorder = 'border-r border-b border-zinc-400 dark:border-zinc-500'
  const sumW = weights.reduce((a, b) => a + b, 0) || 1

  const colBoundaryLeftPct = (insertIndex: number) => {
    if (insertIndex <= 0) return 0
    if (insertIndex >= cols.length) return 100
    const cum = weights.slice(0, insertIndex).reduce((a, b) => a + b, 0)
    return (cum / sumW) * 100
  }

  const insertColBtnLeft = (ins: number) => {
    const pct = colBoundaryLeftPct(ins)
    if (ins === 0) return '0'
    if (ins >= cols.length) return '100%'
    return `${pct}%`
  }

  const highlight = (sel: TableSelection, row: number, col: number) =>
    selected && isCellHighlighted(sel, el.id, row, col)

  const lastPreviewBodyRi = previewBodyRows - 1
  const logicalColForRowBlocks = (ci: number) => (showRowNumbers ? ci + 1 : ci)
  const logicalColCountForRowBlocks = cols.length + (showRowNumbers ? 1 : 0)

  return (
    <div
      data-table-interactive
      className="flex h-full w-full min-h-0 flex-col border border-zinc-600 bg-white text-zinc-900 dark:border-zinc-500 dark:bg-zinc-100 dark:text-zinc-900"
      onPointerMove={handleTablePointerMove}
      onPointerOut={handleTablePointerOut}
    >
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-visible">
        {showRowNumbers && gutterPositions.length > 0 ? (
          <div className="pointer-events-auto absolute right-full top-0 z-[1] w-5" style={{ height: '100%' }}>
            {gutterPositions.map((gp, gi) => {
              const isHeader = gi === 0
              const ri = gi - 1
              const slot = !isHeader ? visibleBodyRows[ri] : undefined
              const dataRowIndex = isHeader ? HEADER_ROW : (slot?.rowIndex ?? -1)
              const rowLabel = isHeader ? 1 : dataRowIndex >= 0 ? dataRowIndex + 2 : '—'
              const isRowSel =
                selected &&
                tableSelection?.tableId === el.id &&
                tableSelection.mode === 'rows' &&
                (isHeader
                  ? tableSelection.rows.includes(HEADER_ROW)
                  : dataRowIndex >= 0 && tableSelection.rows.includes(dataRowIndex))
              return (
                <div
                  key={`rg-${gi}`}
                  ref={(node) => {
                    if (isHeader) headerGutterRef.current = node
                    else dataGutterRefs.current[ri] = node
                  }}
                  className={`absolute left-0 right-0 flex items-center justify-center ${cellBorder} bg-zinc-200 text-[9px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-300 dark:text-zinc-800 ${
                    isRowSel
                      ? `${TABLE_BLOCK_SELECTION_FILL} ${rowBlockSelectionClasses(
                          tableSelection!,
                          el.id,
                          0,
                          1,
                          dataRowIndex
                        )}`
                      : ''
                  }`}
                  style={{ top: gp.top, height: gp.height }}
                  onClick={(e) => onRowGutterClick(e, dataRowIndex)}
                  title={
                    isHeader
                      ? 'Row 1 (header) — click selects row · ⌘/Ctrl+click adds'
                      : dataRowIndex >= 0
                        ? `Row ${rowLabel} — click selects row · ⌘/Ctrl+click adds`
                        : 'Empty preview slot'
                  }
                >
                  {rowLabel}
                </div>
              )
            })}
          </div>
        ) : null}

        {showColLetters ? (
          <>
            {showRowNumbers ? (
              <div
                className={`pointer-events-auto absolute bottom-full right-full z-[1] flex h-[14px] w-5 items-center justify-center ${cellBorder} bg-zinc-300 dark:bg-zinc-400 ${
                  selected &&
                  tableSelection?.tableId === el.id &&
                  tableSelection.mode === 'columns' &&
                  tableSelection.cols.includes(0)
                    ? `${TABLE_BLOCK_SELECTION_FILL} border-2 border-violet-600 dark:border-violet-400`
                    : ''
                }`}
                onClick={onCornerChromeClick}
                title="Table"
              />
            ) : null}
            <div
              className="pointer-events-auto absolute bottom-full left-0 right-0 z-[1] grid h-[14px] overflow-hidden border-b border-zinc-400 dark:border-zinc-500"
              style={{ gridTemplateColumns }}
            >
              {cols.map((_, ci) => (
                <div
                  key={`L-${ci}`}
                  className={`relative flex items-center justify-center ${cellBorder} bg-zinc-400 text-[9px] font-semibold tabular-nums text-white dark:bg-zinc-500 ${
                    selected &&
                    tableSelection?.tableId === el.id &&
                    tableSelection.mode === 'columns' &&
                    tableSelection.cols.includes(ci)
                      ? `${TABLE_BLOCK_SELECTION_FILL} ${columnLetterSelectionClasses(
                          tableSelection,
                          el.id,
                          ci
                        )}`
                      : ''
                  }`}
                  onClick={(e) => onColumnLetterClick(e, ci)}
                  title={`Column ${excelColumnLabel(ci)} — click selects column · ⌘/Ctrl+click adds`}
                >
                  {excelColumnLabel(ci)}
                </div>
              ))}
            </div>
          </>
        ) : null}

        <div
          ref={gridRef}
          className="relative z-0 min-h-0 h-full w-full overflow-hidden"
          style={{
            display: 'grid',
            gridTemplateColumns,
            gridTemplateRows,
          }}
        >
          {cols.map((c, ci) => {
            const sel = tableSelection
            const isSel = highlight(sel, HEADER_ROW, ci)
            const fillBg = tableCellEffectiveBackground(el, HEADER_ROW, ci)
            const colBlockBorder =
              selected &&
              sel?.tableId === el.id &&
              sel.mode === 'columns' &&
              sel.cols.includes(ci)
                ? columnBlockSelectionClasses(sel, el.id, ci, true, 0, lastPreviewBodyRi, showColLetters)
                : ''
            const rowBlockBorder =
              selected &&
              sel?.tableId === el.id &&
              sel.mode === 'rows' &&
              sel.rows.includes(HEADER_ROW)
                ? rowBlockSelectionClasses(
                    sel,
                    el.id,
                    logicalColForRowBlocks(ci),
                    logicalColCountForRowBlocks,
                    HEADER_ROW
                  )
                : ''
            const ringCell =
              selected &&
              sel?.tableId === el.id &&
              sel.mode === 'cell' &&
              isSel
                ? 'z-[1] ring-2 ring-violet-600 ring-inset dark:ring-violet-500'
                : ''
            const blockOutline = !!(colBlockBorder || rowBlockBorder)
            const blockFillClass = blockOutline && !fillBg ? TABLE_BLOCK_SELECTION_FILL : ''
            const editingHere =
              isEditing &&
              tableCellEdit != null &&
              tableCellEdit.row === HEADER_ROW &&
              tableCellEdit.col === ci
            return (
              <div
                key={`h-${c.key}-${ci}`}
                role="columnheader"
                ref={(node) => {
                  if (ci === 0) headerRowRef.current = node
                  if (!showRowNumbers && ci === 0) headerGutterRef.current = node
                }}
                className={`relative flex min-w-0 items-center self-stretch ${cellBorder} px-1 py-0.5 text-left text-[9px] font-semibold leading-tight ${
                  fillBg ? '' : 'bg-zinc-200 dark:bg-zinc-300'
                } ${colBlockBorder} ${rowBlockBorder} ${blockFillClass} ${ringCell}`}
                style={{ gridRow: 1, gridColumn: ci + 1, ...mergeBlockSelectionStyle(fillBg, blockOutline) }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => onGridCellClick(e, HEADER_ROW, ci, true)}
              >
                {editingHere ? (
                  <div
                    className="absolute inset-0 z-[5] box-border min-w-0 overflow-hidden ring-2 ring-violet-500"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <TipTapRichEditor
                      content={c.header}
                      emitOnChange
                      onChange={onHeaderTipTapChange}
                      variableMentions={variableMentions}
                      variableValues={variableValues}
                      variableChipDetailResolver={resolveVariableChipDetail}
                      variableSurfaceLabelResolver={variableSurfaceLabelResolver}
                      mode="canvas"
                      sessionKey={`${el.id}-h-${ci}`}
                      autoFocus
                      editorClassName="bg-transparent font-semibold"
                      editorStyle={{
                        fontSize: 9,
                        fontWeight: 600,
                        textAlign: 'left',
                        color: el.style?.color?.trim() || undefined,
                        backgroundColor: 'transparent',
                      }}
                      onReady={onTableCellTipTapReady}
                      onUnmount={onTableCellTipTapUnmount}
                      canvasKeyboard={{
                        onEscape: cancelCellEdit,
                        onCommitShortcut: () => setTableCellEdit(null),
                      }}
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1 pr-1">
                    <RichTextBlockPreview
                      content={c.header}
                      variableValues={variableValues}
                      variableSurfaceLabelResolver={variableSurfaceLabelResolver}
                      fontSize={9}
                      textAlign="left"
                      elementBold
                      color={el.style?.color}
                    />
                  </div>
                )}
              
              </div>
            )
          })}

          {Array.from({ length: previewBodyRows }, (_, ri) => {
            const zebra = ri % 2 === 1 ? 'bg-zinc-100/90 dark:bg-zinc-200/80' : 'bg-white dark:bg-zinc-50'
            const slot = visibleBodyRows[ri]
            const dataRowIndex = slot?.rowIndex ?? -1
            const rowObj = slot?.row ?? {}
            return (
              <div key={`g-${ri}`} className="contents">
                {cols.map((c, ci) => {
                  const text = formatPreviewCellValue(rowObj, c.key)
                  const fillBgRaw = tableCellEffectiveBackground(
                    el,
                    dataRowIndex >= 0 ? dataRowIndex : ri,
                    ci
                  )
                  const cellBeh = tableCellBehaviourStyle(
                    el.behaviour,
                    rowObj,
                    previewDataTree,
                    ci,
                    el.style?.color,
                    fillBgRaw
                  )
                  const tc = (cellBeh.textColor ?? el.style?.color)?.trim()
                  const display =
                    text || (
                      <span
                        className={`font-mono ${tc ? 'opacity-50' : 'text-zinc-400'}`}
                        style={tc ? { color: tc } : undefined}
                      >{`{${c.key}}`}</span>
                    )
                  const sel = tableSelection
                  const isSel =
                    dataRowIndex >= 0 && highlight(sel, dataRowIndex, ci)
                  const fillBg = cellBeh.backgroundColor?.trim() || fillBgRaw
                  const colBlockBorder =
                    selected &&
                    sel?.tableId === el.id &&
                    sel.mode === 'columns' &&
                    sel.cols.includes(ci)
                      ? columnBlockSelectionClasses(sel, el.id, ci, false, ri, lastPreviewBodyRi, false)
                      : ''
                  const rowBlockBorder =
                    selected &&
                    sel?.tableId === el.id &&
                    sel.mode === 'rows' &&
                    dataRowIndex >= 0 &&
                    sel.rows.includes(dataRowIndex)
                      ? rowBlockSelectionClasses(
                          sel,
                          el.id,
                          logicalColForRowBlocks(ci),
                          logicalColCountForRowBlocks,
                          dataRowIndex
                        )
                      : ''
                  const ringCell =
                    selected &&
                    sel?.tableId === el.id &&
                    sel.mode === 'cell' &&
                    isSel
                      ? 'z-[1] ring-2 ring-violet-600 ring-inset dark:ring-violet-500'
                      : ''
                  const blockOutline = !!(colBlockBorder || rowBlockBorder)
                  const blockFillClass = blockOutline && !fillBg ? TABLE_BLOCK_SELECTION_FILL : ''
                  const editingHere =
                    isEditing &&
                    tableCellEdit != null &&
                    dataRowIndex >= 0 &&
                    tableCellEdit.row === dataRowIndex &&
                    tableCellEdit.col === ci
                  return (
                    <div
                      key={`d-${ri}-${ci}`}
                      role="gridcell"
                      ref={(node) => {
                        if (ci === 0) bodyRowRefs.current[ri] = node
                        if (!showRowNumbers && ci === 0) dataGutterRefs.current[ri] = node
                      }}
                      className={`relative flex min-w-0 items-center self-stretch ${cellBorder} px-1 py-0.5 text-left text-[9px] leading-tight ${
                        fillBg ? '' : zebra
                      } ${colBlockBorder} ${rowBlockBorder} ${blockFillClass} ${ringCell}`}
                      style={{ gridRow: ri + 2, gridColumn: ci + 1, ...mergeBlockSelectionStyle(fillBg, blockOutline) }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => onGridCellClick(e, dataRowIndex, ci, dataRowIndex >= 0)}
                    >
                      {editingHere ? (
                        <div
                          className="absolute inset-0 z-[5] box-border min-w-0 overflow-hidden ring-2 ring-violet-500"
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <TipTapRichEditor
                            content={getDataCellStringValue(rawJson, dataRowIndex, c.key)}
                            emitOnChange
                            onChange={onBodyTipTapChange}
                            variableMentions={variableMentions}
                            variableValues={variableValues}
                            variableChipDetailResolver={resolveVariableChipDetail}
                            variableSurfaceLabelResolver={variableSurfaceLabelResolver}
                            mode="canvas"
                            sessionKey={`${el.id}-d-r${dataRowIndex}-c${ci}`}
                            autoFocus
                            editorClassName="bg-transparent"
                            editorStyle={{
                              fontSize: 9,
                              textAlign: 'left',
                              color: tc || undefined,
                              backgroundColor: 'transparent',
                            }}
                            onReady={onTableCellTipTapReady}
                            onUnmount={onTableCellTipTapUnmount}
                            canvasKeyboard={{
                              onEscape: cancelCellEdit,
                              onCommitShortcut: () => setTableCellEdit(null),
                            }}
                          />
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <RichTextBlockPreview
                            content={getDataCellStringValue(rawJson, dataRowIndex, c.key) || (text as string) || ''}
                            variableValues={variableValues}
                            variableSurfaceLabelResolver={variableSurfaceLabelResolver}
                            fontSize={9}
                            textAlign="left"
                            color={tc}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* Column resize: full-height strips on each column boundary */}
          {!locked &&
            cols.length > 1 &&
            Array.from({ length: cols.length - 1 }, (_, b) => (
              <div
                key={`col-res-${b}`}
                role="separator"
                aria-orientation="vertical"
                data-table-column-resize
                title="Drag to resize column width"
                className="pointer-events-auto z-[4] cursor-col-resize touch-none hover:bg-violet-500/25"
                style={{
                  gridRow: '1 / -1',
                  gridColumnStart: b + 1,
                  gridColumnEnd: b + 2,
                  justifySelf: 'end',
                  width: 8,
                  marginRight: -4,
                }}
                onPointerDown={(e) => beginResize(b, e)}
                onPointerMove={onResizePointerMove}
                onPointerUp={endResize}
                onPointerCancel={endResize}
              />
            ))}

          {/* Row resize: full-width strips between body rows */}
          {!locked &&
            previewBodyRows > 1 &&
            Array.from({ length: previewBodyRows - 1 }, (_, b) => (
              <div
                key={`row-res-${b}`}
                role="separator"
                aria-orientation="horizontal"
                data-table-row-resize
                title="Drag to resize row height"
                className="pointer-events-auto z-[4] cursor-ns-resize touch-none hover:bg-violet-500/25"
                style={{
                  gridColumn: '1 / -1',
                  gridRowStart: b + 2,
                  gridRowEnd: b + 3,
                  alignSelf: 'end',
                  height: 8,
                  marginBottom: -4,
                }}
                onPointerDown={(e) => beginRowResize(b, e)}
                onPointerMove={onRowResizePointerMove}
                onPointerUp={endRowResize}
                onPointerCancel={endRowResize}
              />
            ))}
        </div>

        {/* Column insert (+) above the grid, at column boundaries */}
        {selected &&
          !locked &&
          Array.from({ length: cols.length + 1 }, (_, ins) => {
            const left = insertColBtnLeft(ins)
            return (
              <button
                key={`col-ins-${ins}`}
                type="button"
                title="Insert column"
                className="pointer-events-auto absolute z-20 flex h-4 w-5 -translate-x-1/2 items-center justify-center bg-transparent opacity-0 hover:opacity-100 focus:opacity-100"
                style={{ left, top: -16 }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  insertColumnAt(ins)
                }}
              >
                <span className="rounded-full bg-emerald-600 px-0.5 text-[10px] font-bold leading-none text-white shadow dark:bg-emerald-500">
                  +
                </span>
              </button>
            )
          })}

        {/* Row insert (+) to the left of the grid, at row boundaries */}
        {selected &&
          !locked &&
          rowInsertZones.map((z) => (
            <button
              key={`row-ins-${z.insertIndex}`}
              type="button"
              title="Insert row"
              className="pointer-events-auto absolute z-20 flex h-5 w-5 -translate-y-1/2 items-center justify-center bg-transparent opacity-0 hover:opacity-100 focus:opacity-100 focus-visible:opacity-100"
              style={{ top: z.top, left: -22 }}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                insertRowFromCanvas(z.insertIndex)
              }}
            >
              <span className="rounded-full bg-emerald-600 px-0.5 text-[10px] font-bold leading-none text-white shadow dark:bg-emerald-500">
                +
              </span>
            </button>
          ))}
      </div>

      {dataState.kind !== 'ok' ? (
        <div
          className={`shrink-0 border-t border-zinc-400 px-1.5 py-1 text-[9px] leading-snug dark:border-zinc-500 ${
            dataState.kind === 'invalid'
              ? 'bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100'
              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
          }`}
          onClick={(e) => {
            e.stopPropagation()
            if (locked) select(el.id)
            else selectTableOnly()
          }}
        >
          {dataState.message}
        </div>
      ) : null}
    </div>
  )
}
