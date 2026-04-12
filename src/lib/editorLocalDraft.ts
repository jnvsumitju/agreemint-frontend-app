import type { EditorState } from '../stores/editorStore'
import {
  buildLayoutJson,
  parseLayoutJson,
  type LayoutJson,
  type ParsedLayoutResult,
} from '../types/layout'

const STORAGE_V = 1 as const

export interface LocalEditorSnapshot {
  v: typeof STORAGE_V
  updatedAt: number
  layout: Record<string, unknown>
  variableValues: Record<string, string>
  currentVersionId: string | null
  versionNumber: number | null
}

function key(templateId: string): string {
  return `agreemint:editor:${templateId}`
}

export function readLocalEditorSnapshot(templateId: string): LocalEditorSnapshot | null {
  try {
    const raw = localStorage.getItem(key(templateId))
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<LocalEditorSnapshot>
    if (o.v !== STORAGE_V || !o.layout || typeof o.layout !== 'object') return null
    return {
      v: STORAGE_V,
      updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
      layout: o.layout as Record<string, unknown>,
      variableValues:
        o.variableValues && typeof o.variableValues === 'object' ? { ...o.variableValues } : {},
      currentVersionId: o.currentVersionId ?? null,
      versionNumber: o.versionNumber ?? null,
    }
  } catch {
    return null
  }
}

export function writeLocalEditorSnapshot(templateId: string, snapshot: LocalEditorSnapshot): void {
  try {
    localStorage.setItem(key(templateId), JSON.stringify(snapshot))
  } catch {
    /* quota / private mode */
  }
}

export function jsonVariablesToStrings(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v
    else if (v != null) out[k] = JSON.stringify(v)
  }
  return out
}

export function snapshotFromEditorState(s: EditorState): LocalEditorSnapshot {
  return {
    v: STORAGE_V,
    updatedAt: Date.now(),
    layout: buildLayoutJson(s.pages, s.pageSpec, s.globalVariableDefinitions) as unknown as Record<
      string,
      unknown
    >,
    variableValues: { ...s.variableValues },
    currentVersionId: s.currentVersionId,
    versionNumber: s.versionNumber,
  }
}

export function applyLayoutAndVariablesFromSnapshot(
  snapshot: LocalEditorSnapshot,
  loadLayout: (p: ParsedLayoutResult) => void,
  setVariableValue: (k: string, v: string) => void,
  setVersionInfo: (id: string | null, n: number | null) => void
): void {
  const parsed = parseLayoutJson(snapshot.layout as unknown as LayoutJson)
  loadLayout(parsed)
  for (const [k, v] of Object.entries(snapshot.variableValues)) {
    setVariableValue(k, v)
  }
  setVersionInfo(snapshot.currentVersionId, snapshot.versionNumber)
}
