import type { LayoutElement } from '../types/layout'
import { variableValuesToDataTree } from './layoutBehaviourResolve'
import {
  defaultSampleListItemsJson,
  defaultSampleTableRowsJson,
  extractVariableKeys,
  uniqueListDataKeys,
  uniqueTableDataKeys,
} from './variables'
import { detectTableDataFormatFromJson, parseTableVariableData } from './tableDataFormat'

/** {{variable}} keys that are not table/list JSON data keys. */
export function scalarVariableKeys(allKeys: string[], tableDataKeys: string[], listDataKeys: string[] = []): string[] {
  const bound = new Set([...tableDataKeys, ...listDataKeys])
  return allKeys.filter((k) => !bound.has(k))
}

export function getTableColumnsForDataKey(
  elements: LayoutElement[],
  dataKey: string
): { header: string; key: string }[] {
  const el = elements.find((e) => e.type === 'TABLE' && e.dataKey === dataKey)
  const cols = el?.columns
  if (cols?.length) {
    return cols.map((c) => ({
      header: (c.header || c.key || 'Column').trim() || c.key,
      key: c.key,
    }))
  }
  return [{ header: 'Value', key: 'value' }]
}

export function emptyTableRow(columnKeys: string[]): Record<string, string> {
  return Object.fromEntries(columnKeys.map((k) => [k, '']))
}

/** Parse stored JSON into rows aligned to template column keys. */
export function parseTableRowsFromJson(
  json: string,
  columnKeys: string[]
): Record<string, string>[] {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [emptyTableRow(columnKeys)]
    }
    return parsed.map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const out: Record<string, string> = {}
      for (const k of columnKeys) {
        const v = row[k]
        out[k] = v != null && v !== '' ? String(v) : ''
      }
      return out
    })
  } catch {
    return [emptyTableRow(columnKeys)]
  }
}

export function tableRowsToPayload(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.map((row) => {
    const o: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) o[k] = v
    return o
  })
}

export function humanizeVariableKey(key: string): string {
  return key
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Same merge rules as the preview modal form, for `/api/generate` data payloads. */
export function buildGenerationDataFromVariableValues(
  elements: LayoutElement[],
  variableValues: Record<string, string>
): Record<string, unknown> {
  const keys = extractVariableKeys(elements)
  const tableKeys = uniqueTableDataKeys(elements)
  const listKeys = uniqueListDataKeys(elements)
  const scalars = scalarVariableKeys(keys, tableKeys, listKeys)
  const data = variableValuesToDataTree(
    Object.fromEntries(scalars.map((k) => [k, variableValues[k] ?? '']))
  ) as Record<string, unknown>
  for (const tk of tableKeys) {
    const raw = variableValues[tk]?.trim() ? variableValues[tk]! : defaultSampleTableRowsJson()
    // Structured format: pass the full object (data, cellStyle, borderStyle) to backend
    if (detectTableDataFormatFromJson(raw) === 'structured') {
      const tvd = parseTableVariableData(raw)
      if (tvd) {
        data[tk] = tvd
        continue
      }
    }
    // Legacy format
    const cols = getTableColumnsForDataKey(elements, tk)
    const colKeys = cols.map((c) => c.key)
    data[tk] = tableRowsToPayload(parseTableRowsFromJson(raw, colKeys))
  }
  // LIST data keys: pass as parsed JSON arrays
  for (const lk of listKeys) {
    const raw = variableValues[lk]?.trim() ? variableValues[lk]! : defaultSampleListItemsJson()
    try {
      data[lk] = JSON.parse(raw)
    } catch {
      data[lk] = [raw]
    }
  }
  return data
}
