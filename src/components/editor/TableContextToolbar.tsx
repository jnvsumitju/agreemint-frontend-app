import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconPlus, IconChevronDown, IconTrash, IconColumns, IconRows,
  IconArrowLeft, IconArrowRight, IconArrowUp, IconArrowDown, IconCopy,
} from './ToolbarIcons'
import { useEditorStore } from '../../stores/editorStore'
import type { LayoutElement } from '../../types/layout'
import { normalizeColumnWidths, normalizeRowWeights } from '../../types/layout'
import { normalizeVariableIdentifier } from '../../lib/variables'
import { mergeElementStyle, omitStyleKey } from '../../lib/elementStyleHelpers'
import { TOOLBAR_CHIP_CLASS } from './uiClasses'
import {
  duplicateColumnBackgroundMap,
  duplicateCellBackgroundColumn,
  duplicateRowBackgroundMap,
  duplicateCellBackgroundRow,
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
  swapRowBackgroundKeys,
  swapCellBackgroundRows,
} from '../../lib/tableBackgroundMaps'
import { deleteRowsAt, insertRowAt, swapRowsAt, duplicateRowAt } from '../../lib/tableDataEdit'
import {
  parseTableVariableData,
  serializeTableVariableData,
  insertStructuredRowAt,
  deleteStructuredRowsAt,
  swapStructuredRows,
  duplicateStructuredRowAt,
  insertStructuredColumnAt,
  deleteStructuredColumnsAt,
  structuredBodyRowCount,
} from '../../lib/tableDataFormat'
import { tablePreviewBodyRowCount } from '../../lib/tablePreview'
import { TABLE_HEADER_ROW, tableSelectionSummary } from '../../types/tableSelection'
import { RichTextTipTapToolbar } from './RichTextTipTapToolbar'
import { ColorToolbarSwatch } from './ColorPalettePopover'

/* ------------------------------------------------------------------ */
/*  Portal-positioned dropdown menu                                    */
/* ------------------------------------------------------------------ */

function DropdownMenu({
  icon,
  label,
  isOpen,
  onToggle,
  children,
}: {
  icon: React.ReactNode
  label: string
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  // Position the panel below the trigger
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left })
  }, [isOpen])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return
      onToggle()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [isOpen, onToggle])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onToggle() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isOpen, onToggle])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${TOOLBAR_CHIP_CLASS} flex items-center gap-0.5`}
        title={label}
        aria-expanded={isOpen}
        aria-haspopup="true"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onToggle() }}
      >
        {icon}
        <IconChevronDown size={10} className="text-zinc-400" />
      </button>
      {isOpen && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[200] flex w-max min-w-[14rem] flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-600 dark:bg-zinc-800"
          style={{ top: pos.top, left: pos.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Dropdown action button                                             */
/* ------------------------------------------------------------------ */

function DdBtn({
  disabled,
  title,
  children,
  onClick,
}: {
  disabled?: boolean
  title: string
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`${TOOLBAR_CHIP_CLASS} flex items-center gap-1`}
      disabled={disabled}
      title={title}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!disabled) onClick()
      }}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  TableContextToolbar                                                */
/* ------------------------------------------------------------------ */

export function TableContextToolbar({ el }: { el: LayoutElement }) {
  const tableSelection = useEditorStore((s) => s.tableSelection)
  const setTableSelection = useEditorStore((s) => s.setTableSelection)
  const tableCellEdit = useEditorStore((s) => s.tableCellEdit)
  const updateElement = useEditorStore((s) => s.updateElement)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)
  const variableValues = useEditorStore((s) => s.variableValues)

  const cols = el.columns ?? []
  const HEADER_ROW = TABLE_HEADER_ROW
  const dk = el.dataKey ?? 'items'
  const rawJson = variableValues[dk] ?? ''
  const previewBodyRows = tablePreviewBodyRowCount(el)

  const parsedStructured = useMemo(() => parseTableVariableData(rawJson), [rawJson])
  const isStructured = parsedStructured != null

  const totalDataRows = useMemo(() => {
    if (isStructured && parsedStructured) return structuredBodyRowCount(parsedStructured)
    try { return (JSON.parse(rawJson || '[]') as unknown[]).length }
    catch { return 0 }
  }, [rawJson, isStructured, parsedStructured])

  const ts = tableSelection?.tableId === el.id ? tableSelection : null

  // -- Column indices --
  const activeColIndices =
    ts?.mode === 'columns'
      ? [...new Set(ts.cols)].sort((a, b) => a - b)
      : ts?.mode === 'cell' && ts.col >= 0
        ? [ts.col]
        : []
  const minCol = activeColIndices.length ? activeColIndices[0] : null
  const maxCol = activeColIndices.length ? activeColIndices[activeColIndices.length - 1] : null
  const singleCol = activeColIndices.length === 1 ? activeColIndices[0] : null

  // -- Row indices --
  const dataRowIndices =
    ts?.mode === 'rows'
      ? [...new Set(ts.rows)].filter((r) => r >= 0).sort((a, b) => a - b)
      : ts?.mode === 'cell' && ts.row >= 0
        ? [ts.row]
        : []
  const minDataRow = dataRowIndices.length ? dataRowIndices[0] : null
  const maxDataRow = dataRowIndices.length ? dataRowIndices[dataRowIndices.length - 1] : null
  const singleDataRow = dataRowIndices.length === 1 ? dataRowIndices[0] : null

  // -- Dropdown state --
  const [openMenu, setOpenMenu] = useState<'columns' | 'rows' | null>(null)
  const toggleMenu = useCallback(
    (menu: 'columns' | 'rows') => setOpenMenu((prev) => (prev === menu ? null : menu)),
    [],
  )

  /* ---- Column operations ---- */

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
    if (parsedStructured) {
      const updated = insertStructuredColumnAt(parsedStructured, insertAt, `Column ${n}`)
      setVariableValue(dk, serializeTableVariableData(updated))
    }
  }

  const insertOneColumnAfterSelection = () => {
    insertColumnAt(maxCol != null ? maxCol + 1 : cols.length)
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
    if (parsedStructured) {
      const updated = deleteStructuredColumnsAt(parsedStructured, activeColIndices)
      setVariableValue(dk, serializeTableVariableData(updated))
    }
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
    const row = ts?.mode === 'cell' ? ts.row : HEADER_ROW
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

  /* ---- Row operations ---- */

  const deleteDataRows = () => {
    if (!dataRowIndices.length) return
    const removedAsc = [...new Set(dataRowIndices)].sort((a, b) => a - b)
    if (isStructured && parsedStructured) {
      const updated = deleteStructuredRowsAt(parsedStructured, dataRowIndices)
      setVariableValue(dk, serializeTableVariableData(updated))
    } else {
      const next = deleteRowsAt(rawJson, dataRowIndices)
      setVariableValue(dk, next)
    }
    const newPreview = Math.max(1, previewBodyRows - removedAsc.length)
    const rw = normalizeRowWeights(previewBodyRows + 1, el.tableRowWeights)
    for (const idx of [...removedAsc].sort((a, b) => b - a)) rw.splice(idx + 1, 1)
    updateElement(el.id, {
      tablePreviewBodyRows: newPreview,
      tableRowWeights: rw.length === newPreview + 1 ? rw : undefined,
      tableRowBackgrounds: reindexRowBackgroundsAfterDelete(el.tableRowBackgrounds, removedAsc),
      tableCellBackgrounds: reindexCellBackgroundsAfterRowDelete(el.tableCellBackgrounds, removedAsc),
    })
    setTableSelection(null)
  }

  const growPreviewForInsert = (at: number) => {
    const rw = normalizeRowWeights(previewBodyRows + 1, el.tableRowWeights)
    rw.splice(at + 1, 0, 1)
    return { tablePreviewBodyRows: previewBodyRows + 1, tableRowWeights: rw }
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
    if (isStructured && parsedStructured) {
      const updated = insertStructuredRowAt(parsedStructured, at)
      setVariableValue(dk, serializeTableVariableData(updated))
    } else {
      const next = insertRowAt(rawJson, at)
      setVariableValue(dk, next)
    }
    updateElement(el.id, {
      ...growPreviewForInsert(at),
      tableRowBackgrounds: shiftRowBackgroundsAfterInsert(el.tableRowBackgrounds, at),
      tableCellBackgrounds: shiftCellBackgroundsAfterRowInsert(el.tableCellBackgrounds, at),
    })
  }

  const insertRowBefore = () => {
    const at = minDataRow ?? 0
    if (isStructured && parsedStructured) {
      const updated = insertStructuredRowAt(parsedStructured, at)
      setVariableValue(dk, serializeTableVariableData(updated))
    } else {
      const next = insertRowAt(rawJson, at)
      setVariableValue(dk, next)
    }
    updateElement(el.id, {
      ...growPreviewForInsert(at),
      tableRowBackgrounds: shiftRowBackgroundsAfterInsert(el.tableRowBackgrounds, at),
      tableCellBackgrounds: shiftCellBackgroundsAfterRowInsert(el.tableCellBackgrounds, at),
    })
  }

  const moveRow = (dir: -1 | 1) => {
    if (singleDataRow == null) return
    const j = singleDataRow + dir
    if (j < 0 || j >= totalDataRows) return
    if (isStructured && parsedStructured) {
      const updated = swapStructuredRows(parsedStructured, singleDataRow, j)
      setVariableValue(dk, serializeTableVariableData(updated))
    } else {
      const nextJson = swapRowsAt(rawJson, singleDataRow, j)
      setVariableValue(dk, nextJson)
    }
    updateElement(el.id, {
      tableRowBackgrounds: swapRowBackgroundKeys(el.tableRowBackgrounds, singleDataRow, j),
      tableCellBackgrounds: swapCellBackgroundRows(el.tableCellBackgrounds, singleDataRow, j),
    })
    setTableSelection({ tableId: el.id, mode: 'rows', rows: [j] })
  }

  const duplicateRow = () => {
    const src = maxDataRow ?? singleDataRow
    if (src == null) return
    if (isStructured && parsedStructured) {
      const updated = duplicateStructuredRowAt(parsedStructured, src)
      setVariableValue(dk, serializeTableVariableData(updated))
    } else {
      const nextJson = duplicateRowAt(rawJson, src)
      setVariableValue(dk, nextJson)
    }
    updateElement(el.id, {
      ...growPreviewForInsert(src + 1),
      tableRowBackgrounds: duplicateRowBackgroundMap(el.tableRowBackgrounds, src),
      tableCellBackgrounds: duplicateCellBackgroundRow(el.tableCellBackgrounds, src),
    })
    setTableSelection({ tableId: el.id, mode: 'rows', rows: [src + 1] })
  }

  /* ---- UI state ---- */

  const selectionHint = ts ? tableSelectionSummary(ts) : 'Nothing selected on table'
  const kindLine =
    ts == null
      ? 'Click a column letter, row number, or a cell. \u2318/Ctrl+click extends column or row selection.'
      : ts.mode === 'cell'
        ? ts.row === HEADER_ROW
          ? 'Header cell \u2014 double-click the cell on the canvas to edit plain text (variables preserved in Properties).'
          : 'Data cell \u2014 double-click to edit the preview value (updates Variables JSON).'
        : ts.mode === 'columns'
          ? activeColIndices.length > 1
            ? `${activeColIndices.length} columns \u2014 insert wraps selection; remove deletes all selected.`
            : 'One column \u2014 move/duplicate apply to that column.'
          : ts.mode === 'rows'
            ? dataRowIndices.length > 0
              ? `${dataRowIndices.length} data row(s) in selection \u2014 remove deletes those rows from JSON.`
              : 'Header row only \u2014 use column tools or cells to edit headers.'
            : ''

  const isCellEditing = tableCellEdit != null && tableCellEdit.tableId === el.id

  return (
    <div className="flex min-w-0 items-center gap-1 px-1 lg:gap-1.5">
      {isCellEditing ? (
        <RichTextTipTapToolbar canvasEditing />
      ) : null}
      {isCellEditing ? <span className="mx-0.5 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden /> : null}
        {/* ---- Label + Text color ---- */}
        <span className="shrink-0 text-[10px] font-semibold text-zinc-600 lg:text-xs dark:text-zinc-300">Table</span>
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

        {/* ---- Table fill (always visible) ---- */}
        <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Fill</span>
        <ColorToolbarSwatch
          title="Background for entire table"
          value={el.style?.backgroundColor?.trim()}
          onChange={(hex) =>
            updateElement(el.id, {
              style: mergeElementStyle(el.style, { backgroundColor: hex }),
            })
          }
          onClear={
            el.style?.backgroundColor?.trim()
              ? () => updateElement(el.id, { style: omitStyleKey(el.style, 'backgroundColor') })
              : undefined
          }
        />

        {/* ---- Contextual cell/row/col fill swatches ---- */}
        {ts && ts.mode === 'cell' ? (
          <>
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Cell</span>
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
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Row</span>
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
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Col</span>
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

        {/* ---- Selection hint ---- */}
        <span
          className="max-w-[8rem] truncate text-[9px] font-medium text-violet-700 lg:max-w-[14rem] lg:text-[10px] dark:text-violet-300"
          title={selectionHint}
        >
          {selectionHint}
        </span>

        {/* ---- Delete selected rows ---- */}
        <button
          type="button"
          className={TOOLBAR_CHIP_CLASS}
          disabled={!dataRowIndices.length}
          title="Remove selected data rows"
          aria-label="Remove rows"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            deleteDataRows()
          }}
        >
          <IconTrash size={14} />
        </button>

        {/* ---- + Row ---- */}
        <button
          type="button"
          className={`${TOOLBAR_CHIP_CLASS} flex items-center gap-0.5`}
          title="Insert a row after selection"
          aria-label="Insert row"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            insertOneRowAfterSelection()
          }}
        >
          <IconPlus size={12} />
          <span className="text-[10px]">Row</span>
        </button>

        {/* ---- + Col ---- */}
        <button
          type="button"
          className={`${TOOLBAR_CHIP_CLASS} flex items-center gap-0.5`}
          title="Insert a column after selection"
          aria-label="Insert column"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            insertOneColumnAfterSelection()
          }}
        >
          <IconPlus size={12} />
          <span className="text-[10px]">Col</span>
        </button>

        {/* ---- Columns dropdown ---- */}
        <DropdownMenu
          icon={<IconColumns size={14} />}
          label="Column operations"
          isOpen={openMenu === 'columns'}
          onToggle={() => toggleMenu('columns')}
        >
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
            {activeColIndices.length
              ? `${activeColIndices.length} column(s) targeted.`
              : 'Select a column (letter or header) or a cell.'}
          </p>
          <div className="flex flex-wrap gap-1">
            <DdBtn title="Insert column before leftmost selected" onClick={() => insertColumnAt(minCol ?? 0)}>
              <IconPlus size={12} /> Before
            </DdBtn>
            <DdBtn title="Insert column after rightmost selected" onClick={() => insertColumnAt(maxCol != null ? maxCol + 1 : cols.length)}>
              <IconPlus size={12} /> After
            </DdBtn>
            <DdBtn
              disabled={!activeColIndices.length || cols.length <= activeColIndices.length}
              title="Delete selected column(s)"
              onClick={deleteActiveColumns}
            >
              <IconTrash size={12} /> Remove
            </DdBtn>
          </div>
          <div className="flex flex-wrap gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-700">
            <DdBtn disabled={singleCol == null || singleCol < 1} title="Move column left" onClick={() => moveColumn(-1)}>
              <IconArrowLeft size={12} /> Move
            </DdBtn>
            <DdBtn disabled={singleCol == null || singleCol >= cols.length - 1} title="Move column right" onClick={() => moveColumn(1)}>
              Move <IconArrowRight size={12} />
            </DdBtn>
            <DdBtn disabled={maxCol == null && singleCol == null} title="Duplicate rightmost selected column" onClick={duplicateColumn}>
              <IconCopy size={12} /> Duplicate
            </DdBtn>
          </div>
          <div className="flex flex-wrap gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-700">
            <DdBtn title="Reset all columns to equal width" onClick={() => updateElement(el.id, { columnWidths: undefined })}>
              Equal widths
            </DdBtn>
            <DdBtn
              title="Clear all row, column, and cell fill colors"
              onClick={() => updateElement(el.id, {
                tableRowBackgrounds: undefined,
                tableColumnBackgrounds: undefined,
                tableCellBackgrounds: undefined,
              })}
            >
              Clear fills
            </DdBtn>
          </div>
        </DropdownMenu>

        {/* ---- Rows dropdown ---- */}
        <DropdownMenu
          icon={<IconRows size={14} />}
          label="Row operations"
          isOpen={openMenu === 'rows'}
          onToggle={() => toggleMenu('rows')}
        >
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
            {dataRowIndices.length
              ? `${dataRowIndices.length} data row(s) targeted.`
              : 'Select a data row (row number) or a cell.'}
          </p>
          <div className="flex flex-wrap gap-1">
            <DdBtn title="Insert row before first selected" onClick={insertRowBefore}>
              <IconPlus size={12} /> Before
            </DdBtn>
            <DdBtn title="Insert row after last selected" onClick={insertOneRowAfterSelection}>
              <IconPlus size={12} /> After
            </DdBtn>
            <DdBtn disabled={!dataRowIndices.length} title="Delete selected data rows" onClick={deleteDataRows}>
              <IconTrash size={12} /> Remove
            </DdBtn>
          </div>
          <div className="flex flex-wrap gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-700">
            <DdBtn disabled={singleDataRow == null || singleDataRow < 1} title="Move row up" onClick={() => moveRow(-1)}>
              <IconArrowUp size={12} /> Move
            </DdBtn>
            <DdBtn disabled={singleDataRow == null || singleDataRow >= totalDataRows - 1} title="Move row down" onClick={() => moveRow(1)}>
              Move <IconArrowDown size={12} />
            </DdBtn>
            <DdBtn disabled={maxDataRow == null && singleDataRow == null} title="Duplicate last selected row" onClick={duplicateRow}>
              <IconCopy size={12} /> Duplicate
            </DdBtn>
          </div>
          <div className="flex flex-wrap gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-700">
            <DdBtn title="Reset all body rows to equal height" onClick={() => updateElement(el.id, { tableRowWeights: undefined })}>
              Equal heights
            </DdBtn>
          </div>
        </DropdownMenu>
    </div>
  )
}
