/**
 * JSON export/import for template layouts.
 *
 * Export: serializes the current editor state (layout + variable values) to a JSON file.
 * Import: reads a JSON file and loads it into the editor.
 */

import { buildLayoutJson, parseLayoutJson, type LayoutJson, type PageSpec } from '../types/layout'
import type { LayoutDocumentPage, VariableDefinition } from '../types/layout'

export interface TemplateExportPayload {
  __agreemint_template__: true
  version: number
  layout: LayoutJson
  variableValues?: Record<string, string>
  exportedAt: string
}

/** Export current editor state as a downloadable JSON file. */
export function exportTemplateJson(
  pages: LayoutDocumentPage[],
  pageSpec: PageSpec,
  globalVariables: VariableDefinition[],
  variableValues: Record<string, string>,
  filename?: string
) {
  const layout = buildLayoutJson(pages, pageSpec, globalVariables)
  const payload: TemplateExportPayload = {
    __agreemint_template__: true,
    version: 2,
    layout,
    variableValues,
    exportedAt: new Date().toISOString(),
  }

  const json = JSON.stringify(payload, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? 'template-export.json'
  a.rel = 'noopener'
  a.click()
  URL.revokeObjectURL(url)
}

/** Import a template JSON file. Returns parsed data or throws on invalid format. */
export async function importTemplateJson(
  file: File
): Promise<{
  pages: LayoutDocumentPage[]
  pageSpec: PageSpec
  globalVariables: VariableDefinition[]
  variableValues: Record<string, string>
}> {
  const text = await file.text()
  const raw = JSON.parse(text)

  // Support both the export wrapper format and raw LayoutJson
  let layoutJson: LayoutJson | Record<string, unknown>
  let variableValues: Record<string, string> = {}

  if (raw?.__agreemint_template__ && raw.layout) {
    layoutJson = raw.layout
    variableValues = raw.variableValues ?? {}
  } else if (raw?.page) {
    // Raw LayoutJson format
    layoutJson = raw
  } else {
    throw new Error('Unrecognized template format. Expected an Agreemint template JSON file.')
  }

  const result = parseLayoutJson(layoutJson)
  return {
    pages: result.pages,
    pageSpec: result.page,
    globalVariables: result.globalVariables,
    variableValues,
  }
}
