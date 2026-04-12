import type { TemplateVersionDto } from './api'
import { fetchDraft } from './api'
import {
  applyLayoutAndVariablesFromSnapshot,
  jsonVariablesToStrings,
  readLocalEditorSnapshot,
  type LocalEditorSnapshot,
} from './editorLocalDraft'
import type { LayoutElement, ParsedLayoutResult } from '../types/layout'
import { parseLayoutJson, type LayoutJson } from '../types/layout'

function serverDraftTime(iso: string | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

export interface BootstrapEditorActions {
  loadLayout: (p: ParsedLayoutResult) => void
  loadElements: (elements: LayoutElement[]) => void
  setVersionInfo: (id: string | null, n: number | null) => void
  setVariableValue: (k: string, v: string) => void
}

/** Prefer newest of localStorage vs server DRAFT; otherwise latest committed version. */
export async function bootstrapEditorFromRemote(
  templateId: string,
  versions: TemplateVersionDto[],
  actions: BootstrapEditorActions
): Promise<void> {
  let serverDraft: {
    layout: Record<string, unknown>
    variables: Record<string, unknown> | null
    updatedAt: string
  } | null = null
  try {
    serverDraft = await fetchDraft(templateId)
  } catch {
    serverDraft = null
  }

  const local: LocalEditorSnapshot | null = readLocalEditorSnapshot(templateId)
  const localT = local?.updatedAt ?? 0
  const serverT = serverDraft ? serverDraftTime(serverDraft.updatedAt) : 0

  if (local && (!serverDraft || localT >= serverT)) {
    applyLayoutAndVariablesFromSnapshot(
      local,
      actions.loadLayout,
      actions.setVariableValue,
      actions.setVersionInfo
    )
    return
  }

  if (serverDraft) {
    const parsed = parseLayoutJson(serverDraft.layout as unknown as LayoutJson)
    actions.loadLayout(parsed)
    const vars = jsonVariablesToStrings(serverDraft.variables)
    for (const [k, v] of Object.entries(vars)) {
      actions.setVariableValue(k, v)
    }
    const latest = versions[0]
    actions.setVersionInfo(latest?.id ?? null, latest?.versionNumber ?? null)
    return
  }

  if (versions.length > 0) {
    const latest = versions[0]
    const parsed = parseLayoutJson(latest.layout as unknown as LayoutJson)
    actions.loadLayout(parsed)
    actions.setVersionInfo(latest.id, latest.versionNumber)
    return
  }

  actions.loadElements([])
  actions.setVersionInfo(null, null)
}
