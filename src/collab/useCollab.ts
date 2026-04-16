// Collaborative editor wiring — runs while an editor is mounted for a template.
//
// On mount:
//   • Subscribe to remote ops → apply via editorStore.applyRemoteOp
//   • Subscribe to snapshot replies → hydrate pages + globals from server state
//   • Observe local store changes (pages, globalVariableDefinitions) and emit
//     structural ops via collabBus.sendOp
//
// The observer is a *diff* observer: it compares consecutive store snapshots and
// emits the minimum op sequence needed for another client to reach the same state.
// This keeps the existing editorStore mutations unchanged — they remain the
// single source of truth for local edits; we just watch the results.
//
// Caveats (Phase 1):
//   • Band-nested children (HEADER/FOOTER bandElements[]) are diffed via their
//     parent element's `bandElements` field as part of a top-level updateElement
//     patch — works but sends the whole band tree per change. Good enough for
//     Phase 1; revisit in Phase 2 alongside Yjs.
//   • Page reorder detection is id-based: if the set of page ids is unchanged
//     but ordering differs, we emit `reorderPages`. If ids differ we emit
//     add/delete page ops instead.

import { useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import type { CollabOpForStore } from '../stores/editorStore'
import type {
  LayoutDocumentPage,
  LayoutElement,
  LayoutJson,
  VariableDefinition,
} from '../types/layout'
import { parseLayoutJson } from '../types/layout'
import { onRemoteOp, onSnapshot, sendOp, type CollabOp, type RemoteOpMessage } from './collabBus'
import { connectYDoc, disconnectYDoc, isYDocActive } from './yDocProvider'
import { useAuthStore } from '../stores/authStore'
import { sendSelectionUpdate } from '../lib/websocket'

/**
 * Mount this hook once per editor instance. It binds store observers + collab
 * listeners for as long as the component is mounted. Idempotent — remounting is
 * safe; listeners are released on unmount.
 */
export function useCollab(templateId: string | null): void {
  useEffect(() => {
    if (!templateId) return

    const myUserId = useAuthStore.getState().user?.id ?? ''

    // ── Receive ────────────────────────────────────────────────────────────────

    const offRemote = onRemoteOp((msg: RemoteOpMessage) => {
      // Skip echoes of our own op — we already applied locally when we sent it.
      if (msg.userId && msg.userId === myUserId) return
      const mapped = mapToStoreOp(msg.op)
      if (!mapped) return
      remoteOpInFlight = true
      try {
        useEditorStore.getState().applyRemoteOp(mapped)
      } finally {
        remoteOpInFlight = false
        // Re-baseline: the observer (which fired synchronously inside applyRemoteOp)
        // will have skipped diffing; capture the post-apply state here so the next
        // local change diffs correctly.
        captureBaseline(useEditorStore.getState())
      }
    })

    const offSnapshot = onSnapshot((snap) => {
      // Full hydrate from server. The wire payload is whatever shape is in Redis
      // or Postgres — possibly wire-format (buildLayoutJson output with elements
      // run through elementToJson) or in-store-format (what ops have been writing
      // to Redis). `parseLayoutJson` tolerates both and normalises to the
      // in-store shape the editor uses.
      const layout = snap.layout as Record<string, unknown> | null
      if (!layout || typeof layout !== 'object') {
        captureBaseline(useEditorStore.getState())
        return
      }
      const hasPages = Array.isArray((layout as { pages?: unknown }).pages)
        && ((layout as { pages: unknown[] }).pages.length > 0)
      const hasLegacyElements = Array.isArray((layout as { elements?: unknown }).elements)
      if (!hasPages && !hasLegacyElements) {
        // Empty server state — keep whatever the client already has (bootstrapped
        // from the REST /draft call on editor load).
        captureBaseline(useEditorStore.getState())
        return
      }
      let parsed
      try {
        // `parseLayoutJson` accepts either the strict LayoutJson or an arbitrary
        // record; cast via `unknown` to satisfy the stricter typed overload.
        parsed = parseLayoutJson(layout as unknown as LayoutJson)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[collab] failed to parse snapshot layout; keeping local state', err)
        captureBaseline(useEditorStore.getState())
        return
      }
      remoteOpInFlight = true
      try {
        // `loadLayout` is the canonical entry point — it normalises page spec,
        // rebuilds variableValues, clears editor UI state while preserving
        // view-only flags, and resets undo/redo history.
        useEditorStore.getState().loadLayout(parsed)
      } finally {
        remoteOpInFlight = false
        captureBaseline(useEditorStore.getState())
      }
    })

    // ── Send ───────────────────────────────────────────────────────────────────

    // Spin up the Y.Doc transport for this template so TipTap Collaboration
    // extensions attached via yDocProvider.getYFragment(...) start syncing.
    activeTemplateIdForDiff = templateId
    connectYDoc(templateId)

    // Capture the baseline at mount so the first diff is well-defined.
    captureBaseline(useEditorStore.getState())

    const unsubscribe = useEditorStore.subscribe((state) => {
      if (remoteOpInFlight) {
        // Rebaseline silently — don't echo a remote change back.
        captureBaseline(state)
        return
      }
      emitOpsForChange(state)
      // Selection broadcast (throttled): fires when the local selectedIds
      // array changes and flushes at most every SELECTION_THROTTLE_MS.
      maybeEmitSelection(templateId, state.selectedIds)
    })

    return () => {
      offRemote()
      offSnapshot()
      unsubscribe()
      disconnectYDoc()
      activeTemplateIdForDiff = null
      resetBaseline()
      // Clear the pending selection broadcast so a re-mount starts fresh.
      if (pendingSelectionTimer != null) {
        window.clearTimeout(pendingSelectionTimer)
        pendingSelectionTimer = null
      }
      pendingSelection = null
      pendingSelectionTemplateId = null
      lastSelectionJson = null
    }
  }, [templateId])
}

// ── Diff + emit ───────────────────────────────────────────────────────────────

interface Baseline {
  pages: LayoutDocumentPage[]
  globalVariableDefinitions: VariableDefinition[]
}

let remoteOpInFlight = false
let baseline: Baseline | null = null
let activeTemplateIdForDiff: string | null = null

// ── Selection broadcast throttle ─────────────────────────────────────────────
const SELECTION_THROTTLE_MS = 80
let lastSelectionJson: string | null = null
let pendingSelectionTimer: number | null = null
let pendingSelection: string[] | null = null
let pendingSelectionTemplateId: string | null = null

function maybeEmitSelection(templateId: string, selectedIds: string[]) {
  const json = JSON.stringify(selectedIds)
  if (json === lastSelectionJson) return
  pendingSelection = selectedIds
  pendingSelectionTemplateId = templateId
  if (pendingSelectionTimer != null) return
  pendingSelectionTimer = window.setTimeout(() => {
    pendingSelectionTimer = null
    if (pendingSelection && pendingSelectionTemplateId) {
      lastSelectionJson = JSON.stringify(pendingSelection)
      sendSelectionUpdate(pendingSelectionTemplateId, pendingSelection)
    }
    pendingSelection = null
    pendingSelectionTemplateId = null
  }, SELECTION_THROTTLE_MS)
}

function captureBaseline(state: { pages: LayoutDocumentPage[]; globalVariableDefinitions: VariableDefinition[] }) {
  baseline = {
    pages: state.pages,
    globalVariableDefinitions: state.globalVariableDefinitions,
  }
}

function resetBaseline() {
  baseline = null
}

function emitOpsForChange(state: { pages: LayoutDocumentPage[]; globalVariableDefinitions: VariableDefinition[] }) {
  if (!baseline) {
    captureBaseline(state)
    return
  }
  const prev = baseline

  if (prev.pages !== state.pages) {
    emitPageDiffs(prev.pages, state.pages)
  }
  if (prev.globalVariableDefinitions !== state.globalVariableDefinitions) {
    if (!shallowVarDefsEqual(prev.globalVariableDefinitions, state.globalVariableDefinitions)) {
      sendOp({ type: 'setGlobalVariables', variables: state.globalVariableDefinitions })
    }
  }

  captureBaseline(state)
}

function emitPageDiffs(prev: LayoutDocumentPage[], next: LayoutDocumentPage[]) {
  const prevIds = prev.map((p) => p.id)
  const nextIds = next.map((p) => p.id)

  // Page-level structural changes first.
  if (!sameIdSet(prevIds, nextIds)) {
    // Removed pages — emit deletePage from highest index down.
    for (let i = prev.length - 1; i >= 0; i--) {
      if (!nextIds.includes(prev[i]!.id)) {
        sendOp({ type: 'deletePage', index: i })
      }
    }
    // Added pages — emit addPage at their new index.
    next.forEach((p, idx) => {
      if (!prevIds.includes(p.id)) {
        sendOp({ type: 'addPage', index: idx, page: p })
      }
    })
    // Fall through — we still need to diff elements on kept pages.
  } else if (!arraysEqual(prevIds, nextIds)) {
    // Same set, different order — single reorder op approximates the change.
    // Compute from/to from the first mismatched position.
    for (let i = 0; i < nextIds.length; i++) {
      if (nextIds[i] !== prevIds[i]) {
        const from = prevIds.indexOf(nextIds[i]!)
        sendOp({ type: 'reorderPages', from, to: i })
        break
      }
    }
  }

  // Per-page element + meta diffs. Match by id so surviving pages are diffed
  // regardless of index shifts caused by adds/removes.
  const prevById = new Map(prev.map((p) => [p.id, p]))
  next.forEach((page, pageIndex) => {
    const was = prevById.get(page.id)
    if (!was) return // newly added — already emitted addPage with full page

    if (was.elements !== page.elements) {
      emitElementDiffs(pageIndex, was.elements, page.elements)
    }

    if (!sameVarDefs(was.localVariables, page.localVariables)) {
      sendOp({ type: 'setPageVariables', pageIndex, variables: page.localVariables })
    }

    // Any page-level meta change except elements and localVariables.
    const pagePatch = computePagePatch(was, page)
    if (pagePatch) {
      sendOp({ type: 'updatePage', pageIndex, patch: pagePatch })
    }
  })
}

function emitElementDiffs(pageIndex: number, prev: LayoutElement[], next: LayoutElement[]) {
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const nextById = new Map(next.map((e) => [e.id, e]))

  // Deletions
  const removedIds: string[] = []
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) removedIds.push(id)
  }
  if (removedIds.length) {
    sendOp({ type: 'deleteElements', pageIndex, elementIds: removedIds })
  }

  // Additions + updates — walk in new order for correctness when both happen.
  const updates: Array<{ elementId: string; patch: Record<string, unknown> }> = []
  for (const el of next) {
    const was = prevById.get(el.id)
    if (!was) {
      sendOp({ type: 'addElement', pageIndex, element: el })
      continue
    }
    if (was === el) continue
    const patch = computeElementPatch(was, el)
    if (patch) updates.push({ elementId: el.id, patch })
  }
  if (updates.length === 1) {
    sendOp({
      type: 'updateElement',
      pageIndex,
      elementId: updates[0]!.elementId,
      patch: updates[0]!.patch,
    })
  } else if (updates.length > 1) {
    sendOp({ type: 'bulkUpdateElements', pageIndex, updates })
  }
}

// ── Patch computation ────────────────────────────────────────────────────────

/**
 * Shallow field-by-field diff. For every key that differs (by reference for
 * objects/arrays, by value for primitives) we include the NEW value in the
 * patch. Object values are sent wholesale — server-side `deepMerge` then
 * merges them field-by-field which is usually what we want for style patches,
 * and matches the backend's op-apply semantics.
 */
function computeElementPatch(a: LayoutElement, b: LayoutElement): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}
  // When Yjs is active it owns the rich-text `content` of every text-bearing
  // element; skipping the field here prevents double-writes racing the Yjs
  // relay and prevents redundant ops for every keystroke.
  const skipContent = isYDocActive(activeTemplateIdForDiff)
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (k === 'id') continue
    if (skipContent && k === 'content') continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const av = (a as any)[k]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bv = (b as any)[k]
    if (av === bv) continue
    patch[k] = bv === undefined ? null : bv
  }
  return Object.keys(patch).length ? patch : null
}

function computePagePatch(a: LayoutDocumentPage, b: LayoutDocumentPage): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}
  const skip = new Set(['id', 'elements', 'localVariables'])
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (skip.has(k)) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const av = (a as any)[k]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bv = (b as any)[k]
    if (av === bv) continue
    patch[k] = bv === undefined ? null : bv
  }
  return Object.keys(patch).length ? patch : null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function sameVarDefs(
  a: VariableDefinition[] | undefined,
  b: VariableDefinition[] | undefined
): boolean {
  if (a === b) return true
  const al = a?.length ?? 0
  const bl = b?.length ?? 0
  if (al !== bl) return false
  if (al === 0) return true
  return shallowVarDefsEqual(a!, b!)
}

function shallowVarDefsEqual(a: VariableDefinition[], b: VariableDefinition[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.key !== b[i]!.key || a[i]!.description !== b[i]!.description) return false
  }
  return true
}

// ── Wire-protocol → store-op mapping ─────────────────────────────────────────

function mapToStoreOp(op: CollabOp): CollabOpForStore | null {
  switch (op.type) {
    case 'addElement':
      return { type: 'addElement', pageIndex: op.pageIndex, element: op.element as LayoutElement }
    case 'deleteElements':
      return op
    case 'updateElement':
      return {
        type: 'updateElement',
        pageIndex: op.pageIndex,
        elementId: op.elementId,
        patch: op.patch as Partial<LayoutElement>,
      }
    case 'bulkUpdateElements':
      return {
        type: 'bulkUpdateElements',
        pageIndex: op.pageIndex,
        updates: op.updates.map((u) => ({
          elementId: u.elementId,
          patch: u.patch as Partial<LayoutElement>,
        })),
      }
    case 'addPage':
      return { type: 'addPage', index: op.index, page: op.page as LayoutDocumentPage }
    case 'deletePage':
      return op
    case 'reorderPages':
      return op
    case 'updatePage':
      return {
        type: 'updatePage',
        pageIndex: op.pageIndex,
        patch: op.patch as Partial<LayoutDocumentPage>,
      }
    case 'setGlobalVariables':
      return {
        type: 'setGlobalVariables',
        variables: op.variables as VariableDefinition[],
      }
    case 'setPageVariables':
      return {
        type: 'setPageVariables',
        pageIndex: op.pageIndex,
        variables: op.variables as VariableDefinition[] | undefined,
      }
    default:
      return null
  }
}
