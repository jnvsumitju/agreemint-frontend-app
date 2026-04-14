import {
  parseContentToRuns,
  serializeRunsToContent,
  type RichRun,
} from './richContent'

function parseJsonArray(raw: string): { ok: true; arr: unknown[] } | { ok: false } {
  const t = raw?.trim() ?? ''
  if (!t) return { ok: true, arr: [] }
  try {
    const j = JSON.parse(t) as unknown
    if (!Array.isArray(j)) return { ok: false }
    return { ok: true, arr: j }
  } catch {
    return { ok: false }
  }
}

export function patchHeaderPlainText(headerSerialized: string | undefined, plain: string): string {
  const runs = parseContentToRuns(headerSerialized)
  const next: RichRun[] = [...runs]
  const ti = next.findIndex((r) => r.type === 'text')
  if (ti >= 0) {
    const r = next[ti]
    if (r.type === 'text') next[ti] = { ...r, text: plain }
  } else {
    next.unshift({ type: 'text', text: plain })
  }
  return serializeRunsToContent(next)
}

export function getDataCellStringValue(
  rawJson: string,
  rowIndex: number,
  colKey: string
): string {
  const p = parseJsonArray(rawJson)
  if (!p.ok) return ''
  const row = p.arr[rowIndex]
  if (row == null || typeof row !== 'object' || Array.isArray(row)) return ''
  const v = (row as Record<string, unknown>)[colKey]
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return ''
  }
}

export function setDataCellValue(
  rawJson: string,
  rowIndex: number,
  colKey: string,
  value: string
): string {
  const p = parseJsonArray(rawJson)
  if (!p.ok) return rawJson
  const arr = [...p.arr]
  while (arr.length <= rowIndex) {
    arr.push({})
  }
  const prev = arr[rowIndex]
  const base =
    prev != null && typeof prev === 'object' && !Array.isArray(prev)
      ? { ...(prev as Record<string, unknown>) }
      : ({} as Record<string, unknown>)
  base[colKey] = value
  arr[rowIndex] = base
  return JSON.stringify(arr)
}

export function insertRowAt(rawJson: string, insertIndex: number): string {
  const p = parseJsonArray(rawJson)
  if (!p.ok) return rawJson || '[]'
  const arr = [...p.arr]
  const template: Record<string, unknown> = {}
  if (arr.length > 0) {
    const first = arr[0]
    if (first != null && typeof first === 'object' && !Array.isArray(first)) {
      for (const k of Object.keys(first as object)) template[k] = ''
    }
  }
  const at = Math.max(0, Math.min(insertIndex, arr.length))
  arr.splice(at, 0, template)
  return JSON.stringify(arr)
}

export function deleteRowsAt(rawJson: string, rowIndices: number[]): string {
  const p = parseJsonArray(rawJson)
  if (!p.ok) return rawJson
  const toRemove = sortUniqueDesc(rowIndices.filter((i) => i >= 0))
  const arr = [...p.arr]
  for (const i of toRemove) {
    if (i < arr.length) arr.splice(i, 1)
  }
  return JSON.stringify(arr)
}

export function swapRowsAt(rawJson: string, i: number, j: number): string {
  const p = parseJsonArray(rawJson)
  if (!p.ok) return rawJson
  const arr = [...p.arr]
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return rawJson
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  return JSON.stringify(arr)
}

export function duplicateRowAt(rawJson: string, rowIndex: number): string {
  const p = parseJsonArray(rawJson)
  if (!p.ok) return rawJson || '[]'
  const arr = [...p.arr]
  if (rowIndex < 0 || rowIndex >= arr.length) return rawJson
  const copy = JSON.parse(JSON.stringify(arr[rowIndex])) as unknown
  arr.splice(rowIndex + 1, 0, copy)
  return JSON.stringify(arr)
}

function sortUniqueDesc(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => b - a)
}
