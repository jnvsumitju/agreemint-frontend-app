/** TABLE canvas selection (extends beyond a single cell). */
export type TableSelection =
  | null
  | { tableId: string; mode: 'cell'; row: number; col: number }
  | { tableId: string; mode: 'columns'; cols: number[] }
  | { tableId: string; mode: 'rows'; rows: number[] }

/** row: -1 = header row, 0.. = preview data row index (JSON array index). */
export const TABLE_HEADER_ROW = -1

export function sortUniqueInts(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b)
}

/** Properties sidebar: column card highlight (not whole-table when a row is selected). */
export function isColumnHighlighted(sel: TableSelection, tableId: string, colIndex: number): boolean {
  if (!sel || sel.tableId !== tableId) return false
  if (sel.mode === 'columns') return sel.cols.includes(colIndex)
  if (sel.mode === 'cell') return sel.col === colIndex
  return false
}

export function isRowHighlighted(sel: TableSelection, tableId: string, row: number): boolean {
  if (!sel || sel.tableId !== tableId) return false
  if (sel.mode === 'rows') return sel.rows.includes(row)
  if (sel.mode === 'cell') return sel.row === row
  return false
}

const V_BORDER = 'border-violet-600 dark:border-violet-400'
/** Semi-transparent fill for block selection (use on canvas; combine with custom cell bg via inset shadow in component). */
export const TABLE_BLOCK_SELECTION_FILL =
  'bg-violet-500/[0.14] dark:bg-violet-400/[0.16]'

function rowSetHasContiguousAbove(r: number, set: Set<number>): boolean {
  if (r === TABLE_HEADER_ROW) return false
  if (r === 0) return set.has(TABLE_HEADER_ROW)
  return set.has(r - 1)
}

function rowSetHasContiguousBelow(r: number, set: Set<number>): boolean {
  if (r === TABLE_HEADER_ROW) return set.has(0)
  return set.has(r + 1)
}

/** Excel-style unified fill + outer frame for one cell inside a column block (not per-cell inset rings). */
export function columnBlockSelectionClasses(
  sel: TableSelection,
  tableId: string,
  col: number,
  isHeaderRow: boolean,
  previewBodyRowIndex: number,
  lastPreviewBodyRowIndex: number,
  /** When true, the letter row draws the top edge of the column block so header cells skip `border-t`. */
  columnLetterChromeVisible: boolean
): string {
  if (!sel || sel.tableId !== tableId || sel.mode !== 'columns' || !sel.cols.includes(col)) return ''
  const set = new Set(sel.cols)
  const leftEdge = !set.has(col - 1)
  const rightEdge = !set.has(col + 1)
  const topEdge = isHeaderRow && !columnLetterChromeVisible
  const bottomEdge = !isHeaderRow && previewBodyRowIndex === lastPreviewBodyRowIndex
  const parts = ['relative z-[1]']
  if (topEdge) parts.push('border-t-2', V_BORDER)
  if (bottomEdge) parts.push('border-b-2', V_BORDER)
  if (leftEdge) parts.push('border-l-2', V_BORDER)
  if (rightEdge) parts.push('border-r-2', V_BORDER)
  return parts.join(' ')
}

/** Excel-style row block: perimeter borders + tint for one grid cell (or gutter: pass col 0, nCols 1). */
export function rowBlockSelectionClasses(
  sel: TableSelection,
  tableId: string,
  col: number,
  nCols: number,
  row: number
): string {
  if (!sel || sel.tableId !== tableId || sel.mode !== 'rows' || !sel.rows.includes(row)) return ''
  const set = new Set(sel.rows)
  const topEdge = !rowSetHasContiguousAbove(row, set)
  const bottomEdge = !rowSetHasContiguousBelow(row, set)
  const leftEdge = col === 0
  const rightEdge = col === nCols - 1
  const parts = ['relative z-[1]']
  if (topEdge) parts.push('border-t-2', V_BORDER)
  if (bottomEdge) parts.push('border-b-2', V_BORDER)
  if (leftEdge) parts.push('border-l-2', V_BORDER)
  if (rightEdge) parts.push('border-r-2', V_BORDER)
  return parts.join(' ')
}

/** Column letter cell (single row of chrome): outline when that column is selected. */
export function columnLetterSelectionClasses(sel: TableSelection, tableId: string, col: number): string {
  if (!sel || sel.tableId !== tableId || sel.mode !== 'columns' || !sel.cols.includes(col)) return ''
  const set = new Set(sel.cols)
  const leftEdge = !set.has(col - 1)
  const rightEdge = !set.has(col + 1)
  const parts = ['relative z-[1]', 'border-t-2', V_BORDER, 'border-b-2', V_BORDER]
  if (leftEdge) parts.push('border-l-2', V_BORDER)
  if (rightEdge) parts.push('border-r-2', V_BORDER)
  return parts.join(' ')
}

export function isCellHighlighted(sel: TableSelection, tableId: string, row: number, col: number): boolean {
  if (!sel || sel.tableId !== tableId) return false
  if (sel.mode === 'cell') return sel.row === row && sel.col === col
  if (sel.mode === 'columns') return sel.cols.includes(col)
  if (sel.mode === 'rows') return sel.rows.includes(row)
  return false
}

export function tableSelectionSummary(sel: TableSelection): string {
  if (!sel) return ''
  if (sel.mode === 'cell') return `Cell (${sel.row === TABLE_HEADER_ROW ? 'header' : `row ${sel.row + 2}`}, col ${sel.col + 1})`
  if (sel.mode === 'columns')
    return sel.cols.length === 1 ? `Column ${sel.cols[0] + 1}` : `${sel.cols.length} columns`
  if (sel.mode === 'rows') {
    const labels = sel.rows.map((r) =>
      r === TABLE_HEADER_ROW ? 'Header' : `Row ${r + 2}`
    )
    return sel.rows.length === 1 ? labels[0] : `${sel.rows.length} rows (${labels.join(', ')})`
  }
  return ''
}

export function toggleColumnSelection(
  prev: TableSelection,
  tableId: string,
  col: number,
  additive: boolean
): TableSelection {
  if (!additive || prev?.tableId !== tableId || prev.mode !== 'columns') {
    return { tableId, mode: 'columns', cols: [col] }
  }
  const set = new Set(prev.cols)
  if (set.has(col)) set.delete(col)
  else set.add(col)
  const cols = sortUniqueInts([...set])
  return cols.length ? { tableId, mode: 'columns', cols } : null
}

export function toggleRowSelection(
  prev: TableSelection,
  tableId: string,
  row: number,
  additive: boolean
): TableSelection {
  if (!additive || prev?.tableId !== tableId || prev.mode !== 'rows') {
    return { tableId, mode: 'rows', rows: [row] }
  }
  const set = new Set(prev.rows)
  if (set.has(row)) set.delete(row)
  else set.add(row)
  const rows = sortUniqueInts([...set])
  return rows.length ? { tableId, mode: 'rows', rows } : null
}
