import type { LayoutElement } from '../types/layout'
import {
  extractVariableKeysFromAnyContent,
  extractVariableKeysFromLayout,
} from './richContent'
import { substituteWithPipes, VAR_PIPE_RE } from './variablePipes'

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

const VAR_RE = VAR_PIPE_RE

export function extractVariableKeys(elements: LayoutElement[]): string[] {
  const set = new Set<string>()
  for (const k of extractVariableKeysFromLayout(elements)) set.add(k)
  for (const k of uniqueTableDataKeys(elements)) set.add(k)
  for (const k of uniqueListDataKeys(elements)) set.add(k)
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

/** Plain-string substitution with pipe support (legacy templates and simple fields). */
export function substituteVariables(template: string, values: Record<string, string>): string {
  return substituteWithPipes(template, (key) => values[key])
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

/**
 * Default Variables value for a table's JSON array (editor + PDF row data).
 *
 * Empty by design: the only rows that should appear in the preview or PDF
 * are the ones the author typed into the canvas. Seeding a placeholder
 * (`{name:"Item A",price:10}`) caused two bad surprises — the keys didn't
 * match the table's actual columns so body cells rendered blank, and the
 * raw JSON leaked into the preview-data panel when the dataKey had no
 * matching TABLE element.
 */
export function defaultSampleTableRowsJson(): string {
  return '[]'
}

export function uniqueListDataKeys(elements: LayoutElement[]): string[] {
  const keys = new Set<string>()
  const walk = (el: LayoutElement) => {
    if (el.type === 'LIST' && el.dataKey) keys.add(el.dataKey)
    if (el.bandElements?.length) for (const c of el.bandElements) walk(c)
  }
  for (const el of elements) walk(el)
  return [...keys]
}

/** Default Variables value for a list's JSON array (editor + PDF item data). */
export function defaultSampleListItemsJson(): string {
  return '["First item","Second item","Third item"]'
}

/** Default Variables value for a nested/tree list JSON (editor + PDF item data). */
export function defaultSampleNestedListJson(): string {
  return JSON.stringify([
    { text: 'Section A', children: [
      { text: 'Sub-item 1' },
      { text: 'Sub-item 2' },
    ]},
    { text: 'Section B', children: [
      { text: 'Sub-item 3' },
    ]},
  ])
}

export { VAR_RE }
