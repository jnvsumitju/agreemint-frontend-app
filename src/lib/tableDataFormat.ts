import type { TableColumn, TableCellStyle, TableBorderStyle, TableVariableData } from '../types/layout'
import { parseContentToRuns } from './richContent'

// ---------------------------------------------------------------------------
// Rich-content → plain text (for headers stored as TipTap JSON)
// ---------------------------------------------------------------------------

/**
 * Extract plain text from a column header that may be rich-text JSON
 * (e.g. `{"rich":true,"runs":[{"type":"text","text":"Name"}]}`).
 * Returns empty string if the header is empty rich content.
 */
function richHeaderToPlainText(header: string): string {
  const runs = parseContentToRuns(header)
  return runs
    .map((r) => (r.type === 'text' ? r.text ?? '' : r.type === 'var' ? r.name ?? '' : ''))
    .join('')
    .trim()
}

/** Get a plain-text header label from a TableColumn, falling back to its key. */
function columnPlainHeader(c: TableColumn): string {
  return richHeaderToPlainText(c.header) || c.key
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export type TableDataFormat = 'legacy' | 'structured'

/** Detect whether a parsed variable value is legacy (array of objects) or structured. */
export function detectTableDataFormat(parsed: unknown): TableDataFormat {
  if (Array.isArray(parsed)) return 'legacy'
  if (parsed != null && typeof parsed === 'object' && 'data' in parsed) {
    const d = (parsed as Record<string, unknown>).data
    if (Array.isArray(d) && (d.length === 0 || Array.isArray(d[0]))) return 'structured'
  }
  return 'legacy'
}

/** Detect format directly from a raw JSON string stored in variableValues. */
export function detectTableDataFormatFromJson(rawJson: string | undefined): TableDataFormat {
  const t = rawJson?.trim() ?? ''
  if (!t) return 'legacy'
  try {
    return detectTableDataFormat(JSON.parse(t) as unknown)
  } catch {
    return 'legacy'
  }
}

// ---------------------------------------------------------------------------
// Parsing / serialization
// ---------------------------------------------------------------------------

/** Parse a JSON string into TableVariableData. Returns null if not structured format or invalid. */
export function parseTableVariableData(rawJson: string | undefined): TableVariableData | null {
  const t = rawJson?.trim() ?? ''
  if (!t) return null
  try {
    const parsed = JSON.parse(t) as unknown
    if (detectTableDataFormat(parsed) !== 'structured') return null
    const obj = parsed as Record<string, unknown>
    const data = obj.data as string[][]
    return {
      data,
      cellStyle: obj.cellStyle as (TableCellStyle | null)[][] | undefined,
      borderStyle: obj.borderStyle as TableBorderStyle | undefined,
    }
  } catch {
    return null
  }
}

/** Serialize TableVariableData to a JSON string for storage in variableValues. */
export function serializeTableVariableData(tvd: TableVariableData): string {
  const out: Record<string, unknown> = { data: tvd.data }
  if (tvd.cellStyle) out.cellStyle = tvd.cellStyle
  if (tvd.borderStyle) out.borderStyle = tvd.borderStyle
  return JSON.stringify(out)
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/** Convert legacy row-object array + column definitions to structured format. */
export function legacyToStructuredTableData(
  rows: Record<string, unknown>[],
  columns: TableColumn[]
): TableVariableData {
  const headers = columns.map(columnPlainHeader)
  const dataRows = rows.map((row) => columns.map((c) => String(row[c.key] ?? '')))
  return { data: [headers, ...dataRows] }
}

/** Convert structured 2D data back to legacy row-object array (uses columns for key mapping). */
export function structuredToLegacyRows(
  tvd: TableVariableData,
  columns: TableColumn[]
): Record<string, unknown>[] {
  if (tvd.data.length < 2) return []
  return tvd.data.slice(1).map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col.key] = row[i] ?? ''
    })
    return obj
  })
}

/**
 * Convert a structured 2D row (string[]) to a keyed object using data[0] as headers.
 * Useful for behaviour rule evaluation which expects Record<string, unknown>.
 */
export function structuredRowToObject(
  tvd: TableVariableData,
  dataRowIndex: number
): Record<string, unknown> {
  const headers = tvd.data[0] ?? []
  const row = tvd.data[dataRowIndex + 1]
  if (!row) return {}
  const obj: Record<string, unknown> = {}
  headers.forEach((h, i) => {
    obj[h] = row[i] ?? ''
  })
  return obj
}

// ---------------------------------------------------------------------------
// Structured CRUD: cell access
// ---------------------------------------------------------------------------

/** Get a cell value from structured data. rowIndex is 0-based body row (maps to data[rowIndex+1]). */
export function getStructuredCellValue(tvd: TableVariableData, rowIndex: number, colIndex: number): string {
  return tvd.data[rowIndex + 1]?.[colIndex] ?? ''
}

/** Get a header value from structured data. */
export function getStructuredHeaderValue(tvd: TableVariableData, colIndex: number): string {
  return tvd.data[0]?.[colIndex] ?? ''
}

/** Set a cell value. Returns new TableVariableData. */
export function setStructuredCellValue(
  tvd: TableVariableData,
  rowIndex: number,
  colIndex: number,
  value: string
): TableVariableData {
  const data = tvd.data.map((r) => [...r])
  const dataIdx = rowIndex + 1
  while (data.length <= dataIdx) data.push(Array(tvd.data[0]?.length ?? 0).fill(''))
  if (!data[dataIdx]) data[dataIdx] = Array(tvd.data[0]?.length ?? 0).fill('')
  data[dataIdx][colIndex] = value
  return { ...tvd, data }
}

/** Set a header value. Returns new TableVariableData. */
export function setStructuredHeaderValue(
  tvd: TableVariableData,
  colIndex: number,
  value: string
): TableVariableData {
  const data = tvd.data.map((r) => [...r])
  if (!data[0]) data[0] = []
  data[0][colIndex] = value
  return { ...tvd, data }
}

// ---------------------------------------------------------------------------
// Structured CRUD: row operations
// ---------------------------------------------------------------------------

/** Number of body rows (excludes header row 0). */
export function structuredBodyRowCount(tvd: TableVariableData): number {
  return Math.max(0, tvd.data.length - 1)
}

/** Column count from the header row. */
export function structuredColumnCount(tvd: TableVariableData): number {
  return tvd.data[0]?.length ?? 0
}

/** Insert an empty body row at the given index (0-based body row index). */
export function insertStructuredRowAt(tvd: TableVariableData, insertIndex: number): TableVariableData {
  const colCount = structuredColumnCount(tvd)
  const emptyRow = Array(colCount).fill('') as string[]
  const dataIdx = insertIndex + 1
  const data = [...tvd.data]
  data.splice(dataIdx, 0, emptyRow)

  let cellStyle = tvd.cellStyle
  if (cellStyle) {
    cellStyle = [...cellStyle]
    const emptyStyle: (TableCellStyle | null)[] = Array(colCount).fill(null)
    cellStyle.splice(dataIdx, 0, emptyStyle)
  }
  return { ...tvd, data, cellStyle }
}

/** Delete body rows at the given indices (0-based body row indices). */
export function deleteStructuredRowsAt(tvd: TableVariableData, rowIndices: number[]): TableVariableData {
  const toRemove = [...new Set(rowIndices)].sort((a, b) => b - a)
  const data = [...tvd.data]
  let cellStyle = tvd.cellStyle ? [...tvd.cellStyle] : undefined
  for (const i of toRemove) {
    const dataIdx = i + 1
    if (dataIdx > 0 && dataIdx < data.length) {
      data.splice(dataIdx, 1)
      cellStyle?.splice(dataIdx, 1)
    }
  }
  return { ...tvd, data, cellStyle }
}

/** Swap two body rows. */
export function swapStructuredRows(tvd: TableVariableData, i: number, j: number): TableVariableData {
  const di = i + 1
  const dj = j + 1
  if (di < 1 || dj < 1 || di >= tvd.data.length || dj >= tvd.data.length) return tvd
  const data = [...tvd.data];
  [data[di], data[dj]] = [data[dj], data[di]]
  let cellStyle = tvd.cellStyle
  if (cellStyle) {
    cellStyle = [...cellStyle];
    [cellStyle[di], cellStyle[dj]] = [cellStyle[dj], cellStyle[di]]
  }
  return { ...tvd, data, cellStyle }
}

/** Duplicate a body row (insert copy after it). */
export function duplicateStructuredRowAt(tvd: TableVariableData, rowIndex: number): TableVariableData {
  const dataIdx = rowIndex + 1
  if (dataIdx < 1 || dataIdx >= tvd.data.length) return tvd
  const data = [...tvd.data]
  data.splice(dataIdx + 1, 0, [...tvd.data[dataIdx]])
  let cellStyle = tvd.cellStyle
  if (cellStyle) {
    cellStyle = [...cellStyle]
    const src = cellStyle[dataIdx]
    cellStyle.splice(dataIdx + 1, 0, src ? [...src] : null as unknown as (TableCellStyle | null)[])
  }
  return { ...tvd, data, cellStyle }
}

// ---------------------------------------------------------------------------
// Structured CRUD: column operations
// ---------------------------------------------------------------------------

/** Insert a column at colIndex with the given header name. */
export function insertStructuredColumnAt(
  tvd: TableVariableData,
  colIndex: number,
  headerName: string
): TableVariableData {
  const data = tvd.data.map((row, ri) => {
    const r = [...row]
    r.splice(colIndex, 0, ri === 0 ? headerName : '')
    return r
  })
  let cellStyle = tvd.cellStyle
  if (cellStyle) {
    cellStyle = cellStyle.map((row) => {
      if (!row) return row
      const r = [...row]
      r.splice(colIndex, 0, null)
      return r
    })
  }
  return { ...tvd, data, cellStyle }
}

/** Delete columns at the given indices. */
export function deleteStructuredColumnsAt(tvd: TableVariableData, colIndices: number[]): TableVariableData {
  const toRemove = new Set(colIndices)
  const data = tvd.data.map((row) => row.filter((_, i) => !toRemove.has(i)))
  let cellStyle = tvd.cellStyle
  if (cellStyle) {
    cellStyle = cellStyle.map((row) => (row ? row.filter((_, i) => !toRemove.has(i)) : row))
  }
  return { ...tvd, data, cellStyle }
}

// ---------------------------------------------------------------------------
// Build initial structured data from element columns
// ---------------------------------------------------------------------------

/** Create a default structured TableVariableData from element columns + preview row count. */
export function buildInitialStructuredData(
  columns: TableColumn[],
  bodyRowCount: number
): TableVariableData {
  const headers = columns.map(columnPlainHeader)
  const colCount = headers.length
  const rows: string[][] = [headers]
  for (let i = 0; i < bodyRowCount; i++) {
    rows.push(Array(colCount).fill('') as string[])
  }
  return { data: rows }
}
