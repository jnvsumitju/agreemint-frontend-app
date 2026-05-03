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
  PageSpec,
  VariableDefinition,
} from '../types/layout'
import { parseLayoutJson } from '../types/layout'
import { isEmitSuppressed, onRemoteOp, onSnapshot, sendOp, type CollabOp, type RemoteOpMessage } from './collabBus'
import { clearYFragmentsForElements, connectYDoc, disconnectYDoc } from './yDocProvider'
import { useAuthStore } from '../stores/authStore'
import { sendSelectionUpdate, sendViewportUpdate } from '../lib/websocket'

/**
 * Mount this hook once per editor instance. It binds store observers + collab
 * listeners for as long as the component is mounted. Idempotent — remounting is
 * safe; listeners are released on unmount.
 */
export function useCollab(templateId: string | null): void {
  useEffect(() => {
    if (!templateId) return

    const myUserId = useAuthStore.getState().user?.id ?? ''

    // Tracks whether we've applied the *initial* snapshot for this editor
    // session. Snapshots that arrive AFTER any local edit (e.g. a STOMP
    // reconnect fires `requestSnapshot()` again while the user has typed
    // unflushed content into a text element) would otherwise clobber the
    // in-progress edit because `loadLayout` is a wholesale pages-array
    // replacement — including any element whose content is newer locally
    // than on the server.
    //
    // Symptom this used to cause: user drops a TEXT, types into it, walks
    // away for several minutes. Laptop sleeps → WebSocket drops. On wake,
    // `@stomp/stompjs` auto-reconnects, `onConnect` re-runs
    // `requestSnapshot()`, server replies with its last-persisted layout
    // (possibly stale if the final `updateElement` op was dropped during the
    // disconnect, or if Redis TTL expired and Postgres is a flush cycle
    // behind). `loadLayout` then replaces `pages`, wiping the typed content.
    let hasAppliedInitialSnapshot = false

    // ── Receive ────────────────────────────────────────────────────────────────

    const offRemote = onRemoteOp((msg: RemoteOpMessage) => {
      // Skip echoes of our own op — we already applied locally when we sent it.
      if (msg.userId && msg.userId === myUserId) return
      // Reviewer/Viewer in committed-only mode: live ops don't apply. They're
      // pinned to the latest committed version until they flip the toolbar's
      // Live toggle. Designers/Admins always have canEdit=true so this gate
      // is a no-op for them.
      if (isFrozenForReviewer()) return
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
      // Reviewer/Viewer in committed-only mode: server snapshots represent
      // live (possibly uncommitted) state and would clobber the v1 they're
      // pinned to. Skip the hydrate; they'll get a fresh committed load if
      // they flip Live on.
      if (isFrozenForReviewer()) return
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

      // Reconnect snapshot: after the initial sync, a later snapshot is almost
      // always a re-sync after a drop. Replacing `pages` wholesale at that
      // point is destructive — any element the user edited since the last
      // server-ack would revert to the server's version. Instead merge
      // element-by-element, letting local mutations win when the store's
      // content is non-empty. New elements from the server (other users'
      // additions during our disconnect) are still picked up.
      //
      // After the merge we baseline against the REMOTE snapshot (not the
      // merged local state) and immediately emit a diff pass. That way
      // any local-only fields the merge preserved — page background,
      // localVariables, guides, page name, plus root-level pageSpec /
      // globalVariableDefinitions changes the user made offline — flush
      // to the server as fresh ops instead of being silently retained
      // only on this client.
      if (hasAppliedInitialSnapshot) {
        remoteOpInFlight = true
        try {
          mergeSnapshotPreservingLocalEdits(parsed)
        } finally {
          remoteOpInFlight = false
        }
        baseline = {
          pages: parsed.pages,
          globalVariableDefinitions: parsed.globalVariables,
          pageSpec: parsed.page,
        }
        emitOpsForChange(useEditorStore.getState())
        return
      }

      remoteOpInFlight = true
      try {
        // `loadLayout` is the canonical entry point — it normalises page spec,
        // rebuilds variableValues, clears editor UI state while preserving
        // view-only flags, and resets undo/redo history.
        useEditorStore.getState().loadLayout(parsed)
        hasAppliedInitialSnapshot = true
      } finally {
        remoteOpInFlight = false
        captureBaseline(useEditorStore.getState())
      }
    })

    // ── Send ───────────────────────────────────────────────────────────────────

    // Spin up the Y.Doc transport for this template so TipTap Collaboration
    // extensions attached via yDocProvider.getYFragment(...) start syncing.
    connectYDoc(templateId)

    // Capture the baseline at mount so the first diff is well-defined.
    captureBaseline(useEditorStore.getState())

    const unsubscribe = useEditorStore.subscribe((state) => {
      if (remoteOpInFlight || isEmitSuppressed()) {
        // Rebaseline silently — either (a) we just applied a remote op so
        // emitting would echo it back, or (b) a local action explicitly
        // sent a coupled op already (see {@code runWithEmitSuppressed} in
        // collabBus.ts) and the per-field deltas would race with the
        // coupled op on the wire.
        captureBaseline(state)
        return
      }
      emitOpsForChange(state)
      // Selection broadcast (throttled): fires when the local selectedIds
      // array changes and flushes at most every SELECTION_THROTTLE_MS.
      maybeEmitSelection(templateId, state.selectedIds)
      // Viewport broadcast: we emit the current page + zoom whenever those
      // change. Follow Mode on other clients applies the payload so they
      // jump pages when the leader switches.
      maybeEmitViewport(templateId, state.activePageIndex, state.canvasZoom)
    })

    return () => {
      offRemote()
      offSnapshot()
      unsubscribe()
      disconnectYDoc()
      resetBaseline()
      // Clear the pending selection broadcast so a re-mount starts fresh.
      if (pendingSelectionTimer != null) {
        window.clearTimeout(pendingSelectionTimer)
        pendingSelectionTimer = null
      }
      pendingSelection = null
      pendingSelectionTemplateId = null
      lastSelectionJson = null
      // Same for pending viewport broadcast.
      if (pendingViewportTimer != null) {
        window.clearTimeout(pendingViewportTimer)
        pendingViewportTimer = null
      }
      pendingViewport = null
      lastViewportKey = null
    }
  }, [templateId])
}

// ── Diff + emit ───────────────────────────────────────────────────────────────

interface Baseline {
  pages: LayoutDocumentPage[]
  globalVariableDefinitions: VariableDefinition[]
  pageSpec: PageSpec
}

let remoteOpInFlight = false
let baseline: Baseline | null = null

/**
 * Reviewer/Viewer in committed-only mode: collab updates (remote ops AND
 * snapshot replies) must be ignored so the locally-loaded committed
 * version stays frozen. Designers/Admins always have canEdit=true and
 * therefore aren't frozen regardless of liveMode.
 */
function isFrozenForReviewer(): boolean {
  const s = useEditorStore.getState()
  return !s.canEdit && !s.liveMode
}

/**
 * Reconcile a server snapshot against the current local store WITHOUT
 * clobbering local-only edits. For every element on every page:
 *
 *   • If the element exists locally, keep the local copy — the structural
 *     diff observer has either already emitted the local changes to the
 *     server (normal path) or will do so when the STOMP client reconnects.
 *     Either way, the local version is at least as fresh as whatever the
 *     server returned in this snapshot.
 *   • If the element only exists on the server (another user added it during
 *     our disconnect), pull it in.
 *   • Locally-only elements that the server doesn't know about yet stay put
 *     — their `addElement` op is still buffered and will fire on reconnect.
 *
 * Pages themselves are merged the same way (kept ids keep their local
 * elements / metadata; new server-only pages are appended).
 *
 * This is intentionally conservative: on a reconnect snapshot, prefer LOCAL
 * for anything we already know about. We can revisit if multi-user concurrent
 * editing surfaces conflicts that this misses — in practice the Yjs channel
 * is the real merge point for rich-text, and structural conflicts on the
 * same element are vanishingly rare.
 */
function mergeSnapshotPreservingLocalEdits(parsed: {
  pages: LayoutDocumentPage[]
}): void {
  const s = useEditorStore.getState()
  const localPages = s.pages
  const localById = new Map<string, LayoutDocumentPage>()
  for (const p of localPages) localById.set(p.id, p)

  const mergedPages: LayoutDocumentPage[] = []
  const handledLocalIds = new Set<string>()
  for (const remote of parsed.pages) {
    const local = localById.get(remote.id)
    if (!local) {
      // New page on the server — take it as-is.
      mergedPages.push(remote)
      continue
    }
    // Same page id on both sides — keep local elements + local metadata.
    // Two adjustments vs. the naive "prefer local":
    //   1. Any element on the server that isn't local yet (e.g. another user
    //      added it during our disconnect) is APPENDED.
    //   2. For elements present on both sides: if LOCAL is missing the
    //      `content` field (which means content got stripped somewhere) but
    //      the REMOTE copy still has real content, adopt the remote content.
    //      This is the recovery path for a pre-existing stripped layout —
    //      the send-side defense in computeElementPatch will then keep the
    //      recovered content from being lost again.
    const remoteById = new Map(remote.elements.map((e) => [e.id, e]))
    const mergedElements = local.elements.map((localEl) => {
      const remoteEl = remoteById.get(localEl.id)
      if (!remoteEl) return localEl
      const localContent = typeof localEl.content === 'string' ? localEl.content : ''
      const remoteContent = typeof remoteEl.content === 'string' ? remoteEl.content : ''
      if (isMissingTextContent(localContent) && !isMissingTextContent(remoteContent)) {
        return { ...localEl, content: remoteContent }
      }
      return localEl
    })
    const localElementIds = new Set(local.elements.map((e) => e.id))
    const addedFromRemote = remote.elements.filter((e) => !localElementIds.has(e.id))
    mergedPages.push({
      ...local,
      elements: addedFromRemote.length === 0
        ? mergedElements
        : [...mergedElements, ...addedFromRemote],
    })
    handledLocalIds.add(remote.id)
  }
  // Any local-only pages (e.g. a page we added while disconnected) stay at
  // the end in their original local order. Their `addPage` op will fire on
  // reconnect via the structural diff observer.
  for (const leftover of localPages) {
    if (!handledLocalIds.has(leftover.id)) mergedPages.push(leftover)
  }

  useEditorStore.setState({ pages: mergedPages })
}

/** A content string counts as "missing" when it's empty, whitespace, or a rich doc with no runs. */
function isMissingTextContent(content: string): boolean {
  if (!content || !content.trim()) return true
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const parsed = JSON.parse(trimmed) as { rich?: boolean; runs?: unknown[] }
    if (parsed && parsed.rich === true && Array.isArray(parsed.runs)) {
      if (parsed.runs.length === 0) return true
      return parsed.runs.every((r) => {
        if (!r || typeof r !== 'object') return false
        const run = r as { type?: string; text?: string; name?: string }
        if (run.type === 'var') return false
        return !run.text || !run.text.trim()
      })
    }
  } catch {
    /* not JSON — treat as plain content, non-empty above already covered */
  }
  return false
}

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

// ── Viewport broadcast (for Follow Mode) ──────────────────────────────────────
// Emits when activePageIndex or canvasZoom changes. Scroll position is read
// from the canvas scroll container each time we flush, so scroll-only motion
// does not spam the channel — only a page switch or zoom change triggers a send.
const VIEWPORT_THROTTLE_MS = 80
let lastViewportKey: string | null = null
let pendingViewportTimer: number | null = null
let pendingViewport: { templateId: string; activePageIndex: number; zoom: number } | null = null

function maybeEmitViewport(templateId: string, activePageIndex: number, zoom: number) {
  const key = `${activePageIndex}|${zoom}`
  if (key === lastViewportKey) return
  pendingViewport = { templateId, activePageIndex, zoom }
  if (pendingViewportTimer != null) return
  pendingViewportTimer = window.setTimeout(() => {
    pendingViewportTimer = null
    if (!pendingViewport) return
    lastViewportKey = `${pendingViewport.activePageIndex}|${pendingViewport.zoom}`
    const scroller = document.querySelector<HTMLElement>('[data-agreemint-scroll-container]')
    const scrollX = scroller?.scrollLeft ?? 0
    const scrollY = scroller?.scrollTop ?? 0
    sendViewportUpdate(
      pendingViewport.templateId,
      pendingViewport.zoom,
      scrollX,
      scrollY,
      pendingViewport.activePageIndex,
    )
    pendingViewport = null
  }, VIEWPORT_THROTTLE_MS)
}

function captureBaseline(state: {
  pages: LayoutDocumentPage[]
  globalVariableDefinitions: VariableDefinition[]
  pageSpec: PageSpec
}) {
  baseline = {
    pages: state.pages,
    globalVariableDefinitions: state.globalVariableDefinitions,
    pageSpec: state.pageSpec,
  }
}

function resetBaseline() {
  baseline = null
}

function emitOpsForChange(state: {
  pages: LayoutDocumentPage[]
  globalVariableDefinitions: VariableDefinition[]
  pageSpec: PageSpec
}) {
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
  // Template-wide page spec (size / margins / orientation) is a root-level field
  // on the store (s.pageSpec), not inside any page object, so the pages-diff
  // path above doesn't see it. Compare separately and emit setPageSpec when it
  // changes.
  if (prev.pageSpec !== state.pageSpec) {
    if (!pageSpecEqual(prev.pageSpec, state.pageSpec)) {
      sendOp({ type: 'setPageSpec', pageSpec: state.pageSpec })
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
        // Cascade: clear Yjs fragments for every element on the page that
        // just disappeared. emitElementDiffs only fires for surviving
        // pages (matched by id below), so without this the deleted page's
        // elements would never trigger their fragment cleanup.
        const removedPage = prev[i]!
        const ids = collectAllElementIds(removedPage.elements)
        if (ids.length) clearYFragmentsForElements(ids)
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

/**
 * Walk an element tree (top-level + band-nested HEADER/FOOTER children)
 * and return every element id. Used by the page-delete path so we can
 * cascade Yjs fragment cleanup to every element that just disappeared.
 */
function collectAllElementIds(elements: LayoutElement[]): string[] {
  const out: string[] = []
  const walk = (els: LayoutElement[]) => {
    for (const el of els) {
      out.push(el.id)
      if (el.bandElements && el.bandElements.length > 0) {
        walk(el.bandElements)
      }
    }
  }
  walk(elements)
  return out
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
    // Empty the Yjs fragment that backs each deleted element's rich text.
    // Without this a peer still mid-edit on the element would keep typing
    // into an orphan fragment, and the doc would slowly accumulate dead
    // content. The Yjs delete propagates as its own update — peers don't
    // need to do anything on receive.
    clearYFragmentsForElements(removedIds)
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
  // Note on `content`: Yjs provides character-level CRDT merging for rich-text
  // edits when both users are actively editing the same element in TipTap, but
  // only the active editor has TipTap mounted against the Y.XmlFragment. A
  // passive viewer renders the element via ElementPreview, which reads
  // `el.content` from the store. So we must also emit `content` as a structural
  // op on every keystroke — otherwise typing on A never reaches B's canvas.
  //
  // When both users are editing the same element, the Yjs path still merges
  // inserts; the structural op just keeps the final serialized string in the
  // store for non-editor views and persistence.
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (k === 'id') continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const av = (a as any)[k]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bv = (b as any)[k]
    if (av === bv) continue
    // ── CONTENT DELETION SAFETY NET ──────────────────────────────────────
    // If a TEXT/HEADER/FOOTER element's `content` field disappears from the
    // local copy (typically because some layer in the pipeline spread the
    // element without the field, or a stale snapshot applied an element
    // record with no content key), DO NOT emit `{content: null}`. The
    // server's `deepMerge` treats a null value as "delete this key", which
    // would wipe the real content from Redis / Postgres, fan-out the loss
    // to every connected client, and — on reopen — load the now-empty
    // layout over any local recovery. Instead, treat the transition from
    // "has content" → "missing content" as a NOOP for the content key. A
    // genuine clear-content operation always writes a non-empty rich
    // document (e.g. `{"rich":true,"runs":[]}`) that still reaches the
    // server through the regular path.
    if (k === 'content' && (bv === undefined || bv === null || bv === '') && av != null && av !== '') {
      continue
    }
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

function pageSpecEqual(a: PageSpec, b: PageSpec): boolean {
  // Cheap structural compare. PageSpec is small — stringify works fine here.
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return a === b
  }
}

// ── Wire-protocol → store-op mapping ─────────────────────────────────────────

/**
 * Strip any `content: null | undefined | ''` entry from an inbound update
 * patch. A null content on the wire means "delete this key" — we never emit
 * that intentionally, so an inbound one is always a symptom of the
 * content-deletion bug (see {@link computeElementPatch}) coming back at us
 * from another client / a stale broadcast / a server op replay. Swallowing
 * it here stops the bug from propagating to this client's store and keeps
 * whatever content is currently local.
 */
function sanitizeRemoteElementPatch(patch: Record<string, unknown>): Record<string, unknown> {
  if (!('content' in patch)) return patch
  const v = patch.content
  if (v === null || v === undefined || v === '') {
    const { content: _dropped, ...rest } = patch
    return rest
  }
  return patch
}

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
        patch: sanitizeRemoteElementPatch(op.patch) as Partial<LayoutElement>,
      }
    case 'bulkUpdateElements':
      return {
        type: 'bulkUpdateElements',
        pageIndex: op.pageIndex,
        updates: op.updates.map((u) => ({
          elementId: u.elementId,
          patch: sanitizeRemoteElementPatch(u.patch) as Partial<LayoutElement>,
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
    case 'setPageSpec':
      return { type: 'setPageSpec', pageSpec: op.pageSpec as PageSpec }
    default:
      return null
  }
}
