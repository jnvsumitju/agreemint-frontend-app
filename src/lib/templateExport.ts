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

export interface ParsedTemplatePayload {
  pages: LayoutDocumentPage[]
  pageSpec: PageSpec
  globalVariables: VariableDefinition[]
  variableValues: Record<string, string>
}

/**
 * Parse an already-decoded template payload. Accepts either the
 * {@link TemplateExportPayload} wrapper or a bare `LayoutJson`, and throws on
 * anything else.
 *
 * <p>Split out from {@link importTemplateJson} so the prebuilt try-a-template
 * bundles (`src/lib/tryTemplates.ts`) go through exactly the same parse as a
 * user-supplied file. Those bundles *are* files produced by
 * {@link exportTemplateJson}, so anything that would reject one here would
 * reject the other — which is the point of sharing this.
 */
export function parseTemplateExportPayload(raw: unknown): ParsedTemplatePayload {
  const candidate = raw as { __agreemint_template__?: unknown; layout?: unknown; page?: unknown; variableValues?: unknown } | null

  // Support both the export wrapper format and raw LayoutJson
  let layoutJson: LayoutJson | Record<string, unknown>
  let variableValues: Record<string, string> = {}

  if (candidate?.__agreemint_template__ && candidate.layout) {
    layoutJson = candidate.layout as LayoutJson
    variableValues = (candidate.variableValues as Record<string, string>) ?? {}
  } else if (candidate?.page) {
    // Raw LayoutJson format
    layoutJson = candidate as Record<string, unknown>
  } else {
    throw new Error('Unrecognized template format. Expected a Crixaa template JSON file.')
  }

  const result = parseLayoutJson(layoutJson)
  return {
    pages: result.pages,
    pageSpec: result.page,
    globalVariables: result.globalVariables,
    variableValues,
  }
}

/** Import a template JSON file. Returns parsed data or throws on invalid format. */
export async function importTemplateJson(file: File): Promise<ParsedTemplatePayload> {
  return parseTemplateExportPayload(JSON.parse(await file.text()))
}
