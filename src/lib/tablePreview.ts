import type { LayoutElement } from '../types/layout'
import { tableRowHidden, variableValuesToDataTree } from './layoutBehaviourResolve'
import {
  detectTableDataFormatFromJson,
  parseTableVariableData,
  structuredRowToObject,
} from './tableDataFormat'

/** Default body preview rows on the editor canvas when `tablePreviewBodyRows` is omitted. */
export const TABLE_PREVIEW_ROW_COUNT = 3

/** Effective body preview row count for this table (clamped 1–30, default 3). */
export function tablePreviewBodyRowCount(el: LayoutElement): number {
  if (el.type !== 'TABLE') return TABLE_PREVIEW_ROW_COUNT
  const r = el.tablePreviewBodyRows
  if (typeof r === 'number' && Number.isFinite(r)) {
    return Math.max(1, Math.min(30, Math.floor(r)))
  }
  return TABLE_PREVIEW_ROW_COUNT
}

/** Excel-style column letters: 0→A, 25→Z, 26→AA, … */
export function excelColumnLabel(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1
  let s = ''
  while (n > 0) {
    n -= 1
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}

/** Sample rows for canvas grid: first rows from Variables JSON for `dataKey`, else empty objects. */
export function getTablePreviewRows(
  el: LayoutElement,
  variableValues: Record<string, string>,
  maxRows: number = TABLE_PREVIEW_ROW_COUNT
): Record<string, unknown>[] {
  if (el.type !== 'TABLE') return []
  const dk = el.dataKey ?? 'items'
  const raw = variableValues[dk]?.trim()
  if (raw) {
    try {
      const j = JSON.parse(raw) as unknown
      if (Array.isArray(j)) {
        return j.slice(0, maxRows).map((row) =>
          row != null && typeof row === 'object' && !Array.isArray(row)
            ? (row as Record<string, unknown>)
            : {}
        )
      }
    } catch {
      /* ignore */
    }
  }
  return Array.from({ length: maxRows }, () => ({}))
}

export type TableDataSourceState =
  | { kind: 'empty'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'ok'; totalRows: number; showingRows: number }

/** How row data under `dataKey` parses (for canvas status line). */
export function getTableDataSourceState(
  el: LayoutElement,
  variableValues: Record<string, string>
): TableDataSourceState {
  if (el.type !== 'TABLE') {
    return { kind: 'empty', message: '' }
  }
  const dk = el.dataKey ?? 'items'
  const raw = variableValues[dk]?.trim() ?? ''
  if (!raw) {
    return {
      kind: 'empty',
      message: `Add a JSON array under “${dk}” in Variables to preview rows.`,
    }
  }
  try {
    const j = JSON.parse(raw) as unknown
    // Structured format: { data: [[...]], cellStyle?: [...], borderStyle?: {...} }
    if (detectTableDataFormat(j) === 'structured') {
      const tvd = (j as Record<string, unknown>).data as string[][]
      const n = Math.max(0, tvd.length - 1) // exclude header row
      if (n === 0) {
        return { kind: 'empty', message: `”${dk}” has headers only — PDF will show headers only.` }
      }
      const showing = Math.min(n, tablePreviewBodyRowCount(el))
      return { kind: 'ok', totalRows: n, showingRows: showing }
    }
    // Legacy format: [{...}, {...}]
    if (!Array.isArray(j)) {
      return { kind: 'invalid', message: `”${dk}” must be a JSON array of row objects.` }
    }
    const n = j.length
    if (n === 0) {
      return { kind: 'empty', message: `Array “${dk}” is empty — PDF will show headers only.` }
    }
    const showing = Math.min(n, tablePreviewBodyRowCount(el))
    return {
      kind: 'ok',
      totalRows: n,
      showingRows: showing,
    }
  } catch {
    return { kind: 'invalid', message: `Fix JSON for “${dk}” in Variables.` }
  }
}

function detectTableDataFormat(parsed: unknown): 'legacy' | 'structured' {
  if (Array.isArray(parsed)) return 'legacy'
  if (parsed != null && typeof parsed === 'object' && 'data' in parsed) {
    const d = (parsed as Record<string, unknown>).data
    if (Array.isArray(d) && (d.length === 0 || Array.isArray(d[0]))) return 'structured'
  }
  return 'legacy'
}

/** Data rows for table body preview, after behaviour rowRules hide filter. */
export function getVisibleTableBodyRows(
  el: LayoutElement,
  variableValues: Record<string, string>,
  maxRows: number = TABLE_PREVIEW_ROW_COUNT
): { rowIndex: number; row: Record<string, unknown> }[] {
  if (el.type !== 'TABLE') return []
  const dk = el.dataKey ?? 'items'
  const raw = variableValues[dk]?.trim()

  // Try structured format first
  const tvd = parseTableVariableData(raw)
  if (tvd) {
    const dataTree = variableValuesToDataTree(variableValues)
    const bodyCount = Math.max(0, tvd.data.length - 1)
    if (bodyCount === 0) {
      return Array.from({ length: maxRows }, (_, rowIndex) => ({
        rowIndex,
        row: {} as Record<string, unknown>,
      }))
    }
    const out: { rowIndex: number; row: Record<string, unknown> }[] = []
    for (let ri = 0; ri < bodyCount; ri++) {
      const rowObj = structuredRowToObject(tvd, ri)
      if (tableRowHidden(el.behaviour, rowObj, dataTree)) continue
      out.push({ rowIndex: ri, row: rowObj })
      if (out.length >= maxRows) break
    }
    return out
  }

  // Legacy format
  const all: Record<string, unknown>[] = []
  if (raw) {
    try {
      const j = JSON.parse(raw) as unknown
      if (Array.isArray(j)) {
        for (const row of j) {
          all.push(
            row != null && typeof row === 'object' && !Array.isArray(row)
              ? (row as Record<string, unknown>)
              : {}
          )
        }
      }
    } catch {
      /* ignore */
    }
  }
  const dataTree = variableValuesToDataTree(variableValues)
  if (all.length === 0) {
    return Array.from({ length: maxRows }, (_, rowIndex) => ({
      rowIndex,
      row: {} as Record<string, unknown>,
    }))
  }
  const out: { rowIndex: number; row: Record<string, unknown> }[] = []
  for (let rowIndex = 0; rowIndex < all.length; rowIndex++) {
    const row = all[rowIndex]!
    if (tableRowHidden(el.behaviour, row, dataTree)) continue
    out.push({ rowIndex, row })
    if (out.length >= maxRows) break
  }
  return out
}

export function formatPreviewCellValue(row: Record<string, unknown>, colKey: string): string {
  if (!(colKey in row) || row[colKey] == null) return ''
  const v = row[colKey]
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v)
  }
  try {
    return JSON.stringify(v)
  } catch {
    return ''
  }
}
