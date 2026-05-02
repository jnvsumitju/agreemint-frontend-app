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

export interface BootstrapEditorActions {
  loadLayout: (p: ParsedLayoutResult) => void
  loadElements: (elements: LayoutElement[]) => void
  setVersionInfo: (id: string | null, n: number | null) => void
  setVariableValue: (k: string, v: string) => void
}

/**
 * Bootstrap precedence (server is authoritative under collab):
 *   1. Server DRAFT — the live editing state flushed by {@code CollabFlushJob}
 *   2. Latest committed VERSION — for fresh templates with no draft yet
 *   3. Local snapshot — last-resort offline fallback only (both server paths failed)
 *
 * The old logic preferred local over server whenever local was newer, which let
 * a stale local cache from a prior session load an outdated layout with
 * mismatched element ids — remote ops then silently dropped on the receiver.
 * With collab, the server is the single source of truth; local storage exists
 * only to survive a genuinely-offline reload.
 *
 * <p>Reviewer/Viewer override: when {@code committedOnly} is true the draft
 * step is skipped entirely and we load straight from {@code versions[0]}.
 * Reviewers see only what designers have explicitly committed; in-flight
 * draft state is invisible to them until they flip the Live toggle.
 */
export async function bootstrapEditorFromRemote(
  templateId: string,
  versions: TemplateVersionDto[],
  actions: BootstrapEditorActions,
  options: { committedOnly?: boolean } = {}
): Promise<void> {
  if (options.committedOnly) {
    if (versions.length > 0) {
      const latest = versions[0]
      const parsed = parseLayoutJson(latest.layout as unknown as LayoutJson)
      actions.loadLayout(parsed)
      actions.setVersionInfo(latest.id, latest.versionNumber)
      return
    }
    // No committed version yet — show empty state. Reviewers must wait for
    // a designer to commit before they have anything to look at. (After the
    // backend auto-creates v1 on template creation, this only fires for
    // legacy templates that predate that change.)
    actions.loadElements([])
    actions.setVersionInfo(null, null)
    return
  }
  let serverDraft: {
    layout: Record<string, unknown>
    variables: Record<string, unknown> | null
    updatedAt: string
  } | null = null
  let serverReachable = true
  try {
    serverDraft = await fetchDraft(templateId)
  } catch (err) {
    // fetchDraft returns null on 404 (no draft yet). Distinguish "no draft"
    // from "fetch failed" — we only want to fall through to localStorage in
    // the genuinely-unreachable case.
    serverDraft = null
    if (err instanceof TypeError || isNetworkError(err)) {
      serverReachable = false
    }
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

  // Only now reach for localStorage — every server path is empty/unreachable.
  if (!serverReachable) {
    const local: LocalEditorSnapshot | null = readLocalEditorSnapshot(templateId)
    if (local) {
      applyLayoutAndVariablesFromSnapshot(
        local,
        actions.loadLayout,
        actions.setVariableValue,
        actions.setVersionInfo
      )
      return
    }
  }

  actions.loadElements([])
  actions.setVersionInfo(null, null)
}

function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: unknown }).name
  return name === 'NetworkError' || name === 'AbortError'
}
