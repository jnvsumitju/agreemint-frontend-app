import type { LayoutElement } from '../types/layout'
import {
  extractVariableKeysFromAnyContent,
  extractVariableKeysFromLayout,
} from './richContent'

export {
  normalizeVariableIdentifier,
  parseContentToRuns,
  serializeRunsToContent,
  extractVariableKeysFromRuns,
  extractVariableKeysFromAnyContent,
  substituteRunsPlain,
  type RichRun,
  type RichContentDoc,
} from './richContent'

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

export function extractVariableKeys(elements: LayoutElement[]): string[] {
  const set = new Set<string>()
  for (const k of extractVariableKeysFromLayout(elements)) set.add(k)
  for (const k of uniqueTableDataKeys(elements)) set.add(k)
  return [...set].sort()
}

export function extractVariableKeysFromText(text: string | undefined): string[] {
  return extractVariableKeysFromAnyContent(text)
}

/** Turn `customer_name` into "Customer Name" for default canvas preview. */
export function defaultPreviewValueForVariable(key: string): string {
  return key
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Plain-string substitution (legacy templates and simple fields). */
export function substituteVariables(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const v = values[key]
    return v != null ? v : ''
  })
}

export function uniqueTableDataKeys(elements: LayoutElement[]): string[] {
  const keys = new Set<string>()
  const walk = (el: LayoutElement) => {
    if (el.type === 'TABLE' && el.dataKey) keys.add(el.dataKey)
    if (el.bandElements?.length) for (const c of el.bandElements) walk(c)
  }
  for (const el of elements) walk(el)
  return [...keys]
}

/** Default Variables value for a table’s JSON array (editor + PDF row data). */
export function defaultSampleTableRowsJson(): string {
  return '[{"name":"Item A","price":"10"},{"name":"Item B","price":"20"}]'
}

export { VAR_RE }
