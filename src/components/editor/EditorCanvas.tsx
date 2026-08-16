import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { useDrop } from 'react-dnd'
import {
  bandViewportDims,
  createDefaultElement,
  registerActiveCanvasTipTapEditor,
  selectActivePageElements,
  unregisterActiveCanvasTipTapEditor,
  useEditorStore,
} from '../../stores/editorStore'
import { useAuthStore } from '../../stores/authStore'
import { usePresenceStore } from '../../stores/presenceStore'
import { getYFragment } from '../../collab/yDocProvider'
import { computeDragSnap, computeResizeSnap } from '../../lib/canvasGuides'
import { coerceToSupportedFamily } from '../../lib/fontLoader'
import { useLayoutMeasurement } from '../../lib/useLayoutMeasurement'
import { MeasurementProvider, useElementMeasurement } from './MeasurementContext'
import { RichTextAbsoluteLines } from './RichTextAbsoluteLines'
import { buildLayoutJson } from '../../types/layout'
import { CANVAS_ZOOM_MAX, CANVAS_ZOOM_MIN } from '../../lib/editorConstants'
import { isMarginExemptType } from '../../lib/layoutMargins'
import {
  findElementByIdInDocument,
  mergeDocumentBandsIntoPageElements,
  mergeFloatingRepeatsIntoPage,
} from '../../lib/documentPageMerge'
import { findBandNestedChild, findElementByIdInDocumentDeep } from '../../lib/bandNestedLayout'
import { editorDiagLogOnce } from '../../lib/editorDiagnostics'
import {
  coerceLayoutScalar,
  isRichTextElement,
  pageDimensionsPt,
  snap,
  type PageGuides,
} from '../../types/layout'
import type { LayoutElement } from '../../types/layout'
import { DND_COMPONENT, DND_NEW, type LayoutComponentDragItem, type NewElementDragItem } from './dndTypes'
import { preferStoreRichContentIfEditorEmpty, serializeRunsToContent } from '../../lib/richContent'
import { pmDocToRuns } from '../../lib/tipTapRichBridge'
import {
  availableVariableMentionsForMentionSuggest,
  resolveVariableChipInfo,
  variableMergeFieldSurfaceLabel,
} from '../../lib/layoutBehaviourResolve'
import { TipTapRichEditor } from './TipTapRichEditor'
import { richTextDebugLog } from '../../lib/richTextDebugLog'
import { RichTextBlockPreview } from './RichTextBlockPreview'
import { RemoteSelectionBadge } from './RemoteSelectionBadge'
import { TableSelectHandle } from './TableSelectHandle'
import { TableElementCanvas, type LayoutTableElement } from './TableElementCanvas'
import { ListElementCanvas } from './ListElementCanvas'
import { AddImageModal } from './AddImageModal'
import {
  canDivideSelection,
  isMergeableShapeType,
  shapePolygonToSvgPathD,
} from '../../lib/shapeGeometry'
import { bezierPathToSvgPathD } from '../../lib/bezierGeometry'
import { PathEditOverlay } from './PathEditOverlay'
import {
  resolveLayoutElement,
  variableValuesToDataTree,
} from '../../lib/layoutBehaviourResolve'
import type { Editor as TipTapEditor } from '@tiptap/core'
import { copyElementsToClipboard, pasteElementsFromClipboard } from '../../lib/clipboard'
import { reflowText as reflowTextApi } from '../../lib/api'
import { gradientToCss, isValidGradient, svgGradientId, svgLinearGradientProps } from '../../lib/gradientUtils'
import { polygonPointsToSvgString, resolvePolygonPoints } from '../../lib/polygonGeometry'
import type { GradientDef, PageBackground } from '../../types/layout'

/** Must hold pointer down this long before a move can start a drag (avoids drag stealing double-click). */
const DRAG_HOLD_MS = 200
/** Minimum movement after hold before drag starts. */
const DRAG_THRESHOLD_PX = 10

const EMPTY_PAGE_GUIDES: PageGuides = { vertical: [], horizontal: [] }

/** Screen px: guide drag must exceed this before a move is committed (undo batch). */
const GUIDE_DRAG_THRESHOLD_PX = 5

function clientInElement(clientX: number, clientY: number, el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const r = el.getBoundingClientRect()
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const t = el.tagName
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true
  if (el.isContentEditable) return true
  if (el.closest('[contenteditable="true"]')) return true
  if (el.closest('.ProseMirror')) return true
  if (el.closest('[data-agreemint-tiptap-root]')) return true
  return false
}

/** @-variable Tippy, color popovers, etc. mount on body — must not trigger canvas inline commit. */
function isPortaledRichTextUiTarget(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!el) return false
  return Boolean(
    el.closest('.tippy-box') ||
      el.closest('[data-tippy-root]') ||
      el.closest('[data-agreemint-skip-canvas-inline-commit]')
  )
}

/** Top bar context strip + TipTap format row — must not commit/destroy inline edit on pointerdown (capture). */
function isCanvasInlineCommitExemptTarget(node: Node, exemptRoot: HTMLElement | null | undefined): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!el) return false
  if (exemptRoot?.contains(el)) return true
  return Boolean(
    el.closest('[data-agreemint-context-toolbar]') || el.closest('[data-agreemint-rich-format-toolbar]')
  )
}

function isSpaceKey(e: KeyboardEvent) {
  return e.code === 'Space' || e.key === ' '
}

/**
 * Translate a {@link PageBackground} into inline-style props for the page
 * canvas div. Gradients use {@code backgroundImage}; the solid colour goes
 * to {@code backgroundColor} as a fallback (so transparent gradients still
 * paint over the right base).
 */
function buildPageBackgroundStyle(bg: PageBackground): React.CSSProperties {
  const out: React.CSSProperties = {}
  if (bg.color) out.backgroundColor = bg.color
  if (bg.gradient && isValidGradient(bg.gradient)) {
    out.backgroundImage = gradientToCss(bg.gradient)
  }
  return out
}

function CanvasElement({
  el,
  exemptFromInlineCommitRef,
  onElementContextMenu,
  onCommentClick,
}: {
  el: LayoutElement
  exemptFromInlineCommitRef: RefObject<HTMLElement | null>
  onElementContextMenu?: (e: ReactMouseEvent, elId: string) => void
  onCommentClick?: (elId: string) => void
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const inlineEditorRef = useRef<HTMLDivElement>(null)
  /** Survives brief store/zustand timing gaps vs TipTap destroy order. */
  const inlineTipTapLocalRef = useRef<TipTapEditor | null>(null)
  /**
   * True when the user pasted into the inline editor at least once during
   * the current edit session. Reset on every fresh edit. On commit, when
   * set, the canvas schedules a backend-driven reflow so the eventual PDF's
   * split point is what the editor preview shows.
   */
  const pasteSeenInEditRef = useRef(false)
  const select = useEditorStore((s) => s.select)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const updateElement = useEditorStore((s) => s.updateElement)
  const variableValues = useEditorStore((s) => s.variableValues)
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const globalVariableDefinitions = useEditorStore((s) => s.globalVariableDefinitions)
  const canvasInlineEditId = useEditorStore((s) => s.canvasInlineEditId)
  const bandCanvasEditElementId = useEditorStore((s) => s.bandCanvasEditElementId)
  const enterBandCanvasEdit = useEditorStore((s) => s.enterBandCanvasEdit)
  const setCanvasInlineEdit = useEditorStore((s) => s.setCanvasInlineEdit)
  const reflowLinkedText = useEditorStore((s) => s.reflowLinkedText)
  const setInlineTipTapEditor = useEditorStore((s) => s.setInlineTipTapEditor)
  const spaceMoveTool = useEditorStore((s) => s.spaceMoveTool)
  const canvasTool = useEditorStore((s) => s.canvasTool)
  const viewOnly = useEditorStore((s) => s.viewOnly)
  const commentingEnabled = useEditorStore((s) => s.commentingEnabled)
  const showEditorHints = useEditorStore((s) => s.showEditorHints)
  const commentHighlightId = useEditorStore((s) => s.commentHighlightId)
  const isCommentHighlighted = commentHighlightId === el.id
  // TABLE-specific cell state — used to distinguish "whole table selected"
  // from "a cell inside the table is active". The visual selection style
  // differs: whole-table selection draws a purple ring + light tint,
  // while cell-level activity hands off the ring to the cell itself.
  const tableSelection = useEditorStore((s) => s.tableSelection)
  const tableCellEdit = useEditorStore((s) => s.tableCellEdit)
  const templateId = useEditorStore((s) => s.templateId)
  const authUserId = useAuthStore((s) => s.user?.id ?? null)
  // Remote selections: the first presence user (other than me) whose selection
  // contains this element's id — render a colored outline in their colour.
  const remoteSelector = usePresenceStore((s) => {
    for (const u of s.users) {
      if (authUserId && u.userId === authUserId) continue
      const sel = s.selections[u.userId]
      if (sel && sel.includes(el.id)) return u
    }
    return null
  })

  const variableMentions = useMemo(
    () =>
      availableVariableMentionsForMentionSuggest(
        globalVariableDefinitions,
        pages,
        activePageIndex,
        variableValues
      ),
    [globalVariableDefinitions, pages, activePageIndex, variableValues]
  )

  const resolveVariableChipDetail = useCallback(
    (name: string) =>
      resolveVariableChipInfo(
        name,
        globalVariableDefinitions,
        pages[activePageIndex],
        variableValues
      ),
    [globalVariableDefinitions, pages, activePageIndex, variableValues]
  )

  const resolveVariableSurfaceLabel = useCallback(
    (name: string) =>
      variableMergeFieldSurfaceLabel(name, globalVariableDefinitions, pages[activePageIndex]),
    [globalVariableDefinitions, pages, activePageIndex]
  )

  /** Raw layout content from the store — not `resolveLayoutElement` output (ellipsis etc. can differ). */
  const storeRichTextContent = useEditorStore((s) => findElementByIdInDocumentDeep(s.pages, el.id)?.content)

  const selected = selectedIds.includes(el.id)
  const soleSelected = selectedIds.length === 1 && selectedIds[0] === el.id
  /**
   * True when this TABLE has an active cell selection or a cell in edit
   * mode — in that case the violet outer-wrapper ring would collide with
   * the cell's own selection ring, so we suppress it and let the inner
   * cell chrome tell the story. If the TABLE is selected at the element
   * level with NO cell activity (user just clicked the new table-select
   * handle, or the whole table is picked from the Layers panel), we
   * still render the outer ring so the user sees that the table as a
   * whole is the selection target.
   */
  const tableCellActive =
    el.type === 'TABLE' &&
    !el.locked &&
    (tableSelection?.tableId === el.id || tableCellEdit?.tableId === el.id)
  const hideTableOuterSelectionRing = tableCellActive
  /** TABLE selected at the element level (not a cell) → add a subtle violet tint. */
  const tableElementLevelSelected =
    el.type === 'TABLE' && selected && !el.locked && !tableCellActive
  const bandNested = useMemo(() => findBandNestedChild(pages, el.id), [pages, el.id])

  const persistCanvasTextContent = useCallback(
    (serialized: string) => {
      const nested = findBandNestedChild(useEditorStore.getState().pages, el.id)
      richTextDebugLog('persist', 'persistCanvasTextContent', {
        elId: el.id,
        inBand: nested != null,
        bandContainerId: nested?.container.id,
        len: serialized.length,
        preview: serialized.slice(0, 100),
      })
      useEditorStore.getState().updateElement(el.id, { content: serialized }, { skipHistory: true })
    },
    [el.id]
  )
  const isInlineEditing =
    canvasInlineEditId === el.id &&
    bandCanvasEditElementId !== el.id &&
    (!bandNested || bandCanvasEditElementId === bandNested.container.id)
  const canInlineEdit = isRichTextElement(el) || el.type === 'LIST'
  const isLinkedFrame = el.type === 'TEXT' && !!(el.linkedNextId || el.linkedPrevId)

  const dragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    originX: number
    originY: number
    dragging: boolean
    startAt: number
  } | null>(null)
  const windowDragCleanupRef = useRef<(() => void) | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  /** True while drag/resize would place a non–header/footer box outside print margins (red ring). */
  const [marginClampHighlight, setMarginClampHighlight] = useState(false)

  useEffect(
    () => () => {
      windowDragCleanupRef.current?.()
      windowDragCleanupRef.current = null
    },
    []
  )
  const contentSnapshotRef = useRef<string | undefined>(undefined)
  const inlineUndoRef = useRef<{ content: string; height: number } | null>(null)
  const inlineOpenedRef = useRef(false)
  const commitGuardRef = useRef(false)

  /**
   * Ask the backend to recompute the linked-frame split for `headId`'s chain
   * using iText measurement, then apply the response to the chain. The
   * frontend has already done a local reflow at this point — this overwrites
   * it with the authoritative result. Errors are swallowed (we keep the FE
   * approximation rather than reverting to single-frame state).
   */
  const scheduleBackendReflow = useCallback(async (headId: string) => {
    try {
      const st = useEditorStore.getState()
      // Anonymous sandbox: no session, so this would 401 on every inline text
      // commit. Read from state rather than closing over a selector — the
      // callback already has the store here, and adding a dep would rebuild it.
      // The local reflow has already run, so the chain is still split, just by
      // the frontend's approximation rather than iText's answer.
      if (st.sandbox) return
      // The element id passed in might be mid-chain after the FE reflow ran;
      // walk back to the actual head before sending.
      let actualHeadId = headId
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let found: LayoutElement | undefined
        for (const page of st.pages) {
          found = page.elements.find((e) => e.id === actualHeadId)
          if (found) break
        }
        if (!found?.linkedPrevId) break
        actualHeadId = found.linkedPrevId
      }
      let headEl: LayoutElement | undefined
      for (const page of st.pages) {
        headEl = page.elements.find((e) => e.id === actualHeadId)
        if (headEl) break
      }
      if (!headEl || headEl.type !== 'TEXT') return

      // Build the request payload mirroring elementToJson — the backend reads
      // `content`, `style`, `width`, `y`, `type`. Send the rich content as a
      // string so the backend's existing rich-runs parser handles it.
      const headPayload: Record<string, unknown> = {
        id: headEl.id,
        type: 'TEXT',
        x: headEl.x,
        y: headEl.y,
        width: headEl.width,
        height: headEl.height,
        content: headEl.content ?? '',
      }
      if (headEl.style) headPayload.style = headEl.style
      const pagePayload: Record<string, unknown> = {
        size: st.pageSpec.size,
      }
      if (st.pageSpec.margins) pagePayload.margins = st.pageSpec.margins
      if (st.pageSpec.margin != null) pagePayload.margin = st.pageSpec.margin
      if (st.pageSpec.orientation) pagePayload.orientation = st.pageSpec.orientation

      const resp = await reflowTextApi(headPayload, pagePayload)
      if (!resp || !Array.isArray(resp.frames) || resp.frames.length === 0) return
      const frames = resp.frames.map((f) => ({ content: f.content, measuredHeight: f.measuredHeight }))
      reflowLinkedText(actualHeadId, frames)
    } catch {
      // Backend offline / network blip / 5xx: keep the FE approximation.
    }
  }, [reflowLinkedText])

  const commitInlineEdit = useCallback(() => {
    if (commitGuardRef.current) return
    const st0 = useEditorStore.getState()
    const cur = findElementByIdInDocumentDeep(st0.pages, el.id)
    const nested = findBandNestedChild(st0.pages, el.id)
    const bottomMargin = st0.pageSpec.margins?.bottom ?? 40
    const ed =
      inlineTipTapLocalRef.current ?? useEditorStore.getState().inlineTipTapEditor
    if (!ed) {
      if (!cur) return
      commitGuardRef.current = true
      const outer = outerRef.current
      let height: number | undefined
      if (outer && cur) {
        const phPage = pageDimensionsPt(st0.pageSpec).height
        const phCap = nested ? bandViewportDims(st0, nested.container).h : phPage - bottomMargin
        const nh = Math.max(16, Math.min(phCap - cur.y, Math.ceil(outer.getBoundingClientRect().height)))
        if (Math.abs(nh - cur.height) > 0.5) height = nh
      }
      const content = cur.content ?? ''
      updateElement(el.id, height !== undefined ? { content, height } : { content })
      setCanvasInlineEdit(null)
      queueMicrotask(() => {
        commitGuardRef.current = false
        // Trigger linked text reflow for TEXT elements after commit
        if (el.type === 'TEXT' && !nested) {
          reflowLinkedText(el.id)
        }
      })
      return
    }
    commitGuardRef.current = true
    const fromEditor = ed.isDestroyed ? '' : serializeRunsToContent(pmDocToRuns(ed.state.doc))
    const content = preferStoreRichContentIfEditorEmpty(fromEditor, cur?.content)
    const outer = outerRef.current
    let height: number | undefined
    if (outer && cur) {
      const phPage = pageDimensionsPt(st0.pageSpec).height
      const phCap = nested ? bandViewportDims(st0, nested.container).h : phPage - bottomMargin
      const nh = Math.max(16, Math.min(phCap - cur.y, Math.ceil(outer.getBoundingClientRect().height)))
      if (Math.abs(nh - cur.height) > 0.5) height = nh
    }
    // Detect any actual content change so we know whether to ask the backend
    // to re-split. A no-op edit (open + close without typing) shouldn't burn
    // a network round-trip.
    const contentChanged = (cur?.content ?? '') !== content
    updateElement(el.id, height !== undefined ? { content, height } : { content })
    setCanvasInlineEdit(null)
    pasteSeenInEditRef.current = false
    queueMicrotask(() => {
      commitGuardRef.current = false
      // Trigger linked text reflow for TEXT elements after commit
      if (el.type === 'TEXT' && !nested) {
        reflowLinkedText(el.id)
        // Ask the backend (iText) for the authoritative split whenever the
        // content actually changed — paste, type, delete, all of them. The
        // local reflow above is an instant approximation; the BE response
        // may pick a slightly different paragraph boundary so the editor
        // matches what the eventual PDF will render. Failures are silent —
        // the FE result stays and the editor remains usable.
        if (contentChanged) {
          void scheduleBackendReflow(el.id)
        }
      }
    })
  }, [el.id, el.type, updateElement, setCanvasInlineEdit, reflowLinkedText, scheduleBackendReflow])

  const escapeInlineEdit = useCallback(() => {
    const u = inlineUndoRef.current
    if (u) {
      updateElement(el.id, { content: u.content, height: u.height })
    } else if (contentSnapshotRef.current !== undefined) {
      updateElement(el.id, { content: contentSnapshotRef.current })
    }
    commitGuardRef.current = true
    setCanvasInlineEdit(null)
    queueMicrotask(() => {
      commitGuardRef.current = false
      // Reflow chain after Escape restore too (content changed back)
      if (el.type === 'TEXT') {
        reflowLinkedText(el.id)
      }
    })
  }, [el.id, el.type, updateElement, setCanvasInlineEdit, reflowLinkedText])

  useLayoutEffect(() => {
    if (!isInlineEditing) {
      inlineOpenedRef.current = false
      return
    }
    if (!inlineOpenedRef.current) {
      inlineOpenedRef.current = true
      inlineUndoRef.current = { content: el.content ?? '', height: el.height }
      contentSnapshotRef.current = el.content
      // Fresh edit session — reset the paste flag. A paste from a previous
      // edit shouldn't kick off a backend reflow on this commit.
      pasteSeenInEditRef.current = false
    }
  }, [isInlineEditing, el.id, el.content, el.height])

  // True while the inline-editing box is rendering taller than the available
  // height between its top edge and the page's bottom margin. The box is
  // allowed to grow visually past that point ({@link growWithText} sets
  // `height: auto`), but the stored height is clamped — so without a
  // signal the author can keep typing/pasting and never realise their
  // bottom paragraphs are overflowing the printable area.
  const [editOverflowing, setEditOverflowing] = useState(false)

  /** Grow frame with text (PDF-style); keep stored height in sync for save / layout. */
  useLayoutEffect(() => {
    if (!isInlineEditing || !canInlineEdit) return
    // Linked frames keep their reflow-assigned height — skip auto-grow
    if (isLinkedFrame) {
      setEditOverflowing(false)
      return
    }
    const root = outerRef.current
    if (!root) return
    let raf = 0
    const syncHeight = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // Browser bounding rect ≈ iText's ascender+descender region. iText
        // adds a small tail of trailing leading below the last baseline
        // (~fontSize × 0.2 for most Latin fonts) that shows up as the
        // bottom row of descenders clipping in the generated PDF when the
        // canvas and element height agree exactly. Pad the stored height
        // by one descender-row so the PDF has room to render the tail.
        const fontSize = typeof el.style?.fontSize === 'number' ? el.style.fontSize : 12
        const descenderPad = Math.max(2, fontSize * 0.2)
        const h = Math.ceil(root.getBoundingClientRect().height + descenderPad)
        const st = useEditorStore.getState()
        const cur = findElementByIdInDocumentDeep(st.pages, el.id)
        if (!cur) return
        const n = findBandNestedChild(st.pages, el.id)
        const phPage = pageDimensionsPt(st.pageSpec).height
        const bottomMargin = st.pageSpec.margins?.bottom ?? 40
        const maxH = (n ? bandViewportDims(st, n.container).h : phPage - bottomMargin) - cur.y
        const next = Math.max(16, Math.min(maxH, h))
        if (Math.abs(next - cur.height) > 0.5) {
          st.updateElement(el.id, { height: next }, { skipHistory: true })
        }
        // Overflow signal: rendered DOM height exceeds the available room.
        // Small tolerance so the indicator doesn't flicker right at the
        // boundary while typing inserts a single extra descender row.
        setEditOverflowing(h > maxH + 1)
      })
    }
    const ro = new ResizeObserver(syncHeight)
    ro.observe(root)
    syncHeight()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [isInlineEditing, canInlineEdit, isLinkedFrame, el.id])

  // Reset the overflow flag when leaving edit so a stale "true" doesn't
  // linger after the author commits and the frame snaps back to its clamped
  // height.
  useEffect(() => {
    if (!isInlineEditing) setEditOverflowing(false)
  }, [isInlineEditing])

  // View-mode auto-grow — fires whenever the backend measurement disagrees
  // with the authored height. Runs OUTSIDE inline edit so that content
  // changes from variable resolution, remote collab ops, or rule-driven
  // mutations reflow the box without the author re-entering edit mode.
  // Gated on TEXT-like + non-linked + non-edit so we don't race the
  // inline ResizeObserver above (that one drives growth from DOM bbox;
  // this one drives growth from iText's ground truth).
  const measuredForGrow = useElementMeasurement(el.id)
  const lastAppliedMeasuredHeightRef = useRef<number | null>(null)
  useEffect(() => {
    if (isInlineEditing || isLinkedFrame) return
    if (el.type !== 'TEXT' && el.type !== 'HEADER' && el.type !== 'FOOTER') return
    const m = measuredForGrow?.measuredHeight
    if (!m || m <= 0) return
    // Skip if this measurement value was already applied — the measurement
    // endpoint can return the same `measuredHeight` on every tick while
    // the author is doing unrelated work. Each run of this effect would
    // otherwise trigger a re-render.
    if (lastAppliedMeasuredHeightRef.current === m) return
    // Only grow, never shrink — if the author intentionally sized the box
    // taller than the content, we don't want to collapse it just because
    // the measurement fits.
    if (m > el.height + 0.5) {
      const st = useEditorStore.getState()
      const n = findBandNestedChild(st.pages, el.id)
      const phPage = pageDimensionsPt(st.pageSpec).height
      const bottomMargin = st.pageSpec.margins?.bottom ?? 40
      const maxH = (n ? bandViewportDims(st, n.container).h : phPage - bottomMargin) - el.y
      const next = Math.max(16, Math.min(maxH, Math.ceil(m)))
      if (Math.abs(next - el.height) > 0.5) {
        st.updateElement(el.id, { height: next }, { skipHistory: true })
      }
    }
    lastAppliedMeasuredHeightRef.current = m
  }, [isInlineEditing, isLinkedFrame, el.type, el.id, el.height, el.y, measuredForGrow?.measuredHeight])

  useEffect(() => {
    if (!isInlineEditing) return
    const onOutsidePointerOrMouse = (ev: Event) => {
      const t = ev.target
      if (!(t instanceof Node)) return
      if (isPortaledRichTextUiTarget(t)) return
      if (isCanvasInlineCommitExemptTarget(t, exemptFromInlineCommitRef.current)) return
      const editor = inlineEditorRef.current
      if (editor?.contains(t)) return
      commitInlineEdit()
    }
    document.addEventListener('pointerdown', onOutsidePointerOrMouse, true)
    document.addEventListener('mousedown', onOutsidePointerOrMouse, true)
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointerOrMouse, true)
      document.removeEventListener('mousedown', onOutsidePointerOrMouse, true)
    }
  }, [isInlineEditing, commitInlineEdit, exemptFromInlineCommitRef])

  const locked = !!el.locked

  /** Capture phase so drag starts even when inner TABLE cells call stopPropagation on bubble. */
  const onPointerDownCapture = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement
    let bandMoveFromInlineChrome = false
    if (isInlineEditing) {
      if (t.closest('[data-resize-handle]')) return
      if (
        t.closest('.ProseMirror') ||
        t.closest('[contenteditable="true"]') ||
        t.closest('[data-agreemint-tiptap-root]')
      ) {
        return
      }
      bandMoveFromInlineChrome =
        bandNested != null && bandCanvasEditElementId === bandNested.container.id
    }
    const st0 = useEditorStore.getState()
    // The former `mergeShapes` canvas tool has been retired — shift-select
    // + the Union / Divide buttons in the Actions panel replace its job.
    if (st0.canvasTool === 'pan') return
    if (st0.bandCanvasEditElementId === el.id) return
    if (e.button !== 0) return
    if (t.closest('[data-resize-handle]')) return
    if (t.closest('[data-table-column-resize]')) return
    if (t.closest('[data-table-row-resize]')) return
    if (t.closest('[contenteditable="true"]')) return
    if (t.closest('.ProseMirror')) return
    if (t.closest('[data-agreemint-tiptap-root]')) return
    if (t.closest('input, textarea, select, button')) return
    const additive = e.metaKey || e.ctrlKey || e.shiftKey
    select(el.id, additive ? { additive: true } : undefined)
    if (locked) return
    if (viewOnly) return

    const stForBandDiag = useEditorStore.getState()
    const nestedBandDiag = findBandNestedChild(stForBandDiag.pages, el.id)
    if (nestedBandDiag && stForBandDiag.bandCanvasEditElementId === nestedBandDiag.container.id) {
      editorDiagLogOnce(
        'why-header-band-move',
        'canvas',
        'Header/footer band: move drag works because (1) while TipTap inline is open, pointerdown only ignores hits on the rich-text surface (ProseMirror / contenteditable / data-agreemint-tiptap-root) or the resize handle — not the whole box, so frame/padding can start a drag; (2) window pointermove no longer aborts when canvasInlineEditId matches the element, so the drag actually applies; (3) the band editor stack sits at z-[35] so full-width horizontal guide strips (z-30) do not steal clicks from band children.',
        {
          elementId: el.id,
          bandContainerId: nestedBandDiag.container.id,
          moveFromInlineChrome: bandMoveFromInlineChrome,
        }
      )
    }

    windowDragCleanupRef.current?.()
    windowDragCleanupRef.current = null

    const pointerId = e.pointerId
    const startAt = performance.now()
    dragRef.current = {
      pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: coerceLayoutScalar(el.x, 0),
      originY: coerceLayoutScalar(el.y, 0),
      dragging: false,
      startAt,
    }

    const finishWindowDrag = () => {
      window.removeEventListener('pointermove', onWindowPointerMove)
      window.removeEventListener('pointerup', onWindowPointerUp)
      window.removeEventListener('pointercancel', onWindowPointerUp)
      windowDragCleanupRef.current = null
    }

    const onWindowPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const d = dragRef.current
      if (!d || d.pointerId !== pointerId) return
      const dx = ev.clientX - d.startClientX
      const dy = ev.clientY - d.startClientY
      if (!d.dragging) {
        const st0 = useEditorStore.getState()
        const skipHold = st0.spaceMoveTool || st0.canvasTool === 'move'
        if (!skipHold && performance.now() - d.startAt < DRAG_HOLD_MS) return
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
        d.dragging = true
        setIsDragging(true)
        useEditorStore.getState().beginHistoryBatch()
        try {
          outerRef.current?.setPointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
      }
      const st = useEditorStore.getState()
      const z = st.canvasZoom
      const nested = findBandNestedChild(st.pages, el.id)
      let activeEls: LayoutElement[]
      let userGuides: PageGuides
      let viewportPt: { width: number; height: number } | undefined
      if (nested) {
        activeEls = nested.container.bandElements ?? []
        userGuides = nested.container.bandGuides ?? EMPTY_PAGE_GUIDES
        viewportPt = bandViewportDims(st, nested.container)
      } else {
        activeEls = selectActivePageElements(st)
        userGuides = st.pages[st.activePageIndex]?.guides ?? EMPTY_PAGE_GUIDES
        viewportPt = undefined
      }
      const current = activeEls.find((x) => x.id === el.id) ?? el
      const nx = d.originX + dx / z
      const ny = d.originY + dy / z
      const others = activeEls.filter((x) => x.id !== el.id)
      const { x, y, guides, violatesMargins } = computeDragSnap(
        nx,
        ny,
        current,
        others,
        st.pageSpec,
        {
          snapToGrid: ev.shiftKey,
          smartGuides: st.smartGuidesEnabled,
          userGuides,
          gridSize: st.gridSize,
        },
        viewportPt
      )
      setMarginClampHighlight(violatesMargins)
      st.setDragGuides(guides)
      st.moveElement(el.id, x, y)
    }

    const onWindowPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      finishWindowDrag()
      const d = dragRef.current
      const wasDragging = d?.dragging
      if (d?.dragging) {
        try {
          outerRef.current?.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
      }
      dragRef.current = null
      setIsDragging(false)
      setMarginClampHighlight(false)
      useEditorStore.getState().setDragGuides({ vertical: [], horizontal: [] })
      if (wasDragging) useEditorStore.getState().endHistoryBatch()
    }

    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', onWindowPointerUp)
    window.addEventListener('pointercancel', onWindowPointerUp)
    windowDragCleanupRef.current = finishWindowDrag
  }

  const onPointerDownBubble = (e: React.PointerEvent) => {
    e.stopPropagation()
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (viewOnly) return
    if (locked) return
    const t = e.target as HTMLElement
    if (
      isInlineEditing &&
      (t.closest('.ProseMirror') ||
        t.closest('[contenteditable="true"]') ||
        t.closest('[data-agreemint-tiptap-root]') ||
        t.closest('input'))
    ) {
      return
    }
    e.stopPropagation()
    e.preventDefault()
    select(el.id)

    // Double-click on a mergeable shape → enter per-vertex path-edit mode.
    // Matches the Excalidraw / Figma convention. Parametric shapes
    // (ellipse, ring, arrow, …) polygonalise to MERGED_SHAPE on entry —
    // see {@link enterPathEditMode} in the store.
    if (isMergeableShapeType(el.type)) {
      useEditorStore.getState().enterPathEditMode(el.id)
      return
    }

    if (!canInlineEdit) return
    if (el.type === 'HEADER' || el.type === 'FOOTER') {
      enterBandCanvasEdit(el.id)
      return
    }
    if (bandNested) {
      if (bandCanvasEditElementId === bandNested.container.id) {
        setCanvasInlineEdit(el.id)
      } else {
        enterBandCanvasEdit(bandNested.container.id)
        useEditorStore.getState().select(el.id)
        useEditorStore.getState().setCanvasInlineEdit(el.id)
      }
      return
    }
    setCanvasInlineEdit(el.id)
  }

  const onResizeMouseDown = (e: React.MouseEvent) => {
    if (locked) return
    e.stopPropagation()
    e.preventDefault()
    const stResize = useEditorStore.getState()
    const nestedResize = findBandNestedChild(stResize.pages, el.id)
    if (
      nestedResize &&
      stResize.bandCanvasEditElementId === nestedResize.container.id &&
      stResize.canvasInlineEditId === el.id
    ) {
      editorDiagLogOnce(
        'why-header-band-resize',
        'canvas',
        'Header/footer band: resize works while TipTap inline is open because the violet handle stays rendered when this TEXT is a band child and bandCanvasEditElementId matches its HEADER/FOOTER (it is no longer gated on !isInlineEditing only). The handle uses z-[40] so it stays above the editor surface.',
        { elementId: el.id, bandContainerId: nestedResize.container.id }
      )
    }
    useEditorStore.getState().beginHistoryBatch()
    const startX = e.clientX
    const startY = e.clientY
    const startW = Math.max(1, coerceLayoutScalar(el.width, 20))
    const startH = Math.max(1, coerceLayoutScalar(el.height, 16))

    // TEXT content-min floor: a textbox can't be shrunk below the size its
    // current content needs to render without clipping. Uses a hidden
    // "mirror" div cloned from the live rendered content — during drag, we
    // set mirror.style.width = target, read its scrollHeight, and clamp the
    // resize height to that value. This gives the "shrink one, grow the
    // other" UX: narrowing width forces height to stretch (because text
    // rewraps to more lines), and the clamp refuses to let both shrink
    // past the area the content needs. Replaces the earlier static
    // drag-start snapshot, which couldn't reflow when width changed.
    const isTextEl = el.type === 'TEXT' || el.type === 'HEADER' || el.type === 'FOOTER' || el.type === 'FLOATING'
    let mirror: HTMLElement | null = null
    let widestWordPx = 20
    if (isTextEl && outerRef.current) {
      const root = outerRef.current
      // Widest unbreakable token via Canvas 2D — this is the absolute width
      // floor. No amount of taller-height can make a word narrower.
      try {
        const text = root.innerText ?? ''
        const words = text.split(/\s+/).filter(Boolean)
        if (words.length > 0) {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          if (ctx) {
            const fs = typeof el.style?.fontSize === 'number' ? el.style.fontSize : 12
            const ff = coerceToSupportedFamily(el.style?.fontFamily) || 'sans-serif'
            const weight = el.style?.bold ? '700' : '400'
            const slant = el.style?.italic ? 'italic' : 'normal'
            ctx.font = `${slant} ${weight} ${fs}px ${ff}`
            let max = 0
            for (const w of words) {
              const m = ctx.measureText(w).width
              if (m > max) max = m
            }
            widestWordPx = Math.max(20, Math.ceil(max) + 4)
          }
        }
      } catch {
        /* leave widestWordPx at 20px absolute floor */
      }
      // Mirror: positioned off-screen, populated with a clone of the live
      // inner content. We re-size its width each frame and read back
      // scrollHeight to get the required height at that width. Using a
      // clone of the actual rendered DOM means font, weight, color, and
      // decoration all carry over without us re-deriving them.
      try {
        const inner = root.firstElementChild as HTMLElement | null
        if (inner) {
          const clone = inner.cloneNode(true) as HTMLElement
          // Strip absolute-positioned line wrappers — they don't reflow.
          // The simplest way: fall through to flowed text by forcing the
          // container into CSS-flow and dropping children with `position:
          // absolute`. In practice the cloned subtree from
          // RichTextAbsoluteLines has many absolute children; copying the
          // plain text as a single paragraph gives us a reliable reflow.
          const text = root.innerText ?? ''
          clone.innerHTML = ''
          const p = document.createElement('div')
          p.textContent = text
          // Inherit the visible element's typography so measurement
          // matches what the user sees.
          const cs = window.getComputedStyle(inner)
          p.style.fontFamily = cs.fontFamily
          p.style.fontSize = cs.fontSize
          p.style.fontWeight = cs.fontWeight
          p.style.fontStyle = cs.fontStyle
          p.style.lineHeight = cs.lineHeight
          p.style.letterSpacing = cs.letterSpacing
          p.style.whiteSpace = 'pre-wrap'
          p.style.wordBreak = 'normal'
          p.style.overflowWrap = 'break-word'
          clone.appendChild(p)
          clone.style.position = 'absolute'
          clone.style.left = '-99999px'
          clone.style.top = '0'
          clone.style.visibility = 'hidden'
          clone.style.pointerEvents = 'none'
          clone.style.width = `${startW}px`
          clone.style.height = 'auto'
          document.body.appendChild(clone)
          mirror = clone
        }
      } catch {
        /* mirror setup failed — onMove falls back to the widestWordPx floor */
      }
    }
    // MERGED_SHAPE's outline lives in per-vertex data. Snapshot it at
    // drag start so each frame can scale from the ORIGINAL (snapshot →
    // target) rather than from whatever the store holds after the
    // previous frame — cumulative scaling compounds rounding errors and
    // every margin-clamp truncation, eventually pushing the outline
    // outside the bbox.
    const isMergedShape = el.type === 'MERGED_SHAPE'
    const startShapePolys = isMergedShape && el.shapePolys
      ? el.shapePolys.map((poly) => poly.map((ring) => ring.map((pt) => [pt[0], pt[1]] as [number, number])))
      : undefined
    const startBezierPath = isMergedShape && el.bezierPath
      ? el.bezierPath.map((poly) =>
          poly.map((ring) =>
            ring.map((v) => ({
              p: [v.p[0], v.p[1]] as [number, number],
              ...(v.cpIn ? { cpIn: [v.cpIn[0], v.cpIn[1]] as [number, number] } : {}),
              ...(v.cpOut ? { cpOut: [v.cpOut[0], v.cpOut[1]] as [number, number] } : {}),
              ...(v.smooth ? { smooth: true } : {}),
            })),
          ),
        )
      : undefined

    const onMove = (ev: MouseEvent) => {
      const st = useEditorStore.getState()
      const z = st.canvasZoom
      const nested = findBandNestedChild(st.pages, el.id)
      let activeEls: LayoutElement[]
      let userGuides: PageGuides
      let viewportPt: { width: number; height: number } | undefined
      if (nested) {
        activeEls = nested.container.bandElements ?? []
        userGuides = nested.container.bandGuides ?? EMPTY_PAGE_GUIDES
        viewportPt = bandViewportDims(st, nested.container)
      } else {
        activeEls = selectActivePageElements(st)
        userGuides = st.pages[st.activePageIndex]?.guides ?? EMPTY_PAGE_GUIDES
        viewportPt = undefined
      }
      const current = activeEls.find((x) => x.id === el.id)
      if (!current) return
      const dx = (ev.clientX - startX) / z
      const dy = (ev.clientY - startY) / z
      const others = activeEls.filter((x) => x.id !== el.id)
      // eslint-disable-next-line prefer-const
      let { width, height, guides, violatesMargins } = computeResizeSnap(
        startW + dx,
        startH + dy,
        current,
        others,
        st.pageSpec,
        {
          snapToGrid: ev.shiftKey,
          smartGuides: st.smartGuidesEnabled,
          userGuides,
          gridSize: st.gridSize,
        },
        viewportPt
      )
      if (isTextEl) {
        // Dynamic content-min: the widest unbreakable word is a hard
        // width floor, and the mirror div's scrollHeight at the proposed
        // width gives the height floor at that width. If the author
        // narrows the box, the mirror rewraps, scrollHeight goes up,
        // and we clamp the height to match — so "shrink width, grow
        // height" works; "shrink both" is refused.
        if (width < widestWordPx) width = widestWordPx
        let contentMinH = 16
        if (mirror) {
          mirror.style.width = `${Math.max(1, Math.floor(width))}px`
          contentMinH = Math.ceil(mirror.scrollHeight)
        }
        if (height < contentMinH) height = contentMinH
      }
      setMarginClampHighlight(violatesMargins)
      st.setDragGuides(guides)
      if (isMergedShape) {
        // Snapshot-anchored scaling: the per-frame result is always
        // (snapshot × clamped target / start). Scaling anew each frame
        // means rounding / clamp truncation never accumulates.
        const sx = width / startW
        const sy = height / startH
        const scaledPolys = startShapePolys
          ? startShapePolys.map((poly) =>
              poly.map((ring) => ring.map((pt) => [pt[0] * sx, pt[1] * sy] as [number, number])),
            )
          : undefined
        const scaledBezier = startBezierPath
          ? startBezierPath.map((poly) =>
              poly.map((ring) =>
                ring.map((v) => ({
                  p: [v.p[0] * sx, v.p[1] * sy] as [number, number],
                  ...(v.cpIn ? { cpIn: [v.cpIn[0] * sx, v.cpIn[1] * sy] as [number, number] } : {}),
                  ...(v.cpOut ? { cpOut: [v.cpOut[0] * sx, v.cpOut[1] * sy] as [number, number] } : {}),
                  ...(v.smooth ? { smooth: true } : {}),
                })),
              ),
            )
          : undefined
        st.setMergedShapeGeometry(el.id, width, height, scaledPolys, scaledBezier, { skipHistory: true })
      } else {
        st.resizeElement(el.id, width, height)
      }
    }
    const onUp = () => {
      setMarginClampHighlight(false)
      useEditorStore.getState().setDragGuides({ vertical: [], horizontal: [] })
      useEditorStore.getState().endHistoryBatch()
      if (mirror && mirror.parentNode) {
        mirror.parentNode.removeChild(mirror)
        mirror = null
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Linked frames stay at their reflow-assigned height during editing; standalone text grows freely
  const growWithText = isInlineEditing && canInlineEdit && !isLinkedFrame
  const boxX = coerceLayoutScalar(el.x, 0)
  const boxY = coerceLayoutScalar(el.y, 0)
  const boxW = Math.max(1, coerceLayoutScalar(el.width, 20))
  const boxHRaw = coerceLayoutScalar(el.height, el.type === 'LINE' ? 4 : 16)
  const boxH = el.type === 'LINE' ? Math.max(boxHRaw, 4) : boxHRaw

  // Element-level visual style: opacity, rotation, shadow
  const elOpacity = el.style?.opacity ?? 1
  const effectiveOpacity = isDragging
    ? Math.min(0.9, elOpacity)
    : locked
      ? Math.min(0.92, elOpacity)
      : elOpacity < 1
        ? elOpacity
        : undefined
  const elRotation = el.style?.rotation
  const elShadow = el.style?.shadow

  const style: React.CSSProperties = {
    left: boxX,
    top: boxY,
    width: boxW,
    ...(growWithText
      ? { height: 'auto', minHeight: 16, overflow: 'visible' }
      : isInlineEditing && isLinkedFrame
        ? { height: boxH, overflow: 'auto' }
        : { height: boxH }),
    touchAction: isInlineEditing ? 'auto' : 'none',
    cursor: isInlineEditing
      ? 'text'
      : locked
        ? 'default'
        : isDragging
          ? 'grabbing'
          : spaceMoveTool || canvasTool === 'move'
            ? 'grab'
            : 'default',
    ...(effectiveOpacity != null ? { opacity: effectiveOpacity } : {}),
    ...(elRotation ? { transform: `rotate(${elRotation}deg)`, transformOrigin: 'center' } : {}),
    ...(elShadow
      ? {
          filter: `drop-shadow(${elShadow.offsetX}pt ${elShadow.offsetY}pt ${elShadow.blur}pt ${elShadow.color})`,
        }
      : {}),
  }

  return (
    <div
      ref={outerRef}
      className={`group absolute box-border select-none transition-shadow ${
        isCommentHighlighted
          ? 'ring-2 ring-amber-400 ring-offset-1 shadow-[0_0_8px_2px_rgba(251,191,36,0.35)]'
          : marginClampHighlight && !isMarginExemptType(el.type)
            ? 'ring-2 ring-red-500/85 ring-offset-1 shadow-[0_0_0_3px_rgba(248,113,113,0.22)]'
            : selected
              ? locked
                ? 'ring-2 ring-amber-500 ring-offset-1'
                : hideTableOuterSelectionRing
                  ? 'hover:ring-1 hover:ring-violet-400 dark:hover:ring-violet-500'
                  // A TABLE picked at element-level gets the normal violet
                  // ring PLUS a soft violet tint, so it reads as "the whole
                  // table is the selection target" even though each cell
                  // draws its own chrome inside.
                  : tableElementLevelSelected
                    ? 'ring-2 ring-violet-500 ring-offset-1 bg-violet-50/40 dark:bg-violet-950/30'
                    : 'ring-2 ring-violet-500 ring-offset-1'
              : 'hover:ring-1 hover:ring-violet-400 dark:hover:ring-violet-500'
      } ${isDragging ? 'z-10' : isInlineEditing ? 'z-20' : 'z-[1]'}`}
      style={
        remoteSelector
          ? {
              ...style,
              outline: `2px solid ${remoteSelector.color}`,
              outlineOffset: 1,
            }
          : style
      }
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDownBubble}
      title={
        // Native hover-tooltip. Gated on the same `showEditorHints` flag
        // as the floating hint strip below so both can be toggled from
        // the status bar's "Hints" switch.
        !showEditorHints || locked
          ? undefined
          : canInlineEdit
            ? bandNested && bandCanvasEditElementId !== bandNested.container.id
              ? 'Double-click to open header/footer band editor (edits only in band mode) · ⌘/Ctrl/Shift+click multi-select · Space+drag or hold to move'
              : 'Double-click to edit · ⌘/Ctrl/Shift+click multi-select · Space+drag or hold to move'
            : '⌘/Ctrl/Shift+click multi-select · Space+drag or hold to move'
      }
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        if (canvasTool === 'pan') return
        if (isInlineEditing) return
        e.preventDefault()
        e.stopPropagation()
        onElementContextMenu?.(e, el.id)
      }}
    >
      {isInlineEditing && canInlineEdit ? (
        el.type === 'LIST' ? (
          /* ── LIST inline editing: delegate entirely to ListElementCanvas ── */
          <div
            ref={inlineEditorRef}
            className="h-full w-full"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ListElementCanvas
              el={el}
              isEditing
              onCommit={commitInlineEdit}
              onEscape={escapeInlineEdit}
            />
          </div>
        ) : (
          // ── TEXT / HEADER / FOOTER inline editing: TipTap ──
          // No horizontal/vertical padding utility classes or bg-white
          // fallback here — the inline editor must visually sit at the
          // exact same box as the ElementPreview render, otherwise the
          // first frame of edit mode looks like the text jumped
          // down-and-right and the element suddenly grew an opaque
          // background. The violet selection ring is already the
          // visual cue that edit mode is active, so a white fill is
          // unnecessary. If the author wants a background they set
          // style.backgroundColor (picked up by resolveBgStyle below)
          // and it renders in BOTH modes.
          <div
            ref={inlineEditorRef}
            className={`w-full ${
              el.style?.color?.trim()
                ? ''
                : 'text-zinc-900 dark:text-zinc-100'
            }`}
            style={{
              fontSize: el.style?.fontSize ?? 12,
              // Inherit element-level bold/italic/underline/strikethrough
              // into the inline editor so the visual weight + slant +
              // decoration match `RichTextBlockPreview`. Otherwise
              // double-clicking e.g. a bold-underlined element appears to
              // unbold/undecoreate the text even though nothing changed in
              // the data. TipTap run-level marks still layer on top.
              fontWeight: el.style?.bold ? 700 : 400,
              fontStyle: el.style?.italic ? 'italic' : 'normal',
              textDecoration: [
                el.style?.underline ? 'underline' : null,
                el.style?.strikethrough ? 'line-through' : null,
              ].filter(Boolean).join(' ') || undefined,
              fontFamily: coerceToSupportedFamily(el.style?.fontFamily),
              textAlign: (el.style?.align ?? 'left') as React.CSSProperties['textAlign'],
              color: el.style?.color?.trim() || undefined,
              background: resolveBgStyle(el) || undefined,
              lineHeight: el.style?.lineHeight ?? 1.4,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <TipTapRichEditor
              content={storeRichTextContent ?? el.content}
              emitOnChange={true}
              onChange={persistCanvasTextContent}
              variableMentions={variableMentions}
              variableValues={variableValues}
              variableChipDetailResolver={resolveVariableChipDetail}
              variableSurfaceLabelResolver={resolveVariableSurfaceLabel}
              mode="canvas"
              sessionKey={el.id}
              autoFocus
              onPaste={() => { pasteSeenInEditRef.current = true }}
              // Collaborative TEXT: bind to a Y.XmlFragment keyed by element id so
              // concurrent typing from multiple users merges CRDT-style.
              collabFragment={templateId ? getYFragment(templateId, el.id) : undefined}
              // `bg-transparent` so the editor never paints its own background
              // on top of the element's (possibly gradient) fill. NO
              // `font-normal` / `not-italic` here — we WANT the inherited
              // weight/style from the wrapper above so edit mode matches
              // the preview render of element-level bold/italic.
              editorClassName="bg-transparent"
              editorStyle={{
                fontSize: el.style?.fontSize ?? 12,
                fontWeight: el.style?.bold ? 700 : 400,
                fontStyle: el.style?.italic ? 'italic' : 'normal',
                textAlign: (el.style?.align ?? 'left') as React.CSSProperties['textAlign'],
                color: el.style?.color?.trim() || undefined,
                backgroundColor: 'transparent',
                lineHeight: el.style?.lineHeight ?? 1.4,
              }}
              onReady={(ed) => {
                inlineTipTapLocalRef.current = ed
                registerActiveCanvasTipTapEditor(el.id, ed)
                setInlineTipTapEditor(ed)
              }}
              onUnmount={(ed) => {
                if (inlineTipTapLocalRef.current === ed) {
                  inlineTipTapLocalRef.current = null
                }
                unregisterActiveCanvasTipTapEditor(el.id, ed)
                const cur = useEditorStore.getState().inlineTipTapEditor
                if (cur === ed) {
                  setInlineTipTapEditor(null)
                }
              }}
              canvasKeyboard={{
                onEscape: escapeInlineEdit,
                onCommitShortcut: commitInlineEdit,
              }}
            />
          </div>
        )
      ) : (
        <ElementPreview el={el} />
      )}
      {/* Shape-silhouette highlight on selection — sits on top of the
          shape but underneath the resize handles. Returns null for
          rectangular shapes so it only adds value where the bbox ring is
          a poor visual match for the actual silhouette (ellipse, star,
          triangle, etc.). */}
      {selected && !locked && !isInlineEditing && <ShapeSilhouetteOverlay el={el} />}
      {soleSelected &&
        !locked &&
        !viewOnly &&
        (!isInlineEditing ||
          (bandNested != null && bandCanvasEditElementId === bandNested.container.id)) && (
        <button
          type="button"
          data-resize-handle
          aria-label="Resize"
          className="absolute -bottom-1 -right-1 z-[40] h-3 w-3 cursor-nwse-resize rounded-sm bg-violet-600"
          onMouseDown={onResizeMouseDown}
        />
      )}
      {el.groupId && selected && (
        <span
          className="pointer-events-none absolute left-1 top-1 z-30 rounded bg-violet-100 px-1 py-px text-[8px] font-bold text-violet-900 dark:bg-violet-950/80 dark:text-violet-100"
          title="Grouped — moves with other members"
        >
          Group
        </span>
      )}
      {/* Remote-selection presence badge. Same condition as the coloured
          outline above — when another user has this element in their
          active selection, show a tiny avatar chip at the top-right with
          a hover tooltip naming them. Lets people tell at-a-glance who's
          poking at which element, MS-Excel-style. */}
      {remoteSelector && <RemoteSelectionBadge user={remoteSelector} />}
      {/* Table-select handle: a hover-revealed grid-icon button pinned
          outside the top-left corner of a TABLE element. Click it to
          select the whole table (bypassing the cell-level selection the
          table interior would otherwise route clicks into). Also doubles
          as an escape hatch when any cell inside is selected or in edit
          mode — the handle stays persistently visible then. */}
      {el.type === 'TABLE' && !locked && !viewOnly && <TableSelectHandle tableId={el.id} />}
      {locked && (
        <span
          className="pointer-events-none absolute right-1 top-1 z-30 rounded bg-amber-100 px-1 py-px text-[9px] font-bold text-amber-900 dark:bg-amber-950/80 dark:text-amber-100"
          title="Layer locked — unlock in the Behaviour or Layers tab to move or edit"
        >
          Locked
        </span>
      )}
      {(el.comments?.length ?? 0) > 0 && (
        <span
          className="pointer-events-none absolute bottom-1 right-1 z-30 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[8px] font-bold text-white shadow-sm"
          title={`${el.comments!.length} comment${el.comments!.length > 1 ? 's' : ''}`}
        >
          {el.comments!.length}
        </span>
      )}
      {el.linkedPrevId && (
        <span
          className="pointer-events-none absolute -top-4 left-1/2 z-30 -translate-x-1/2 rounded bg-sky-100 px-1.5 py-px text-[8px] font-semibold text-sky-700 dark:bg-sky-900/60 dark:text-sky-200"
          title="Continued from previous page"
        >
          &#x2191; Continued
        </span>
      )}
      {el.linkedNextId && (
        <span
          className="pointer-events-none absolute -bottom-4 left-1/2 z-30 -translate-x-1/2 rounded bg-sky-100 px-1.5 py-px text-[8px] font-semibold text-sky-700 dark:bg-sky-900/60 dark:text-sky-200"
          title="Continues on next page"
        >
          Continues &#x2193;
        </span>
      )}
      {editOverflowing && !el.linkedNextId && (
        <span
          className="pointer-events-none absolute -bottom-4 left-1/2 z-30 -translate-x-1/2 rounded bg-amber-100 px-1.5 py-px text-[8px] font-semibold text-amber-800 ring-1 ring-amber-300 dark:bg-amber-900/60 dark:text-amber-100 dark:ring-amber-600"
          title="This text overflows the page. When you finish editing, it will be split across pages automatically."
        >
          Overflows page · will split when you finish
        </span>
      )}
      {showEditorHints && canInlineEdit && !isInlineEditing && soleSelected && !locked && !viewOnly && (
        <span className={`pointer-events-none absolute left-0 max-w-[min(100%,280px)] text-[9px] leading-tight text-zinc-500 dark:text-zinc-400 ${el.linkedPrevId ? '-top-9' : '-top-5'}`}>
          {el.type === 'TEXT' && bandNested && bandCanvasEditElementId !== bandNested.container.id
            ? 'Double-click opens band editor — text edits only there · toolbar Page / Header / Footer · Esc when done'
            : el.type === 'TEXT'
              ? 'Double-click to edit · click a purple field for details · top bar for format · ⌘/Ctrl+Enter to finish'
              : el.type === 'HEADER' || el.type === 'FOOTER'
                ? 'Double-click for band editor (full width) · Esc / Done to return'
                : 'Double-click to edit · click a purple field for details · ⌘/Ctrl+Enter to finish'}
        </span>
      )}
      {/* View-only mode: comment icon on hover (only if commenting is enabled) */}
      {viewOnly && commentingEnabled && (
        <button
          type="button"
          className="absolute -right-1 -top-1 z-30 flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 hover:bg-violet-700"
          title="Add comment"
          onClick={(e) => {
            e.stopPropagation()
            onCommentClick?.(el.id)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** Render SVG <defs> for a gradient. Returns the fill/stroke value as `url(#id)`. */
function SvgGradientDef({ g, id }: { g: GradientDef; id: string }) {
  if (g.type === 'radial') {
    return (
      <radialGradient id={id} cx="50%" cy="50%" r="50%">
        {g.stops.map((s, i) => (
          <stop key={i} offset={`${Math.round(s.position * 100)}%`} stopColor={s.color} />
        ))}
      </radialGradient>
    )
  }
  const { x1, y1, x2, y2 } = svgLinearGradientProps(g)
  return (
    <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
      {g.stops.map((s, i) => (
        <stop key={i} offset={`${Math.round(s.position * 100)}%`} stopColor={s.color} />
      ))}
    </linearGradient>
  )
}

/** Resolve the CSS background value for an element (gradient or solid). */
function resolveBgStyle(el: LayoutElement): string | undefined {
  if (isValidGradient(el.style?.bgGradient)) return gradientToCss(el.style!.bgGradient!)
  return el.style?.backgroundColor?.trim() || undefined
}

/** Resolve CSS text color styles. Returns inline styles for either solid or gradient text. */
function resolveTextColorStyle(el: LayoutElement): React.CSSProperties {
  if (isValidGradient(el.style?.colorGradient)) {
    return {
      background: gradientToCss(el.style!.colorGradient!),
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    }
  }
  const c = el.style?.color?.trim()
  return c ? { color: c } : {}
}

/**
 * Thin shape-following highlight that overlays the existing rectangular
 * selection ring. The bbox + handles still own the editing affordance —
 * this layer just makes it obvious *which silhouette* is selected when
 * the bbox surrounds a lot of empty space (triangle, ellipse, star, …).
 *
 * Returns null for rectangular shapes (BOX, TEXT, IMAGE, TABLE, LIST,
 * HEADER, FOOTER, FLOATING) and for LINE — in those cases the bbox ring
 * already matches the visible silhouette so the extra outline would be
 * redundant.
 */
function ShapeSilhouetteOverlay({ el }: { el: LayoutElement }) {
  const w = el.width
  const h = el.height
  if (w <= 0 || h <= 0) return null
  const stroke = 'rgb(139 92 246)'
  const sw = 1.5
  const common = {
    fill: 'none' as const,
    stroke,
    strokeWidth: sw,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinejoin: 'round' as const,
  }
  let geometry: React.ReactNode = null
  switch (el.type) {
    case 'POLYGON': {
      const kind = el.polygonKind ?? 'rect'
      // 'rect' silhouette already coincides with the bbox ring — drawing
      // a second outline on top would just thicken the ring. Skip.
      if (kind === 'rect') return null
      const points = resolvePolygonPoints(el)
      geometry = <polygon points={polygonPointsToSvgString(points)} {...common} />
      break
    }
    case 'ELLIPSE':
      geometry = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />
      break
    case 'TRIANGLE':
      geometry = <polygon points={`${w / 2},0 ${w},${h} 0,${h}`} {...common} />
      break
    case 'DIAMOND':
      geometry = <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} {...common} />
      break
    case 'STAR': {
      const cx = w / 2
      const cy = h / 2
      const ro = Math.min(w, h) / 2
      const ri = ro * 0.38
      const points: string[] = []
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2
        const r = i % 2 === 0 ? ro : ri
        points.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`)
      }
      geometry = <polygon points={points.join(' ')} {...common} />
      break
    }
    case 'RING': {
      const ratio = Math.max(0.05, Math.min(0.95, el.ringInnerRatio ?? 0.55))
      const iw = w * ratio
      const ih = h * ratio
      geometry = (
        <>
          <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />
          <ellipse cx={w / 2} cy={h / 2} rx={iw / 2} ry={ih / 2} {...common} />
        </>
      )
      break
    }
    case 'ARROW': {
      const t = Math.min(h * 0.35, w * 0.18)
      const mid = h / 2
      const arrowStart = el.style?.arrowStart === true
      const arrowEnd = el.style?.arrowEnd === true || (!arrowStart && el.style?.arrowEnd !== false)
      const headLen = w * 0.32
      const xLeftHead = arrowStart ? headLen : 0
      const xRightHead = arrowEnd ? w - headLen : w
      let d: string
      if (arrowStart && arrowEnd) {
        d =
          `M ${xLeftHead} ${mid - t / 2} L ${xRightHead} ${mid - t / 2} ` +
          `L ${xRightHead} 0 L ${w} ${mid} L ${xRightHead} ${h} ` +
          `L ${xRightHead} ${mid + t / 2} L ${xLeftHead} ${mid + t / 2} ` +
          `L ${xLeftHead} ${h} L 0 ${mid} L ${xLeftHead} 0 Z`
      } else if (arrowStart) {
        d =
          `M ${w} ${mid - t / 2} L ${xLeftHead} ${mid - t / 2} ` +
          `L ${xLeftHead} 0 L 0 ${mid} L ${xLeftHead} ${h} ` +
          `L ${xLeftHead} ${mid + t / 2} L ${w} ${mid + t / 2} Z`
      } else {
        d =
          `M 0 ${mid - t / 2} L ${xRightHead} ${mid - t / 2} ` +
          `L ${xRightHead} 0 L ${w} ${mid} L ${xRightHead} ${h} ` +
          `L ${xRightHead} ${mid + t / 2} L 0 ${mid + t / 2} Z`
      }
      geometry = <path d={d} {...common} />
      break
    }
    case 'MERGED_SHAPE': {
      const d = el.bezierPath?.length
        ? bezierPathToSvgPathD(el.bezierPath)
        : el.shapePolys?.length
          ? el.shapePolys.map(shapePolygonToSvgPathD).join(' ')
          : null
      if (!d) return null
      geometry = <path d={d} fillRule="evenodd" {...common} />
      break
    }
    default:
      // Rectangular elements (BOX/TEXT/IMAGE/TABLE/LIST/HEADER/FOOTER/
      // FLOATING) and degenerate LINE — bbox ring already matches the
      // visible silhouette; an extra outline would just thicken the
      // existing ring.
      return null
  }
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[3] h-full w-full overflow-visible"
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
    >
      {geometry}
    </svg>
  )
}

function ElementPreview({ el }: { el: LayoutElement }) {
  const variableValues = useEditorStore((s) => s.variableValues)
  const globalVariableDefinitions = useEditorStore((s) => s.globalVariableDefinitions)
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const variableSurfaceLabelResolver = useCallback(
    (n: string) => variableMergeFieldSurfaceLabel(n, globalVariableDefinitions, pages[activePageIndex]),
    [globalVariableDefinitions, pages, activePageIndex]
  )
  const fs = el.style?.fontSize ?? 12
  const align = (el.style?.align ?? 'left') as React.CSSProperties['textAlign']
  if (el.type === 'HEADER' || el.type === 'FOOTER') {
    const bandBg = resolveBgStyle(el)
    if (el.bandElements?.length) {
      return (
        <div
          className="pointer-events-none relative h-full w-full overflow-hidden text-zinc-900 dark:text-zinc-100"
          style={{ background: bandBg || undefined }}
        >
          {el.bandElements.map((ch) => (
            <div
              key={ch.id}
              className="absolute overflow-hidden"
              style={{ left: ch.x, top: ch.y, width: ch.width, height: ch.height }}
            >
              <ElementPreview el={ch} />
            </div>
          ))}
        </div>
      )
    }
    return (
      <div
        className="pointer-events-none flex h-full w-full flex-col overflow-hidden px-1 py-0.5 text-zinc-900 dark:text-zinc-100"
        style={{ background: bandBg || undefined }}
      >
        <RichTextBlockPreview
          content={el.content}
          variableValues={variableValues}
          variableSurfaceLabelResolver={variableSurfaceLabelResolver}
          fontSize={fs}
          textAlign={align}
          elementBold={el.style?.bold}
          elementItalic={el.style?.italic}
          elementUnderline={el.style?.underline}
          elementStrikethrough={el.style?.strikethrough}
          color={el.style?.color}
          fontFamily={coerceToSupportedFamily(el.style?.fontFamily)}
          lineHeight={el.style?.lineHeight}
        />
      </div>
    )
  }
  if (el.type === 'TABLE') {
    return <TableElementCanvas el={el as LayoutTableElement} locked={!!el.locked} />
  }
  if (el.type === 'LIST') {
    return <ListElementCanvas el={el} />
  }
  if (el.type === 'IMAGE') {
    const c = el.style?.color?.trim()
    const imgBg = resolveBgStyle(el)
    const hasSrc = Boolean(el.src?.trim())
    const imgBw = el.style?.borderWidth ?? 2
    const imgBs = el.style?.lineStyle ?? 'solid'
    const imgBr = el.style?.borderRadius
    return (
      <div
        className={`pointer-events-none flex h-full items-center justify-center overflow-hidden text-xs text-zinc-500`}
        style={{
          background: imgBg || undefined,
          borderWidth: c ? imgBw : undefined,
          borderStyle: c ? imgBs : undefined,
          borderColor: c || undefined,
          borderRadius: imgBr ? imgBr : undefined,
        }}
      >
        {hasSrc ? (
          <img src={el.src} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="px-2 text-center text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
            No image — set source in properties or add again
          </span>
        )}
      </div>
    )
  }
  if (el.type === 'LINE') {
    const c = el.style?.color?.trim()
    const ls = el.style?.lineStyle
    const sw = el.strokeWidth ?? 1
    const arrowStart = el.style?.arrowStart === true
    const arrowEnd = el.style?.arrowEnd === true
    const dash = ls === 'dashed' ? `${sw * 3} ${sw * 2}` : ls === 'dotted' ? `${sw} ${sw}` : undefined
    // SVG render so we can paint arrowheads via `<marker>` defs. The viewBox
    // matches the element's pixel dimensions so the line scales with the
    // bbox; markers are sized in stroke-width multiples (markerUnits
    // defaults to "strokeWidth") so arrowheads grow with the line. The
    // x endpoints are padded inwards by `markerSize × strokeWidth` when
    // an arrowhead is present so the tip lands exactly on the bbox edge
    // and the shaft doesn't peek through the marker fill.
    //
    // When the author clears the stroke colour we fall back to a dark
    // text colour via CSS classes so the line is still visible in the
    // editor (otherwise it'd vanish from the working surface). PDF
    // export still honors "no stroke" for LINE.
    const w = el.width
    const h = el.height
    const markerSize = 6
    const padStart = arrowStart ? markerSize * sw : 0
    const padEnd = arrowEnd ? markerSize * sw : 0
    const yMid = h / 2
    const startMarkerId = `${el.id}-arrow-start`
    const endMarkerId = `${el.id}-arrow-end`
    // Stroke gradient takes precedence over solid colour, mirroring BOX
    // and other shapes. The marker fill must use the same gradient so the
    // arrowhead colour matches the shaft along its axis.
    const lineHasStrokeGrad = isValidGradient(el.style?.colorGradient)
    const lineStrokeGradId = svgGradientId(el.id, 'stroke')
    const strokeAttr = lineHasStrokeGrad
      ? `url(#${lineStrokeGradId})`
      : (c || 'currentColor')
    return (
      <svg
        className="pointer-events-none h-full w-full overflow-visible text-zinc-800 dark:text-zinc-200"
        viewBox={`0 0 ${w} ${h}`}
        aria-hidden
      >
        <defs>
          {lineHasStrokeGrad && (
            <SvgGradientDef key="stroke" g={el.style!.colorGradient!} id={lineStrokeGradId} />
          )}
          {arrowStart && (
            <marker id={startMarkerId} viewBox="0 0 10 10" refX="2" refY="5" markerWidth={markerSize} markerHeight={markerSize} orient="auto-start-reverse">
              <path d="M 10 0 L 0 5 L 10 10 z" fill={strokeAttr} />
            </marker>
          )}
          {arrowEnd && (
            <marker id={endMarkerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth={markerSize} markerHeight={markerSize} orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={strokeAttr} />
            </marker>
          )}
        </defs>
        <line
          x1={padStart}
          y1={yMid}
          x2={w - padEnd}
          y2={yMid}
          stroke={strokeAttr}
          strokeWidth={sw}
          strokeDasharray={dash}
          markerStart={arrowStart ? `url(#${startMarkerId})` : undefined}
          markerEnd={arrowEnd ? `url(#${endMarkerId})` : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }
  if (el.type === 'POLYGON') {
    // Unified polygonal shape — replaces the BOX/TRIANGLE/DIAMOND/STAR/
    // ARROW branches. Geometry is computed by {@link resolvePolygonPoints}
    // from the bbox + {@link polygonKind} + (for arrow) arrowStart/end
    // flags. The 'rect' kind specially uses <rect> with rx/ry so authors
    // can still get rounded corners; every other kind renders as a
    // <polygon> with the resolved point list.
    const c = el.style?.color?.trim()
    const kind = el.polygonKind ?? 'rect'
    const sw = el.strokeWidth ?? (kind === 'rect' ? (el.style?.borderWidth ?? 2) : 2)
    // Solid by default for every polygon kind. (The pre-migration BOX
    // type defaulted to dashed; that was always a quirk and we've
    // standardised on solid as part of the unification.)
    const ls = el.style?.lineStyle ?? 'solid'
    const polyHasFillGrad = isValidGradient(el.style?.bgGradient)
    const polyHasStrokeGrad = isValidGradient(el.style?.colorGradient)
    const polyFillGradId = svgGradientId(el.id, 'fill')
    const polyStrokeGradId = svgGradientId(el.id, 'stroke')
    const polyFill = polyHasFillGrad
      ? `url(#${polyFillGradId})`
      : (el.style?.backgroundColor?.trim() || 'none')
    const polyStroke = polyHasStrokeGrad
      ? `url(#${polyStrokeGradId})`
      : (c || 'none')
    const dash = ls === 'dashed' ? '8 4' : ls === 'dotted' ? '2 2' : undefined
    const w = el.width
    const h = el.height
    const hasBorder = !!c || polyHasStrokeGrad
    const polyDefs: React.ReactNode[] = []
    if (polyHasFillGrad) polyDefs.push(<SvgGradientDef key="fill" g={el.style!.bgGradient!} id={polyFillGradId} />)
    if (polyHasStrokeGrad) polyDefs.push(<SvgGradientDef key="stroke" g={el.style!.colorGradient!} id={polyStrokeGradId} />)
    let geometry: React.ReactNode
    if (kind === 'rect') {
      // Inset by half stroke so the visual edge lands on the bbox edge
      // (matches the legacy CSS-border behaviour). Other polygon kinds
      // don't inset — vertices fall on the bbox corners by design.
      const br = el.style?.borderRadius ?? 0
      const inset = hasBorder ? sw / 2 : 0
      geometry = (
        <rect
          x={inset}
          y={inset}
          width={Math.max(0, w - inset * 2)}
          height={Math.max(0, h - inset * 2)}
          rx={br}
          ry={br}
          fill={polyFill}
          stroke={polyStroke}
          strokeWidth={hasBorder ? sw : 0}
          strokeDasharray={dash}
          vectorEffect="non-scaling-stroke"
        />
      )
    } else {
      const points = resolvePolygonPoints(el)
      geometry = (
        <polygon
          points={polygonPointsToSvgString(points)}
          fill={polyFill}
          stroke={polyStroke}
          strokeWidth={hasBorder ? sw : 0}
          strokeDasharray={dash}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    return (
      <svg className="pointer-events-none h-full w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {polyDefs.length > 0 && <defs>{polyDefs}</defs>}
        {geometry}
      </svg>
    )
  }
  if (el.type === 'BOX') {
    // BOX is rendered as an SVG <rect> just like every other shape so its
    // outline is a real path — that gives us stroke gradient support, a
    // unified "no stroke / no fill" semantic, and a silhouette geometry
    // the selection-highlight overlay can reuse. Replaces the legacy
    // `<div>` with CSS `border` which couldn't honour stroke gradients
    // and forced the rest of the codebase to special-case BOX.
    const c = el.style?.color?.trim()
    const bw = el.style?.borderWidth ?? 2
    // Solid border default for the legacy BOX fallback branch — matches
    // the unified POLYGON branch above. Old saved layouts that don't set
    // lineStyle now render with a solid border instead of dashed.
    const bs = el.style?.lineStyle ?? 'solid'
    const br = el.style?.borderRadius ?? 0
    const boxHasFillGrad = isValidGradient(el.style?.bgGradient)
    const boxHasStrokeGrad = isValidGradient(el.style?.colorGradient)
    const boxFillGradId = svgGradientId(el.id, 'fill')
    const boxStrokeGradId = svgGradientId(el.id, 'stroke')
    const boxFill = boxHasFillGrad
      ? `url(#${boxFillGradId})`
      : (el.style?.backgroundColor?.trim() || 'none')
    const boxStroke = boxHasStrokeGrad
      ? `url(#${boxStrokeGradId})`
      : (c || 'none')
    const dash = bs === 'dashed' ? '8 4' : bs === 'dotted' ? '2 2' : undefined
    const w = el.width
    const h = el.height
    // Inset by half the stroke width so the visual edge lands exactly on
    // the bbox edge (SVG strokes straddle the path by default; the legacy
    // CSS border rendered fully inside the box).
    const hasBorder = !!c || boxHasStrokeGrad
    const inset = hasBorder ? bw / 2 : 0
    const boxDefs: React.ReactNode[] = []
    if (boxHasFillGrad) boxDefs.push(<SvgGradientDef key="fill" g={el.style!.bgGradient!} id={boxFillGradId} />)
    if (boxHasStrokeGrad) boxDefs.push(<SvgGradientDef key="stroke" g={el.style!.colorGradient!} id={boxStrokeGradId} />)
    return (
      <svg className="pointer-events-none h-full w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {boxDefs.length > 0 && <defs>{boxDefs}</defs>}
        <rect
          x={inset}
          y={inset}
          width={Math.max(0, w - inset * 2)}
          height={Math.max(0, h - inset * 2)}
          rx={br}
          ry={br}
          fill={boxFill}
          stroke={boxStroke}
          strokeWidth={hasBorder ? bw : 0}
          strokeDasharray={dash}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }
  const hasFillGrad = isValidGradient(el.style?.bgGradient)
  const hasStrokeGrad = isValidGradient(el.style?.colorGradient)
  const fillGradId = svgGradientId(el.id, 'fill')
  const strokeGradId = svgGradientId(el.id, 'stroke')
  // If the user picked "No Color" in the stroke swatch we want the stroke
  // to actually disappear. Previously this fell back to `currentColor` and
  // the shape kept its border (inherited from the parent text colour); now
  // the SVG stroke is genuinely hidden.
  const shapeStroke = hasStrokeGrad
    ? `url(#${strokeGradId})`
    : (el.style?.color?.trim() || 'none')
  const shapeFill = hasFillGrad ? `url(#${fillGradId})` : el.style?.backgroundColor?.trim()
  const sw = el.strokeWidth ?? 2
  const shapeDash =
    el.style?.lineStyle === 'dashed' ? '8 4' : el.style?.lineStyle === 'dotted' ? '2 2' : undefined
  // Collect gradient defs needed for this SVG element
  const svgDefs: React.ReactNode[] = []
  if (hasFillGrad) svgDefs.push(<SvgGradientDef key="fill" g={el.style!.bgGradient!} id={fillGradId} />)
  if (hasStrokeGrad) svgDefs.push(<SvgGradientDef key="stroke" g={el.style!.colorGradient!} id={strokeGradId} />)
  if (el.type === 'ELLIPSE') {
    const w = el.width
    const h = el.height
    return (
      <svg className="pointer-events-none h-full w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {svgDefs.length > 0 && <defs>{svgDefs}</defs>}
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(0.5, w / 2 - sw / 2)}
          ry={Math.max(0.5, h / 2 - sw / 2)}
          fill={shapeFill || 'none'}
          stroke={shapeStroke}
          strokeWidth={sw}
          strokeDasharray={shapeDash}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }
  if (el.type === 'RING') {
    const w = el.width
    const h = el.height
    const ratio = Math.min(0.95, Math.max(0.05, el.ringInnerRatio ?? 0.55))
    const cx = w / 2
    const cy = h / 2
    const orx = Math.max(0.5, w / 2)
    const ory = Math.max(0.5, h / 2)
    const irx = orx * ratio
    const iry = ory * ratio
    const seg = 40
    const loop = (rcx: number, rcy: number, rx: number, ry: number) => {
      let d = ''
      for (let i = 0; i <= seg; i++) {
        const t = (i / seg) * Math.PI * 2
        const px = rcx + rx * Math.cos(t)
        const py = rcy + ry * Math.sin(t)
        d += i === 0 ? `M ${px} ${py} ` : `L ${px} ${py} `
      }
      return `${d}Z`
    }
    const d = `${loop(cx, cy, orx, ory)} ${loop(cx, cy, irx, iry)}`
    return (
      <svg className="pointer-events-none h-full w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {svgDefs.length > 0 && <defs>{svgDefs}</defs>}
        <path
          d={d}
          fill={shapeFill || 'none'}
          fillRule="evenodd"
          stroke={shapeStroke}
          strokeWidth={sw}
          strokeDasharray={shapeDash}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }
  if (el.type === 'TRIANGLE') {
    const w = el.width
    const h = el.height
    const pts = `${w / 2},0 ${w},${h} 0,${h}`
    return (
      <svg className="pointer-events-none h-full w-full" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {svgDefs.length > 0 && <defs>{svgDefs}</defs>}
        <polygon points={pts} fill={shapeFill || 'none'} stroke={shapeStroke} strokeWidth={sw} strokeDasharray={shapeDash} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  if (el.type === 'DIAMOND') {
    const w = el.width
    const h = el.height
    const pts = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`
    return (
      <svg className="pointer-events-none h-full w-full" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {svgDefs.length > 0 && <defs>{svgDefs}</defs>}
        <polygon points={pts} fill={shapeFill || 'none'} stroke={shapeStroke} strokeWidth={sw} strokeDasharray={shapeDash} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  if (el.type === 'STAR') {
    const w = el.width
    const h = el.height
    const cx = w / 2
    const cy = h / 2
    const ro = Math.min(w, h) / 2 - sw
    const ri = ro * 0.38
    const p: string[] = []
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2
      const r = i % 2 === 0 ? ro : ri
      p.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`)
    }
    return (
      <svg className="pointer-events-none h-full w-full" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {svgDefs.length > 0 && <defs>{svgDefs}</defs>}
        <polygon points={p.join(' ')} fill={shapeFill || 'none'} stroke={shapeStroke} strokeWidth={sw} strokeDasharray={shapeDash} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  if (el.type === 'ARROW') {
    const w = el.width
    const h = el.height
    const t = Math.min(h * 0.35, w * 0.18)
    const mid = h / 2
    // Direction control via shared arrowStart/arrowEnd flags. Legacy
    // ARROW elements (no flags set) keep their right-pointing look —
    // we only switch geometry when the author explicitly opts in.
    const arrowStart = el.style?.arrowStart === true
    const arrowEnd = el.style?.arrowEnd === true || (!arrowStart && el.style?.arrowEnd !== false)
    const headLen = w * 0.32
    const xLeftHead = arrowStart ? headLen : 0
    const xRightHead = arrowEnd ? w - headLen : w
    let d: string
    if (arrowStart && arrowEnd) {
      // Bidirectional — head on both ends, shaft in the middle.
      d =
        `M ${xLeftHead} ${mid - t / 2} ` +
        `L ${xRightHead} ${mid - t / 2} ` +
        `L ${xRightHead} 0 L ${w} ${mid} L ${xRightHead} ${h} ` +
        `L ${xRightHead} ${mid + t / 2} ` +
        `L ${xLeftHead} ${mid + t / 2} ` +
        `L ${xLeftHead} ${h} L 0 ${mid} L ${xLeftHead} 0 Z`
    } else if (arrowStart) {
      // Left-pointing — head at start, shaft to the right.
      d =
        `M ${w} ${mid - t / 2} ` +
        `L ${xLeftHead} ${mid - t / 2} ` +
        `L ${xLeftHead} 0 L 0 ${mid} L ${xLeftHead} ${h} ` +
        `L ${xLeftHead} ${mid + t / 2} ` +
        `L ${w} ${mid + t / 2} Z`
    } else {
      // Right-pointing (legacy default).
      d =
        `M 0 ${mid - t / 2} ` +
        `L ${xRightHead} ${mid - t / 2} ` +
        `L ${xRightHead} 0 L ${w} ${mid} L ${xRightHead} ${h} ` +
        `L ${xRightHead} ${mid + t / 2} ` +
        `L 0 ${mid + t / 2} Z`
    }
    return (
      <svg className="pointer-events-none h-full w-full" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {svgDefs.length > 0 && <defs>{svgDefs}</defs>}
        <path d={d} fill={shapeFill || 'none'} stroke={shapeStroke} strokeWidth={sw} strokeDasharray={shapeDash} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  if (el.type === 'MERGED_SHAPE' && (el.bezierPath?.length || el.shapePolys?.length)) {
    // Prefer the bezier path when present so curves render true-to-the-
    // editor. `shapePolys` is still kept in sync on every edit for the
    // PDF renderer; here we only reach the polygon branch for shapes
    // that haven't been curved yet.
    const d = el.bezierPath?.length
      ? bezierPathToSvgPathD(el.bezierPath)
      : el.shapePolys!.map(shapePolygonToSvgPathD).join(' ')
    return (
      <svg className="pointer-events-none h-full w-full" viewBox={`0 0 ${el.width} ${el.height}`} aria-hidden>
        {svgDefs.length > 0 && <defs>{svgDefs}</defs>}
        <path
          d={d}
          fill={shapeFill || 'none'}
          fillRule="evenodd"
          stroke={shapeStroke}
          strokeWidth={sw}
          strokeDasharray={shapeDash}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }
  // Gradient background
  const bgCss = resolveBgStyle(el)
  // Gradient text colour (or solid)
  const hasColorGrad = isValidGradient(el.style?.colorGradient)
  const textColorStyle = resolveTextColorStyle(el)
  // Phase 1.5: when we have a measurement for this element id, absolute-position
  // each line; otherwise fall back to CSS flow via RichTextBlockPreview.
  const measurement = useElementMeasurement(el.id)

  return (
    <div
      className={`pointer-events-none h-full w-full overflow-hidden ${el.style?.color?.trim() || hasColorGrad ? '' : 'text-zinc-900 dark:text-zinc-100'}`}
      style={{ fontFamily: coerceToSupportedFamily(el.style?.fontFamily), background: bgCss, ...textColorStyle }}
    >
      <RichTextAbsoluteLines
        content={el.content}
        measurement={measurement}
        variableValues={variableValues}
        variableSurfaceLabelResolver={variableSurfaceLabelResolver}
        fontSize={fs}
        textAlign={align}
        elementBold={el.style?.bold}
        elementItalic={el.style?.italic}
        elementUnderline={el.style?.underline}
        elementStrikethrough={el.style?.strikethrough}
        color={hasColorGrad ? undefined : el.style?.color}
        backgroundColor={isValidGradient(el.style?.bgGradient) ? undefined : el.style?.backgroundColor}
        fontFamily={coerceToSupportedFamily(el.style?.fontFamily)}
        lineHeight={el.style?.lineHeight}
      />
    </div>
  )
}

function RulerCorner({ elRef }: { elRef?: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={(node) => {
        if (elRef) elRef.current = node
      }}
      className="h-[22px] w-[22px] shrink-0 border-b border-r border-zinc-400 bg-zinc-300 dark:border-zinc-600 dark:bg-zinc-700"
      aria-hidden
    />
  )
}

function HorizontalRuler({
  widthPt,
  elRef,
  onPointerDownGuide,
  leftMarginPt,
  rightMarginPt,
  onMarginPointerDown,
}: {
  widthPt: number
  elRef?: RefObject<HTMLDivElement | null>
  onPointerDownGuide?: (e: ReactPointerEvent<HTMLDivElement>) => void
  /** Current left margin in pt — renders a draggable triangle at that x. */
  leftMarginPt?: number
  /** Current right margin in pt — renders a draggable triangle at
   *  `widthPt - rightMarginPt`. */
  rightMarginPt?: number
  /** Parent-provided pointerdown handler for each margin marker. Runs
   *  after marker's own stopPropagation so the ruler's guide-drag
   *  doesn't fire in parallel. */
  onMarginPointerDown?: (
    side: 'left' | 'right',
  ) => (e: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const marks: ReactNode[] = []
  for (let x = 0; x <= widthPt; x += 10) {
    const major = x % 100 === 0 && x > 0
    const mid = x % 50 === 0 && x % 100 !== 0
    const h = major ? 11 : mid ? 8 : 5
    marks.push(
      <div
        key={x}
        className="absolute bottom-0 border-l border-zinc-500 dark:border-zinc-400"
        style={{ left: x, height: h }}
      />
    )
    if (major) {
      marks.push(
        <span
          key={`t-${x}`}
          className="absolute bottom-3 select-none text-[8px] leading-none text-zinc-600 dark:text-zinc-400"
          style={{ left: x + 2 }}
        >
          {x}
        </span>
      )
    }
  }
  const renderMarker = (side: 'left' | 'right', pt: number, tipX: number) =>
    onMarginPointerDown ? (
      <div
        key={`mm-${side}`}
        role="button"
        tabIndex={-1}
        aria-label={`Drag to set ${side} margin (${Math.round(pt)}pt)`}
        title={`Drag to change ${side} margin · ${Math.round(pt)}pt`}
        className="absolute bottom-0 flex h-full w-4 cursor-ew-resize items-end justify-center text-sky-500 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
        style={{ left: tipX - 8 }}
        onPointerDown={(e) => {
          e.stopPropagation()
          onMarginPointerDown(side)(e)
        }}
      >
        <svg width="10" height="8" viewBox="0 0 10 8" className="block">
          <path d="M0 0 L10 0 L5 8 Z" fill="currentColor" />
        </svg>
      </div>
    ) : null
  return (
    <div
      ref={(node) => {
        if (elRef) elRef.current = node
      }}
      className={`relative h-[22px] shrink-0 touch-none select-none border-b border-zinc-400 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 ${onPointerDownGuide ? 'cursor-ns-resize' : ''}`}
      style={{ width: widthPt }}
      onPointerDown={onPointerDownGuide}
    >
      {marks}
      {leftMarginPt != null && renderMarker('left', leftMarginPt, leftMarginPt)}
      {rightMarginPt != null &&
        renderMarker('right', rightMarginPt, widthPt - rightMarginPt)}
    </div>
  )
}

function VerticalRuler({
  heightPt,
  elRef,
  onPointerDownGuide,
  topMarginPt,
  bottomMarginPt,
  onMarginPointerDown,
}: {
  heightPt: number
  elRef?: RefObject<HTMLDivElement | null>
  onPointerDownGuide?: (e: ReactPointerEvent<HTMLDivElement>) => void
  topMarginPt?: number
  bottomMarginPt?: number
  onMarginPointerDown?: (
    side: 'top' | 'bottom',
  ) => (e: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const marks: ReactNode[] = []
  for (let y = 0; y <= heightPt; y += 10) {
    const major = y % 100 === 0 && y > 0
    const mid = y % 50 === 0 && y % 100 !== 0
    const w = major ? 11 : mid ? 8 : 5
    marks.push(
      <div
        key={y}
        className="absolute right-0 border-t border-zinc-500 dark:border-zinc-400"
        style={{ top: y, width: w }}
      />
    )
    if (major) {
      marks.push(
        <span
          key={`t-${y}`}
          className="absolute right-3 select-none text-[8px] leading-none text-zinc-600 dark:text-zinc-400"
          style={{ top: y - 4 }}
        >
          {y}
        </span>
      )
    }
  }
  const renderMarker = (side: 'top' | 'bottom', pt: number, tipY: number) =>
    onMarginPointerDown ? (
      <div
        key={`mm-${side}`}
        role="button"
        tabIndex={-1}
        aria-label={`Drag to set ${side} margin (${Math.round(pt)}pt)`}
        title={`Drag to change ${side} margin · ${Math.round(pt)}pt`}
        className="absolute right-0 flex h-4 w-full cursor-ns-resize items-center justify-end text-sky-500 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
        style={{ top: tipY - 8 }}
        onPointerDown={(e) => {
          e.stopPropagation()
          onMarginPointerDown(side)(e)
        }}
      >
        <svg width="8" height="10" viewBox="0 0 8 10" className="block">
          <path d="M0 0 L0 10 L8 5 Z" fill="currentColor" />
        </svg>
      </div>
    ) : null
  return (
    <div
      ref={(node) => {
        if (elRef) elRef.current = node
      }}
      className={`relative w-[22px] shrink-0 touch-none select-none border-r border-zinc-400 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 ${onPointerDownGuide ? 'cursor-ew-resize' : ''}`}
      style={{ height: heightPt }}
      onPointerDown={onPointerDownGuide}
    >
      {marks}
      {topMarginPt != null && renderMarker('top', topMarginPt, topMarginPt)}
      {bottomMarginPt != null &&
        renderMarker('bottom', bottomMarginPt, heightPt - bottomMarginPt)}
    </div>
  )
}

/** Non-editable regions while editing a HEADER/FOOTER band on a full-page canvas. */
function BandEditOutsideMasks({
  box,
  pageW,
  pageH,
}: {
  box: { x: number; y: number; w: number; h: number }
  pageW: number
  pageH: number
}) {
  const { x, y, w, h } = box
  const maskCls =
    'pointer-events-auto absolute z-[32] bg-zinc-500/30 dark:bg-zinc-950/50 backdrop-blur-[0.5px]'
  const swallow = (e: ReactMouseEvent) => {
    e.stopPropagation()
    useEditorStore.getState().select(null)
  }
  return (
    <>
      <div className={maskCls} style={{ left: 0, top: 0, width: pageW, height: y }} onMouseDown={swallow} aria-hidden />
      <div
        className={maskCls}
        style={{ left: 0, top: y + h, width: pageW, height: Math.max(0, pageH - y - h) }}
        onMouseDown={swallow}
        aria-hidden
      />
      <div className={maskCls} style={{ left: 0, top: y, width: x, height: h }} onMouseDown={swallow} aria-hidden />
      <div
        className={maskCls}
        style={{ left: x + w, top: y, width: Math.max(0, pageW - x - w), height: h }}
        onMouseDown={swallow}
        aria-hidden
      />
    </>
  )
}

export function EditorCanvas({
  exemptFromInlineCommitRef,
}: {
  exemptFromInlineCommitRef: RefObject<HTMLElement | null>
}) {
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const bandCanvasEditElementId = useEditorStore((s) => s.bandCanvasEditElementId)
  const activePageElements = useEditorStore(selectActivePageElements)
  const bandContainerEl = useMemo(() => {
    if (!bandCanvasEditElementId) return null
    const el = findElementByIdInDocument(pages, bandCanvasEditElementId)
    if (!el || (el.type !== 'HEADER' && el.type !== 'FOOTER')) return null
    return el
  }, [bandCanvasEditElementId, pages])
  const elements = bandContainerEl ? (bandContainerEl.bandElements ?? []) : activePageElements

  const variableValues = useEditorStore((s) => s.variableValues)
  const previewData = useMemo(() => variableValuesToDataTree(variableValues), [variableValues])

  // Phase 1.5: drive the backend measurement endpoint from the currently
  // rendered layout. The hook debounces 250ms + caches results by element id;
  // ElementPreview consumes the per-id entry via MeasurementContext and
  // switches to absolute-positioned line rendering when present.
  const measurement = useLayoutMeasurement()
  const editorGlobalVars = useEditorStore((s) => s.globalVariableDefinitions)
  const editorPageSpec = useEditorStore((s) => s.pageSpec)
  const sandbox = useEditorStore((s) => s.sandbox)
  useEffect(() => {
    // No session, so measurement would 401 after every layout change — and the
    // hook's only guard is the pixel-parity feature flag, which defaults on.
    //
    // The cost of skipping it is real and worth naming: without measurements,
    // RichTextAbsoluteLines never engages and text is laid out by CSS flow
    // rather than by the engine that will produce the PDF. So the sandbox
    // canvas is a close approximation of the final document, not a pixel-exact
    // one. The try-templates are drawn with slack around text to keep that
    // difference invisible.
    if (sandbox) return
    const layoutJson = buildLayoutJson(pages, editorPageSpec, editorGlobalVars) as unknown as Record<string, unknown>
    measurement.requestMeasurement(layoutJson, variableValues as unknown as Record<string, unknown>)
    // Dependency intent: remeasure whenever the document shape or preview data
    // changes. `requestMeasurement` is stable across renders (useCallback).
  }, [pages, editorPageSpec, editorGlobalVars, variableValues, measurement.requestMeasurement, sandbox])
  const mergedElements = useMemo(() => {
    if (bandContainerEl) return elements
    const withBands = mergeDocumentBandsIntoPageElements(pages, activePageIndex, activePageElements)
    return mergeFloatingRepeatsIntoPage(pages, activePageIndex, withBands)
  }, [bandContainerEl, elements, pages, activePageIndex, activePageElements])
  const displayElements = useMemo(() => {
    return mergedElements.flatMap((el) => {
      const { visible, element } = resolveLayoutElement(el, previewData, null)
      return visible ? [element] : []
    })
  }, [mergedElements, previewData])
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const divideSourceElements = useMemo(() => {
    if (bandContainerEl) return bandContainerEl.bandElements ?? []
    return pages[activePageIndex]?.elements ?? []
  }, [bandContainerEl, pages, activePageIndex])
  const canDivide = useEditorStore((s) =>
    canDivideSelection({
      selectedIds: s.selectedIds,
      elements: divideSourceElements,
    })
  )
  const addElement = useEditorStore((s) => s.addElement)
  const insertLayoutComponentAt = useEditorStore((s) => s.insertLayoutComponentAt)
  const saveSelectionAsLayoutComponent = useEditorStore((s) => s.saveSelectionAsLayoutComponent)
  const divideSelectionIntoRegions = useEditorStore((s) => s.divideSelectionIntoRegions)
  const select = useEditorStore((s) => s.select)
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const showGrid = useEditorStore((s) => s.showGrid)
  const showRulers = useEditorStore((s) => s.showRulers)
  const gridSize = useEditorStore((s) => s.gridSize)
  const bandEditBox = useMemo(() => {
    if (!bandContainerEl) return null
    const { width: pw, height: ph } = pageDimensionsPt(pageSpec)
    let x = snap(bandContainerEl.x)
    let y = snap(bandContainerEl.y)
    let w = snap(Math.max(16, bandContainerEl.width))
    let h = snap(Math.max(16, bandContainerEl.height))
    x = Math.max(0, Math.min(x, Math.max(0, pw - 16)))
    y = Math.max(0, Math.min(y, Math.max(0, ph - 16)))
    w = Math.max(16, Math.min(w, pw - x))
    h = Math.max(16, Math.min(h, ph - y))
    return { x, y, w, h }
  }, [bandContainerEl, pageSpec])
  const { width: PAGE_W, height: PAGE_H } = pageDimensionsPt(pageSpec)
  const m = pageSpec.margins
  const dragGuides = useEditorStore((s) => s.dragGuides)
  const setCanvasPointerPt = useEditorStore((s) => s.setCanvasPointerPt)
  const setPageMargins = useEditorStore((s) => s.setPageMargins)
  const setSpaceMoveTool = useEditorStore((s) => s.setSpaceMoveTool)
  const spaceMoveTool = useEditorStore((s) => s.spaceMoveTool)
  const canvasTool = useEditorStore((s) => s.canvasTool)
  const canvasZoom = useEditorStore((s) => s.canvasZoom)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const horizontalRulerBoundRef = useRef<HTMLDivElement | null>(null)
  const verticalRulerBoundRef = useRef<HTMLDivElement | null>(null)
  const rulerCornerBoundRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const panSessionRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    sl: number
    st: number
  } | null>(null)
  // Rotation-tool session. When the Rotate tool is active and an element is
  // selected, pointer-down anywhere on the canvas starts dragging to rotate
  // that element around its centre. We store the element id, pivot in client
  // coords, the initial pointer angle, and the element's starting rotation.
  const rotateSessionRef = useRef<{
    pointerId: number
    elementId: string
    /** Element centre in client (screen) pixels — doesn't move during a session. */
    cx: number
    cy: number
    /** Angle (deg) from element centre to pointer at drag start. */
    startAngle: number
    /** Element's `style.rotation` at drag start. */
    startRotation: number
  } | null>(null)

  /**
   * Page-margin drag (ruler triangle markers → live update page-spec
   * margins). Stashed per-pointer so the parent's pointermove can
   * reconstruct the new margin from the initial value + CSS delta.
   * Wrapped in a history batch so the whole drag commits as one undo
   * step instead of pushing a barrier per frame.
   */
  const marginDragSessionRef = useRef<{
    pointerId: number
    side: 'left' | 'right' | 'top' | 'bottom'
    startClient: number
    startMargin: number
  } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [imageModalOpen, setImageModalOpen] = useState(false)
  const pendingImagePosRef = useRef<{ x: number; y: number } | null>(null)
  const [elementContextMenu, setElementContextMenu] = useState<{ x: number; y: number } | null>(null)
  /** Live position (pt) while dragging a new guide from a ruler. */
  const [guideRulerPreview, setGuideRulerPreview] = useState<{
    axis: 'vertical' | 'horizontal'
    pt: number
  } | null>(null)

  const activePageGuidesFromStore = useEditorStore((s) => s.pages[s.activePageIndex]?.guides)
  const activePageGuides = bandContainerEl ? bandContainerEl.bandGuides : activePageGuidesFromStore

  // ── Multi-page stacked render: per-page derived state ────────────
  // Compute the displayed elements for EVERY page (not just the active
  // one). The active page reuses its existing detailed pipeline above;
  // non-active pages get a simpler render path that doesn't include
  // band-edit overlays. Memoised by pages identity + previewData so we
  // don't recompute on every active-page-only state change.
  const setActivePageIndex = useEditorStore((s) => s.setActivePageIndex)
  const displayElementsByPage = useMemo(() => {
    return pages.map((page, pageIndex) => {
      const baseElements = page.elements
      const withBands = mergeDocumentBandsIntoPageElements(pages, pageIndex, baseElements)
      const merged = mergeFloatingRepeatsIntoPage(pages, pageIndex, withBands)
      return merged.flatMap((el) => {
        const { visible, element } = resolveLayoutElement(el, previewData, null)
        return visible ? [element] : []
      })
    })
  }, [pages, previewData])
  // Refs to each page's outer wrapper, so the IntersectionObserver
  // below can decide which page is most-visible while the user scrolls.
  const pageStackRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())

  // Scroll-based active-page detection. As the user scrolls through the
  // stacked pages, we promote whichever page intersects the viewport
  // center to be the "active" one (full editing capabilities). The
  // observer is debounced via state batching — we only call
  // setActivePageIndex when the winning page changes, never every
  // intersection event. Disabled while a band-edit is open (band-edit
  // is scoped to a single element on the active page; switching active
  // pages mid-band-edit would lose the editor's pending changes).
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    if (bandCanvasEditElementId) return
    if (pages.length < 2) return
    let lastWinner = -1
    const visible = new Map<number, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement
          // Outer per-page wrapper carries data-page-index but so does
          // the inner page-canvas div. The inner one is filtered out
          // below at observe-time; this is just an additional guard.
          if (el.hasAttribute('data-agreemint-page-canvas')) continue
          const idx = Number(el.getAttribute('data-page-index'))
          if (!Number.isFinite(idx)) continue
          if (e.isIntersecting) {
            visible.set(idx, e.intersectionRatio)
          } else {
            visible.delete(idx)
          }
        }
        if (visible.size === 0) return
        // Pick the page with the largest intersection ratio. Tie-break
        // by lower index so the document reads top-to-bottom.
        let bestIdx = -1
        let bestRatio = -1
        for (const [idx, ratio] of visible) {
          if (ratio > bestRatio || (ratio === bestRatio && idx < bestIdx)) {
            bestIdx = idx
            bestRatio = ratio
          }
        }
        if (bestIdx >= 0 && bestIdx !== lastWinner) {
          lastWinner = bestIdx
          setActivePageIndex(bestIdx)
        }
      },
      {
        root,
        // Trigger updates as a page crosses the vertical midline.
        // Margin shrinks the root's effective vertical extent so the
        // most-visible page near the center wins, not just any page
        // that's barely peeking in from above/below.
        rootMargin: '-30% 0% -30% 0%',
        threshold: [0, 0.25, 0.5, 0.75, 1.0],
      }
    )
    // Query the DOM directly for per-page wrappers — they all carry
    // [data-page-index] and the OUTER wrappers don't have
    // data-agreemint-page-canvas (which the inner page-canvas div does).
    // Using querySelectorAll instead of the ref map sidesteps any race
    // between ref callbacks and effect timing on rapid page-count changes.
    const pageWrappers = root.querySelectorAll<HTMLElement>(
      '[data-page-index]:not([data-agreemint-page-canvas])'
    )
    for (const el of pageWrappers) observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length, bandCanvasEditElementId, setActivePageIndex])

  const requestImageInsertAt = useCallback((pos: { x: number; y: number }) => {
    pendingImagePosRef.current = pos
    setImageModalOpen(true)
  }, [])

  const dismissImageModal = useCallback(() => {
    pendingImagePosRef.current = null
    setImageModalOpen(false)
  }, [])

  const confirmImageInsert = useCallback(
    (src: string, naturalWidth: number, naturalHeight: number) => {
      const pos = pendingImagePosRef.current
      pendingImagePosRef.current = null
      setImageModalOpen(false)
      if (pos) {
        const MAX_DIM = 300 // max pt dimension on canvas
        let w = naturalWidth
        let h = naturalHeight
        if (w === 0 || h === 0) {
          w = 120
          h = 120
        } else {
          const scale = Math.min(1, MAX_DIM / Math.max(w, h))
          w = Math.round(w * scale)
          h = Math.round(h * scale)
        }
        addElement({ ...createDefaultElement('IMAGE', pos), src: src.trim(), width: w, height: h })
      }
    },
    [addElement]
  )

  const viewOnly = useEditorStore((s) => s.viewOnly)
  const commentingEnabled = useEditorStore((s) => s.commentingEnabled)
  const setEditorSidebarTab = useEditorStore((s) => s.setEditorSidebarTab)

  /**
   * View-only mode: click comment icon → select element, open Comments
   * tab, then trigger the in-app Add-Comment modal (replaces the legacy
   * native window.prompt). The modal reads commentTargetElementId from
   * the store and renders into the TemplateEditor tree.
   */
  const openAddCommentModal = useEditorStore((s) => s.openAddCommentModal)
  const onCommentClick = useCallback(
    (elId: string) => {
      select(elId)
      setEditorSidebarTab('comments')
      openAddCommentModal(elId)
    },
    [select, setEditorSidebarTab, openAddCommentModal],
  )

  const onElementContextMenu = useCallback((e: ReactMouseEvent, elId: string) => {
    const additive = e.metaKey || e.ctrlKey || e.shiftKey
    const st = useEditorStore.getState()
    const inSel = st.selectedIds.includes(elId)
    if (additive && !inSel) {
      st.select(elId, { additive: true })
    } else if (!additive && !inSel) {
      st.select(elId)
    }
    setElementContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  useEffect(() => {
    if (!elementContextMenu) return
    const close = () => setElementContextMenu(null)
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [elementContextMenu])

  const moveGrabActive = spaceMoveTool || canvasTool === 'move'
  const drawMode = canvasTool === 'draw' && !spaceMoveTool

  useEffect(() => {
    if (canvasTool === 'pan') return
    const p = panSessionRef.current
    if (!p) return
    const el = scrollRef.current
    panSessionRef.current = null
    queueMicrotask(() => setIsPanning(false))
    try {
      el?.releasePointerCapture(p.pointerId)
    } catch {
      /* ignore */
    }
  }, [canvasTool])

  useEffect(() => {
    const allowSpaceMove = () => {
      const st = useEditorStore.getState()
      if (st.canvasInlineEditId) return false
      if (st.tableCellEdit) return false
      return !isEditableTarget(document.activeElement)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return
      if (!allowSpaceMove()) return
      e.preventDefault()
      setSpaceMoveTool(true)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return
      setSpaceMoveTool(false)
    }

    const clearTool = () => setSpaceMoveTool(false)

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clearTool()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', clearTool)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', clearTool)
      document.removeEventListener('visibilitychange', onVisibility)
      clearTool()
    }
  }, [setSpaceMoveTool])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      if (isEditableTarget(document.activeElement)) return
      const st = useEditorStore.getState()
      if (st.viewOnly) return
      if (st.canvasInlineEditId) return
      if (st.tableCellEdit) return
      const redo =
        (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.metaKey)
      const undo = key === 'z' && !e.shiftKey
      if (!undo && !redo) return
      e.preventDefault()
      if (undo) st.undo()
      else st.redo()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    if (!bandCanvasEditElementId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isEditableTarget(document.activeElement)) return
      const st = useEditorStore.getState()
      if (st.canvasInlineEditId || st.tableCellEdit) return
      e.preventDefault()
      st.exitBandCanvasEdit()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [bandCanvasEditElementId])

  // ── Escape = step up inside a TABLE ──
  // Figma/Google-Sheets-style hierarchy escape:
  //   cell-edit → cell-selection (handled by TipTap inside the cell editor)
  //   cell-selection → table-element-only selection (this handler)
  // Without this, Escape inside a selected cell (not editing) is a no-op
  // and the user has to mouse over to the new corner handle to get out.
  // Kept as its own effect so the guard is explicit — doesn't fire
  // when a TipTap inline / cell editor has focus, doesn't fire when
  // no table cell is selected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isEditableTarget(document.activeElement)) return
      const st = useEditorStore.getState()
      // Let the cell editor's own Escape handler run first for cell-edit.
      if (st.tableCellEdit) return
      if (st.canvasInlineEditId) return
      const sel = st.tableSelection
      if (!sel) return
      e.preventDefault()
      // Keep the table element selected but drop the cell-level selection.
      st.setTableSelection(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ── Phase 3: arrow-key nudge, Tab cycle, Delete/Backspace ──
  useEffect(() => {
    const canAct = () => {
      if (isEditableTarget(document.activeElement)) return false
      const st = useEditorStore.getState()
      if (st.viewOnly) return false
      return !st.canvasInlineEditId && !st.tableCellEdit
    }
    const onKey = (e: KeyboardEvent) => {
      if (!canAct()) return
      const st = useEditorStore.getState()
      const key = e.key

      // Path-edit mode takes priority on Escape / Delete so the normal
      // Delete = "remove the selected element" path doesn't fire while
      // the user is inside the vertex editor.
      if (st.pathEditingElementId) {
        if (key === 'Escape') {
          e.preventDefault()
          st.exitPathEditMode()
          return
        }
        if (key === 'Delete' || key === 'Backspace') {
          e.preventDefault()
          if (st.pathEditingSelectedVertex) {
            st.removePathVertex(st.pathEditingSelectedVertex)
          }
          // With no selected vertex, swallow the key so we don't kill
          // the shape the user is currently editing.
          return
        }
      }

      // Arrow keys: nudge selected elements (Shift = snap to grid step)
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
        if (st.selectedIds.length === 0) return
        e.preventDefault()
        const step = e.shiftKey ? st.gridSize : 1
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
        for (const id of st.selectedIds) {
          const els = st.pages[st.activePageIndex]?.elements ?? []
          const el = els.find((e) => e.id === id)
          if (el && !el.locked) {
            st.updateElement(id, { x: el.x + dx, y: el.y + dy }, { skipHistory: true })
          }
        }
        return
      }

      // Tab / Shift+Tab: cycle selection through elements
      if (key === 'Tab') {
        const els = st.pages[st.activePageIndex]?.elements ?? []
        if (els.length === 0) return
        e.preventDefault()
        const currentId = st.selectedIds[0]
        const currentIdx = currentId ? els.findIndex((e) => e.id === currentId) : -1
        const next = e.shiftKey
          ? (currentIdx <= 0 ? els.length - 1 : currentIdx - 1)
          : (currentIdx >= els.length - 1 ? 0 : currentIdx + 1)
        st.select(els[next].id)
        return
      }

      // Delete / Backspace: remove selected elements
      if (key === 'Delete' || key === 'Backspace') {
        if (st.selectedIds.length === 0) return
        e.preventDefault()
        st.removeElements(st.selectedIds)
        return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ── Phase 3: copy / paste / cut / duplicate ──
  useEffect(() => {
    const canAct = () => {
      if (isEditableTarget(document.activeElement)) return false
      const st = useEditorStore.getState()
      if (st.viewOnly) return false
      return !st.canvasInlineEditId && !st.tableCellEdit
    }
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      if (!canAct()) return
      const key = e.key.toLowerCase()
      const st = useEditorStore.getState()

      // ⌘C / Ctrl+C: copy
      if (key === 'c' && !e.shiftKey) {
        if (st.selectedIds.length === 0) return
        e.preventDefault()
        const els = (st.pages[st.activePageIndex]?.elements ?? []).filter(
          (el) => st.selectedIds.includes(el.id)
        )
        void copyElementsToClipboard(els)
        return
      }

      // ⌘V / Ctrl+V: paste
      if (key === 'v' && !e.shiftKey) {
        e.preventDefault()
        void pasteElementsFromClipboard().then((clones) => {
          if (!clones?.length) return
          const s = useEditorStore.getState()
          for (const el of clones) {
            s.addElement(el)
          }
          s.select(null)
          for (const el of clones) {
            s.select(el.id, { additive: true })
          }
        })
        return
      }

      // ⌘X / Ctrl+X: cut
      if (key === 'x' && !e.shiftKey) {
        if (st.selectedIds.length === 0) return
        e.preventDefault()
        const els = (st.pages[st.activePageIndex]?.elements ?? []).filter(
          (el) => st.selectedIds.includes(el.id)
        )
        void copyElementsToClipboard(els)
        st.removeElements(st.selectedIds)
        return
      }

      // ��D / Ctrl+D: duplicate in place
      if (key === 'd' && !e.shiftKey) {
        if (st.selectedIds.length === 0) return
        e.preventDefault()
        st.duplicateElements(st.selectedIds)
        return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const onDropNew = useCallback(
    (clientX: number, clientY: number) => {
      if (useEditorStore.getState().viewOnly) return undefined
      const node = canvasRef.current
      if (!node) return undefined
      const rect = node.getBoundingClientRect()
      const z = useEditorStore.getState().canvasZoom
      const x = snap((clientX - rect.left) / z)
      const y = snap((clientY - rect.top) / z)
      if (bandEditBox) {
        const { x: bx, y: by, w: bw, h: bh } = bandEditBox
        if (x < bx || y < by || x > bx + bw || y > by + bh) return undefined
        return { x: snap(x - bx), y: snap(y - by) }
      }
      return { x, y }
    },
    [bandEditBox]
  )

  /**
   * Start dragging a margin triangle on one of the rulers. Opens a
   * history batch so the N pointermove-driven {@link setPageMargins}
   * calls collapse into a single undo step. Attaches window listeners
   * (rather than relying on the ruler's own handlers) so the drag keeps
   * tracking even when the cursor leaves the ruler — same pattern as
   * the element drag flow.
   */
  const onMarginMarkerPointerDown = useCallback(
    (side: 'left' | 'right' | 'top' | 'bottom') =>
      (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return
        if (useEditorStore.getState().viewOnly) return
        e.preventDefault()
        const st0 = useEditorStore.getState()
        const startMargin = st0.pageSpec.margins[side] ?? 0
        const startClient = side === 'left' || side === 'right' ? e.clientX : e.clientY
        marginDragSessionRef.current = {
          pointerId: e.pointerId,
          side,
          startClient,
          startMargin,
        }
        st0.beginHistoryBatch()

        const onMove = (ev: PointerEvent) => {
          const drag = marginDragSessionRef.current
          if (!drag || drag.pointerId !== ev.pointerId) return
          ev.preventDefault()
          const st = useEditorStore.getState()
          const z = st.canvasZoom
          const curClient = side === 'left' || side === 'right' ? ev.clientX : ev.clientY
          // Margin coordinate grows INTO the page — for the right/bottom
          // sides, dragging "outward" (increasing clientX/Y) shrinks the
          // margin, so flip the sign.
          const signed = (curClient - drag.startClient) / z
          const dir = side === 'left' || side === 'top' ? 1 : -1
          const raw = drag.startMargin + dir * signed
          // Clamp: don't collapse margins onto each other. Leave at
          // least 20pt of content space between the two opposing margins.
          const { width: pw, height: ph } = pageDimensionsPt(st.pageSpec)
          const axisLen = side === 'left' || side === 'right' ? pw : ph
          const other = side === 'left'
            ? st.pageSpec.margins.right
            : side === 'right'
              ? st.pageSpec.margins.left
              : side === 'top'
                ? st.pageSpec.margins.bottom
                : st.pageSpec.margins.top
          const maxMargin = Math.max(0, axisLen - other - 20)
          const clamped = Math.max(0, Math.min(maxMargin, raw))
          st.setPageMargins({ [side]: clamped })
        }

        const onUp = (ev: PointerEvent) => {
          const drag = marginDragSessionRef.current
          if (!drag || drag.pointerId !== ev.pointerId) return
          marginDragSessionRef.current = null
          useEditorStore.getState().endHistoryBatch()
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      },
    [],
  )

  const onRulerGuidePointerDown = useCallback(
    (axis: 'vertical' | 'horizontal') => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      if (useEditorStore.getState().canvasTool === 'pan') return
      e.preventDefault()
      e.stopPropagation()
      const node = canvasRef.current
      if (!node) return
      const pointerId = e.pointerId
      const target = e.currentTarget
      try {
        target.setPointerCapture(pointerId)
      } catch {
        /* ignore */
      }

      const pagePtFromClient = (clientX: number, clientY: number) => {
        const r = node.getBoundingClientRect()
        const z = useEditorStore.getState().canvasZoom
        return {
          x: (clientX - r.left) / z,
          y: (clientY - r.top) / z,
          r,
        }
      }

      const updatePreview = (clientX: number, clientY: number) => {
        const st = useEditorStore.getState()
        const { width: pw, height: ph } = pageDimensionsPt(st.pageSpec)
        const cBand =
          st.bandNestedEditorMounted && st.bandCanvasEditElementId
            ? findElementByIdInDocument(st.pages, st.bandCanvasEditElementId)
            : null
        const bh = cBand ? Math.max(16, cBand.height) : ph
        const by = cBand?.y ?? 0
        const { x, y } = pagePtFromClient(clientX, clientY)
        if (axis === 'vertical') {
          setGuideRulerPreview({ axis: 'vertical', pt: Math.max(0, Math.min(pw, x)) })
        } else {
          const yLocal = cBand ? y - by : y
          setGuideRulerPreview({ axis: 'horizontal', pt: Math.max(0, Math.min(bh, yLocal)) })
        }
      }

      updatePreview(e.clientX, e.clientY)

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        updatePreview(ev.clientX, ev.clientY)
      }

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        setGuideRulerPreview(null)
        try {
          target.releasePointerCapture(pointerId)
        } catch {
          /* ignore */
        }
        const { x, y, r } = pagePtFromClient(ev.clientX, ev.clientY)
        const inside =
          ev.clientX >= r.left &&
          ev.clientX <= r.right &&
          ev.clientY >= r.top &&
          ev.clientY <= r.bottom
        if (!inside) return
        const st = useEditorStore.getState()
        const { width: pw, height: ph } = pageDimensionsPt(st.pageSpec)
        const bw = pw
        const cBand =
          st.bandNestedEditorMounted && st.bandCanvasEditElementId
            ? findElementByIdInDocument(st.pages, st.bandCanvasEditElementId)
            : null
        const bh = cBand ? Math.max(16, cBand.height) : ph
        const by = cBand?.y ?? 0
        if (axis === 'vertical') {
          if (st.bandNestedEditorMounted && st.bandCanvasEditElementId) {
            st.addActiveBandGuide('vertical', Math.max(0, Math.min(bw, x)))
          } else {
            st.addActivePageGuide('vertical', Math.max(0, Math.min(pw, x)))
          }
        } else if (st.bandNestedEditorMounted && st.bandCanvasEditElementId && cBand) {
          st.addActiveBandGuide('horizontal', Math.max(0, Math.min(bh, y - by)))
        } else {
          st.addActivePageGuide('horizontal', Math.max(0, Math.min(ph, y)))
        }
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    []
  )

  const onExistingGuidePointerDown = useCallback(
    (axis: 'vertical' | 'horizontal', index: number, linePt: number) =>
      (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return
        if (useEditorStore.getState().canvasTool === 'pan') return
        e.preventDefault()
        e.stopPropagation()
        if (e.altKey) {
          const st0 = useEditorStore.getState()
          if (st0.bandNestedEditorMounted && st0.bandCanvasEditElementId) {
            st0.removeActiveBandGuideAt(axis, index)
          } else {
            st0.removeActivePageGuideAt(axis, index)
          }
          return
        }

        const node = canvasRef.current
        if (!node) return
        const pointerId = e.pointerId
        const target = e.currentTarget
        try {
          target.setPointerCapture(pointerId)
        } catch {
          /* ignore */
        }

        const stBand = useEditorStore.getState()
        const bandGuideCtx =
          stBand.bandNestedEditorMounted && stBand.bandCanvasEditElementId
            ? findElementByIdInDocument(stBand.pages, stBand.bandCanvasEditElementId)
            : null
        const bandGuideY0 = bandGuideCtx?.y ?? 0

        const pagePtFromClient = (clientX: number, clientY: number) => {
          const r = node.getBoundingClientRect()
          const z = useEditorStore.getState().canvasZoom
          return {
            x: (clientX - r.left) / z,
            y: (clientY - r.top) / z,
          }
        }

        const startClient = { x: e.clientX, y: e.clientY }
        const startPage = pagePtFromClient(startClient.x, startClient.y)
        const startYForOffset =
          axis === 'horizontal' && bandGuideCtx ? startPage.y - bandGuideY0 : startPage.y
        const offset =
          axis === 'vertical' ? linePt - startPage.x : linePt - startYForOffset
        let historyStarted = false
        let lastPt = snap(linePt)
        const indexRef = { current: index }

        const dropOnRulerToRemove = (clientX: number, clientY: number) => {
          if (axis === 'horizontal') {
            return (
              clientInElement(clientX, clientY, horizontalRulerBoundRef.current) ||
              clientInElement(clientX, clientY, rulerCornerBoundRef.current)
            )
          }
          return (
            clientInElement(clientX, clientY, verticalRulerBoundRef.current) ||
            clientInElement(clientX, clientY, rulerCornerBoundRef.current)
          )
        }

        const endBatchIfNeeded = () => {
          if (historyStarted) {
            historyStarted = false
            useEditorStore.getState().endHistoryBatch()
          }
        }

        const onMove = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return
          const dx = ev.clientX - startClient.x
          const dy = ev.clientY - startClient.y
          if (!historyStarted && dx * dx + dy * dy >= GUIDE_DRAG_THRESHOLD_PX ** 2) {
            historyStarted = true
            useEditorStore.getState().beginHistoryBatch()
          }
          if (!historyStarted) return

          const st = useEditorStore.getState()
          const { width: pw, height: ph } = pageDimensionsPt(st.pageSpec)
          const bh =
            bandGuideCtx && st.bandNestedEditorMounted
              ? Math.max(16, bandGuideCtx.height)
              : ph
          const p = pagePtFromClient(ev.clientX, ev.clientY)
          const pY = bandGuideCtx && axis === 'horizontal' ? p.y - bandGuideY0 : p.y
          const raw = axis === 'vertical' ? p.x - offset : pY - offset
          const clamped =
            axis === 'vertical'
              ? Math.max(0, Math.min(pw, raw))
              : Math.max(0, Math.min(bh, raw))
          lastPt = snap(clamped)
          if (st.bandNestedEditorMounted && st.bandCanvasEditElementId) {
            st.moveActiveBandGuide(axis, indexRef.current, lastPt)
            const st2 = useEditorStore.getState()
            const c = findElementByIdInDocument(st2.pages, st2.bandCanvasEditElementId!)
            const arr =
              axis === 'vertical' ? c?.bandGuides?.vertical : c?.bandGuides?.horizontal
            const ni = arr?.indexOf(lastPt) ?? -1
            if (ni >= 0) indexRef.current = ni
          } else {
            st.moveActivePageGuide(axis, indexRef.current, lastPt)
            const st2 = useEditorStore.getState()
            const arr =
              axis === 'vertical'
                ? st2.pages[st2.activePageIndex]?.guides?.vertical
                : st2.pages[st2.activePageIndex]?.guides?.horizontal
            const ni = arr?.indexOf(lastPt) ?? -1
            if (ni >= 0) indexRef.current = ni
          }
        }

        const onUp = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          try {
            target.releasePointerCapture(pointerId)
          } catch {
            /* ignore */
          }

          if (dropOnRulerToRemove(ev.clientX, ev.clientY)) {
            endBatchIfNeeded()
            const st = useEditorStore.getState()
            if (st.bandNestedEditorMounted && st.bandCanvasEditElementId) {
              const c = findElementByIdInDocument(st.pages, st.bandCanvasEditElementId)
              const arr =
                axis === 'vertical' ? c?.bandGuides?.vertical : c?.bandGuides?.horizontal
              const idx = arr?.indexOf(lastPt) ?? -1
              if (idx >= 0) st.removeActiveBandGuideAt(axis, idx)
            } else {
              const arr =
                axis === 'vertical'
                  ? st.pages[st.activePageIndex]?.guides?.vertical
                  : st.pages[st.activePageIndex]?.guides?.horizontal
              const idx = arr?.indexOf(lastPt) ?? -1
              if (idx >= 0) st.removeActivePageGuideAt(axis, idx)
            }
            return
          }

          endBatchIfNeeded()
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      },
    []
  )

  const [, drop] = useDrop<NewElementDragItem | LayoutComponentDragItem, void, unknown>(
    () => ({
      accept: [DND_NEW, DND_COMPONENT],
      drop(item, monitor) {
        const st = useEditorStore.getState()
        if (
          item.type === DND_NEW &&
          (item.elementType === 'HEADER' || item.elementType === 'FOOTER') &&
          st.bandNestedEditorMounted
        ) {
          return
        }
        const off = monitor.getClientOffset()
        if (!off) return
        const pos = onDropNew(off.x, off.y)
        if (!pos) return
        if (item.type === DND_COMPONENT) {
          insertLayoutComponentAt(item.componentId, pos)
          return
        }
        if (item.elementType === 'IMAGE') {
          requestImageInsertAt(pos)
          return
        }
        addElement(createDefaultElement(item.elementType, pos))
      },
    }),
    [addElement, insertLayoutComponentAt, onDropNew, requestImageInsertAt]
  )

  const connectDropRef = useCallback(
    (el: HTMLDivElement | null) => {
      canvasRef.current = el
      drop(el)
    },
    [drop]
  )

  const onPageMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      const z = useEditorStore.getState().canvasZoom
      setCanvasPointerPt({
        x: Math.round((e.clientX - r.left) / z),
        y: Math.round((e.clientY - r.top) / z),
      })
    },
    [setCanvasPointerPt]
  )

  /**
   * Adjust `canvasZoom` around a fixed client point so the spot under
   * the user's cursor / pinch midpoint stays visually pinned while the
   * rest of the canvas grows or shrinks. Used by both the trackpad /
   * Ctrl-wheel gesture and the two-finger touch pinch below.
   *
   * Technique: stash the document-space point under the cursor,
   * update the store's zoom, then on the next frame re-measure the
   * canvas rect and nudge `scrollLeft/Top` by the delta so that doc
   * point lands at the same client coord again.
   */
  const zoomAtCursor = useCallback((factor: number, clientX: number, clientY: number) => {
    const canvasNode = canvasRef.current
    const scrollNode = scrollRef.current
    if (!canvasNode || !scrollNode) return
    const st = useEditorStore.getState()
    const z0 = st.canvasZoom
    const raw = z0 * factor
    const z1 = Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, Math.round(raw * 100) / 100))
    if (z1 === z0) return
    const before = canvasNode.getBoundingClientRect()
    const docX = (clientX - before.left) / z0
    const docY = (clientY - before.top) / z0
    st.setCanvasZoom(z1)
    // After React commits the zoom, the canvas rect has moved — re-measure
    // and adjust the scroll offset to keep the doc point under the cursor.
    requestAnimationFrame(() => {
      const after = canvasNode.getBoundingClientRect()
      const desiredLeft = clientX - docX * z1
      const desiredTop = clientY - docY * z1
      scrollNode.scrollLeft += after.left - desiredLeft
      scrollNode.scrollTop += after.top - desiredTop
    })
  }, [])

  /** Ctrl/Cmd + wheel zooms on desktop; trackpad pinch on macOS also
   *  arrives as a wheel event with `ctrlKey = true`. preventDefault has
   *  to fire for the browser to let us own the gesture, which means we
   *  can't use React's synthetic wheel (its listeners are passive in
   *  modern React). Attached via native addEventListener below. */
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onWheel = (e: WheelEvent) => {
      // Only hijack the event when the user is clearly asking for zoom
      // (modifier held or trackpad pinch). Plain two-finger scroll falls
      // through untouched so vertical / horizontal scroll still works.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // Treat deltaY as pixels moved — exp() maps linearly into a geometric
      // zoom step. 0.01 keeps pinch gestures smooth, no per-tick jumps.
      const factor = Math.exp(-e.deltaY * 0.01)
      zoomAtCursor(factor, e.clientX, e.clientY)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [zoomAtCursor])

  /** Two-finger touch pinch. Desktop trackpad pinch is covered above by
   *  the wheel handler; this path wires up native pinch on touchscreens.
   *  We track touch-type pointers in a Map and, whenever two are down,
   *  derive zoom from the ratio of the current distance to the distance
   *  at the last move. */
  const pinchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchSessionRef = useRef<{ lastDistance: number } | null>(null)

  const onScrollPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollRef.current
      if (!el) return

      // Two-finger pinch bookkeeping — only for 'touch' pointers so the
      // mouse path below isn't disturbed.
      if (e.pointerType === 'touch') {
        pinchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pinchPointersRef.current.size === 2) {
          const pts = Array.from(pinchPointersRef.current.values())
          pinchSessionRef.current = {
            lastDistance: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y),
          }
          e.preventDefault()
          e.stopPropagation()
          return
        }
      }

      // ── Rotate tool ─────────────────────────────────────────────────────
      // When the rotate tool is active and there's a single selected
      // element, pointer-down starts a rotation session. Dragging anywhere
      // rotates the element around its rendered centre.
      if (canvasTool === 'rotate' && e.button === 0) {
        const st0 = useEditorStore.getState()
        const selId = st0.selectedIds[0]
        if (!selId || st0.selectedIds.length !== 1) return
        const pageEls = st0.pages[st0.activePageIndex]?.elements ?? []
        const elemObj = pageEls.find((x) => x.id === selId)
        const canvasNode = canvasRef.current
        if (!elemObj || !canvasNode) return
        const rect = canvasNode.getBoundingClientRect()
        const z = st0.canvasZoom
        const cx = rect.left + (elemObj.x + elemObj.width / 2) * z
        const cy = rect.top + (elemObj.y + elemObj.height / 2) * z
        const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI)
        e.preventDefault()
        e.stopPropagation()
        rotateSessionRef.current = {
          pointerId: e.pointerId,
          elementId: selId,
          cx,
          cy,
          startAngle,
          startRotation: elemObj.style?.rotation ?? 0,
        }
        try {
          el.setPointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        return
      }

      if (canvasTool !== 'pan' || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      panSessionRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        sl: el.scrollLeft,
        st: el.scrollTop,
      }
      setIsPanning(true)
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    [canvasTool]
  )

  const onScrollPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Pinch tracking: refresh the pointer's position and, when two
    // touches are active, derive a zoom factor from the ratio of the
    // current pair distance to the last one.
    if (e.pointerType === 'touch' && pinchPointersRef.current.has(e.pointerId)) {
      pinchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const session = pinchSessionRef.current
      if (session && pinchPointersRef.current.size === 2) {
        const pts = Array.from(pinchPointersRef.current.values())
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
        if (dist > 0 && session.lastDistance > 0) {
          const factor = dist / session.lastDistance
          const midX = (pts[0]!.x + pts[1]!.x) / 2
          const midY = (pts[0]!.y + pts[1]!.y) / 2
          zoomAtCursor(factor, midX, midY)
          session.lastDistance = dist
        }
        return
      }
    }

    // Rotate session: update style.rotation live as the pointer moves.
    // Holding Shift snaps to 15° increments so users can land on 45/90/etc.
    const r = rotateSessionRef.current
    if (r && r.pointerId === e.pointerId) {
      const current = Math.atan2(e.clientY - r.cy, e.clientX - r.cx) * (180 / Math.PI)
      let next = r.startRotation + (current - r.startAngle)
      if (e.shiftKey) next = Math.round(next / 15) * 15
      // Normalise to (-180, 180] so the number input doesn't spiral.
      next = ((next % 360) + 540) % 360 - 180
      useEditorStore.getState().updateElement(
        r.elementId,
        { style: { ...(useEditorStore.getState().pages[useEditorStore.getState().activePageIndex]?.elements.find((x) => x.id === r.elementId)?.style ?? {}), rotation: next } },
        { skipHistory: true },
      )
      return
    }

    const p = panSessionRef.current
    if (!p || p.pointerId !== e.pointerId) return
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = p.sl - (e.clientX - p.startX)
    el.scrollTop = p.st - (e.clientY - p.startY)
  }, [])

  const onScrollPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // End pinch: drop this pointer from the map. When we're back to
    // fewer than 2 active touches the session ends.
    if (e.pointerType === 'touch' && pinchPointersRef.current.has(e.pointerId)) {
      pinchPointersRef.current.delete(e.pointerId)
      if (pinchPointersRef.current.size < 2) pinchSessionRef.current = null
      return
    }

    // End rotate session — commit a history entry by calling updateElement
    // one last time without skipHistory so the user can Ctrl+Z the whole
    // drag as one step rather than N incremental frames.
    const r = rotateSessionRef.current
    if (r && r.pointerId === e.pointerId) {
      const state = useEditorStore.getState()
      const pageEls = state.pages[state.activePageIndex]?.elements ?? []
      const finalEl = pageEls.find((x) => x.id === r.elementId)
      rotateSessionRef.current = null
      try {
        scrollRef.current?.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (finalEl) {
        state.updateElement(r.elementId, { style: { ...(finalEl.style ?? {}) } })
      }
      return
    }

    const p = panSessionRef.current
    if (!p || p.pointerId !== e.pointerId) return
    const el = scrollRef.current
    panSessionRef.current = null
    setIsPanning(false)
    try {
      el?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const scrollCursorClass =
    canvasTool === 'pan'
      ? isPanning
        ? 'cursor-grabbing'
        : 'cursor-grab'
      : canvasTool === 'rotate'
        ? 'cursor-crosshair'
        : moveGrabActive
          ? 'cursor-grab'
          : drawMode
            ? 'cursor-crosshair'
            : ''

  const scrollTitle =
    canvasTool === 'pan'
      ? 'Drag to pan the canvas'
      : canvasTool === 'rotate'
        ? 'Rotate tool — select an element, then drag to rotate (hold Shift to snap to 15°)'
        : spaceMoveTool
            ? 'Release Space to exit quick move'
            : canvasTool === 'move'
              ? 'Move tool — drag elements without a long press'
              : drawMode
                ? 'Click the page to place the selected block'
                : undefined

  const selectionBounds = useMemo(() => {
    if (selectedIds.length < 2) return null
    const idSet = new Set(selectedIds)
    const boxes = displayElements.filter((e) => idSet.has(e.id))
    if (boxes.length < 2) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const e of boxes) {
      minX = Math.min(minX, e.x)
      minY = Math.min(minY, e.y)
      maxX = Math.max(maxX, e.x + e.width)
      maxY = Math.max(maxY, e.y + e.height)
    }
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY }
  }, [displayElements, selectedIds])

  const gOx = bandEditBox?.x ?? 0
  const gOy = bandEditBox?.y ?? 0
  const gGuideH = bandEditBox?.h ?? PAGE_H

  /* ── Marquee / rubber-band selection ────────────────────────────────
   * Active only under the Select tool. pointerdown on the page surface
   * (below the element layer) opens a marquee session; pointermove
   * updates the translucent rectangle; pointerup picks up every element
   * whose axis-aligned bbox intersects it. A drag below {@link
   * MARQUEE_THRESHOLD_PT} is treated as a plain click (deselect).
   * Shift-drag adds to the existing selection instead of replacing.
   * Skipped in band-edit mode (coordinate spaces differ). */
  const MARQUEE_THRESHOLD_PT = 3
  const marqueeSessionRef = useRef<{
    pointerId: number
    startX: number // document pt
    startY: number
    additive: boolean
  } | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<
    | { x: number; y: number; w: number; h: number }
    | null
  >(null)
  const selectMany = useEditorStore((s) => s.selectMany)

  const clientToPagePt = useCallback((clientX: number, clientY: number) => {
    const node = canvasRef.current
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const z = useEditorStore.getState().canvasZoom
    return {
      x: (clientX - rect.left) / z,
      y: (clientY - rect.top) / z,
    }
  }, [])

  const onPageMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setElementContextMenu(null)
      if (e.button !== 0) return
      const st = useEditorStore.getState()
      if (st.canvasTool === 'draw' && !st.spaceMoveTool && !st.viewOnly) {
        const node = canvasRef.current
        if (!node) return
        if (
          st.bandNestedEditorMounted &&
          (st.placementElementType === 'HEADER' || st.placementElementType === 'FOOTER')
        ) {
          return
        }
        const rect = node.getBoundingClientRect()
        const z = st.canvasZoom
        const x = snap((e.clientX - rect.left) / z)
        const y = snap((e.clientY - rect.top) / z)
        let placeX = x
        let placeY = y
        if (st.bandNestedEditorMounted && st.bandCanvasEditElementId) {
          const c = findElementByIdInDocument(st.pages, st.bandCanvasEditElementId)
          if (c && (c.type === 'HEADER' || c.type === 'FOOTER')) {
            const lx = x - c.x
            const ly = y - c.y
            if (lx < 0 || ly < 0 || lx > c.width || ly > c.height) return
            placeX = lx
            placeY = ly
          }
        }
        if (st.placementElementType === 'IMAGE') {
          requestImageInsertAt({ x: placeX, y: placeY })
          return
        }
        addElement(createDefaultElement(st.placementElementType, { x: placeX, y: placeY }))
        return
      }
      // Select tool default on empty canvas: open a marquee session. The
      // pointerup handler below decides between "bulk select" and "plain
      // click deselect" based on drag distance. Shift adds to the
      // existing selection.
      if (
        st.canvasTool === 'select' &&
        !st.bandCanvasEditElementId &&
        !st.canvasInlineEditId &&
        !st.spaceMoveTool
      ) {
        const pt = clientToPagePt(e.clientX, e.clientY)
        if (pt) {
          marqueeSessionRef.current = {
            pointerId: -1, // mousedown event; no pointerId. The pointermove
                           // listener below accepts any id while a session is
                           // live.
            startX: pt.x,
            startY: pt.y,
            additive: e.shiftKey || e.metaKey || e.ctrlKey,
          }
          // Don't deselect yet — the pointerup handler does that if
          // it turns out to be a click, not a drag.
          return
        }
      }
      select(null)
    },
    [addElement, select, requestImageInsertAt, clientToPagePt]
  )

  const onPagePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const session = marqueeSessionRef.current
      if (!session) return
      const pt = clientToPagePt(e.clientX, e.clientY)
      if (!pt) return
      const dx = pt.x - session.startX
      const dy = pt.y - session.startY
      if (Math.abs(dx) < MARQUEE_THRESHOLD_PT && Math.abs(dy) < MARQUEE_THRESHOLD_PT) {
        setMarqueeRect(null)
        return
      }
      const x = Math.min(session.startX, pt.x)
      const y = Math.min(session.startY, pt.y)
      const w = Math.abs(dx)
      const h = Math.abs(dy)
      setMarqueeRect({ x, y, w, h })
    },
    [clientToPagePt],
  )

  const onPagePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const session = marqueeSessionRef.current
      if (!session) return
      marqueeSessionRef.current = null
      const pt = clientToPagePt(e.clientX, e.clientY)
      if (!pt) {
        setMarqueeRect(null)
        return
      }
      const dx = pt.x - session.startX
      const dy = pt.y - session.startY
      const meaningfulDrag =
        Math.abs(dx) >= MARQUEE_THRESHOLD_PT || Math.abs(dy) >= MARQUEE_THRESHOLD_PT
      if (!meaningfulDrag) {
        // Plain click on empty canvas → preserve existing behaviour.
        setMarqueeRect(null)
        if (!session.additive) useEditorStore.getState().select(null)
        return
      }
      const mx = Math.min(session.startX, pt.x)
      const my = Math.min(session.startY, pt.y)
      const mw = Math.abs(dx)
      const mh = Math.abs(dy)
      // AABB intersection against every element on the active page.
      // `displayElements` is what's on-canvas after visibility resolves —
      // matches what the user actually sees.
      const hits: string[] = []
      for (const el of displayElements) {
        if (
          el.x + el.width < mx ||
          el.x > mx + mw ||
          el.y + el.height < my ||
          el.y > my + mh
        ) {
          continue
        }
        hits.push(el.id)
      }
      setMarqueeRect(null)
      if (hits.length === 0) {
        // Empty drag — treat like a plain click so the user doesn't
        // end up with a stale selection.
        if (!session.additive) useEditorStore.getState().select(null)
        return
      }
      selectMany(hits, { additive: session.additive })
    },
    [clientToPagePt, displayElements, selectMany],
  )

  return (
    <MeasurementProvider value={measurement.byId}>
    <>
    <div
      ref={scrollRef}
      data-agreemint-canvas-root
      className={`relative am-scrollbar-none min-w-0 flex-1 overflow-auto bg-zinc-200/80 p-6 dark:bg-zinc-950 ${scrollCursorClass}`}
      title={scrollTitle}
      // `pan-x pan-y` reserves one-finger scroll for the browser while
      // keeping two-finger pinch for us (instead of the native page
      // zoom). Pointer events still fire so our pinch tracker works.
      style={{ touchAction: 'pan-x pan-y' }}
      onPointerDownCapture={onScrollPointerDownCapture}
      onPointerMove={onScrollPointerMove}
      onPointerUp={onScrollPointerUp}
      onPointerCancel={onScrollPointerUp}
    >
      {/* Full-width horizontal band tinting the area around the active
          page. Extends edge-to-edge across the scroller (left:0 right:0)
          and tracks the active page's vertical position so the user can
          see at a glance which page they're editing without the tint
          being clipped to the page's narrow column. */}
      {pages.length > 1 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bg-sky-100/70 dark:bg-sky-950/40"
          style={{
            // p-6 (24px) padding on the scroller pushes the content
            // down by 24px before the first page starts; mirror that
            // here so the band aligns with the active page's top edge.
            top: 24 + activePageIndex * ((22 + PAGE_H + 32) * canvasZoom),
            height: (22 + PAGE_H) * canvasZoom,
          }}
        />
      )}
      <div
        className="relative mx-auto min-w-0"
        style={{
          width: (22 + PAGE_W) * canvasZoom,
          // Stack: each page = ruler-band(22pt) + page-canvas(PAGE_H).
          // Between pages add a vertical gap of MULTI_PAGE_GAP_PT so the
          // user can see a visible seam (and so the active-page bg tint
          // reads as "around" the page, not bleeding into neighbours).
          height: (pages.length * (22 + PAGE_H) + Math.max(0, pages.length - 1) * 32) * canvasZoom,
        }}
      >
        <div
          className="inline-block min-w-0 origin-top-left"
          style={{
            transform: `scale(${canvasZoom})`,
            // ALWAYS reserve the 22pt ruler gutter on each axis — even when
            // rulers are toggled off. Otherwise, dropping the gutter shrinks
            // this inner box by 22pt and the page jumps up-and-left inside
            // the scroll viewport. Hiding rulers swaps their content for
            // empty spacers below; the page's position relative to the
            // outer scroll container stays rock-steady.
            width: 22 + PAGE_W,
            height: pages.length * (22 + PAGE_H) + Math.max(0, pages.length - 1) * 32,
          }}
        >
          <div className="flex flex-col" style={{ gap: 32 }}>
          {pages.map((stackedPage, stackedPageIndex) => {
            const isActivePage = stackedPageIndex === activePageIndex
            const pageDisplayElements = isActivePage
              ? displayElements
              : (displayElementsByPage[stackedPageIndex] ?? [])
            return (
            <div
              key={stackedPage.id}
              ref={(el) => {
                if (el) pageStackRefs.current.set(stackedPageIndex, el)
                else pageStackRefs.current.delete(stackedPageIndex)
              }}
              data-page-index={stackedPageIndex}
              className={
                'flex flex-col rounded transition-colors ' +
                (isActivePage
                  ? 'bg-sky-100/70 dark:bg-sky-950/40'
                  : 'bg-transparent hover:bg-zinc-300/40 dark:hover:bg-zinc-900/40 cursor-pointer')
              }
              onClickCapture={
                isActivePage
                  ? undefined
                  : (e) => {
                      e.stopPropagation()
                      setActivePageIndex(stackedPageIndex)
                    }
              }
              // Element selection / drag uses pointerdown / mousedown,
              // not click — gate those in capture phase too so a single
              // tap on a non-active page activates it without selecting
              // or dragging the element under the cursor.
              onMouseDownCapture={
                isActivePage
                  ? undefined
                  : (e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setActivePageIndex(stackedPageIndex)
                    }
              }
              onPointerDownCapture={
                isActivePage
                  ? undefined
                  : (e) => {
                      e.stopPropagation()
                      setActivePageIndex(stackedPageIndex)
                    }
              }
            >
          <div className="flex" style={{ height: 22 }}>
            {showRulers && isActivePage ? (
              <>
                <RulerCorner elRef={rulerCornerBoundRef} />
                <HorizontalRuler
                  widthPt={PAGE_W}
                  elRef={horizontalRulerBoundRef}
                  onPointerDownGuide={onRulerGuidePointerDown('horizontal')}
                  leftMarginPt={!bandContainerEl && !viewOnly ? m.left : undefined}
                  rightMarginPt={!bandContainerEl && !viewOnly ? m.right : undefined}
                  onMarginPointerDown={
                    !bandContainerEl && !viewOnly
                      ? (side) => onMarginMarkerPointerDown(side)
                      : undefined
                  }
                />
              </>
            ) : (
              // Reserved spacer for the ruler band — keeps the inactive
              // page's height aligned with the active page's height so
              // the stack reads as uniform.
              <div aria-hidden style={{ width: 22 + PAGE_W, height: 22 }} />
            )}
          </div>
          <div className="flex">
            {showRulers && isActivePage ? (
              <VerticalRuler
                heightPt={PAGE_H}
                elRef={verticalRulerBoundRef}
                onPointerDownGuide={onRulerGuidePointerDown('vertical')}
                topMarginPt={!bandContainerEl && !viewOnly ? m.top : undefined}
                bottomMarginPt={!bandContainerEl && !viewOnly ? m.bottom : undefined}
                onMarginPointerDown={
                  !bandContainerEl && !viewOnly
                    ? (side) => onMarginMarkerPointerDown(side)
                    : undefined
                }
              />
            ) : (
              <div aria-hidden style={{ width: 22, height: PAGE_H, flexShrink: 0 }} />
            )}
            <div
              ref={isActivePage ? connectDropRef : undefined}
              data-agreemint-page-canvas
              data-page-index={stackedPageIndex}
              className={`relative shadow-lg ${
                // Drop the white default class only when the page itself
                // declares a background — otherwise tailwind's bg-white
                // would paint over an inline gradient on the active page.
                stackedPage.background ? '' : 'bg-white dark:bg-zinc-100'
              } ${
                isActivePage
                  ? (moveGrabActive ? 'cursor-grab' : drawMode ? 'cursor-crosshair' : '')
                  : 'cursor-pointer'
              }`}
              style={{
                width: PAGE_W,
                height: PAGE_H,
                // Apply the page's own background — gradient takes
                // precedence over solid colour, mirroring element bg
                // semantics. Layered with the editor grid below so the
                // grid still reads on dark backgrounds.
                ...(stackedPage.background
                  ? buildPageBackgroundStyle(stackedPage.background)
                  : {}),
                ...(showGrid && isActivePage
                  ? {
                      backgroundImage: [
                        'linear-gradient(to right, rgb(228 228 231 / 0.5) 1px, transparent 1px)',
                        'linear-gradient(to bottom, rgb(228 228 231 / 0.5) 1px, transparent 1px)',
                        // When a page-level gradient is set, restack it
                        // beneath the grid so the grid stays visible.
                        stackedPage.background?.gradient && isValidGradient(stackedPage.background.gradient)
                          ? gradientToCss(stackedPage.background.gradient)
                          : null,
                      ].filter(Boolean).join(', '),
                      backgroundSize: `${gridSize}px ${gridSize}px, ${gridSize}px ${gridSize}px${stackedPage.background?.gradient ? ', auto' : ''}`,
                    }
                  : {}),
              }}
              onMouseDown={isActivePage ? onPageMouseDown : undefined}
              onMouseMove={isActivePage ? onPageMouseMove : undefined}
              onMouseLeave={isActivePage ? () => setCanvasPointerPt(null) : undefined}
              onPointerMove={isActivePage ? onPagePointerMove : undefined}
              onPointerUp={isActivePage ? onPagePointerUp : undefined}
              onPointerCancel={isActivePage ? onPagePointerUp : undefined}
            >
              {/* The old sky-blue dashed rectangle that traced the print
                  margins lived here. It's been replaced by the draggable
                  triangle markers on the rulers (Google-Docs-style) so
                  the page surface stays uncluttered and the author can
                  drag margins directly from the ruler instead of hunting
                  for them in Settings. */}
              {isActivePage && activePageGuides?.vertical.map((x, gi) => (
                <Fragment key={`pgv-${gi}-${x}`}>
                  <div
                    className="pointer-events-none absolute z-[3] w-px bg-sky-500/90 dark:bg-sky-400/90"
                    style={{ left: x, top: gOy, height: gGuideH }}
                  />
                  <div
                    role="separator"
                    aria-label="Vertical layout guide"
                    title="Drag to move. Drop on the left ruler to delete. Alt-click to delete."
                    className={`absolute z-[30] w-2 touch-none ${drawMode ? 'pointer-events-none' : 'cursor-ew-resize'}`}
                    style={{ left: x - 4, top: gOy, height: gGuideH }}
                    onPointerDown={onExistingGuidePointerDown('vertical', gi, x)}
                    onMouseDown={(ev) => ev.stopPropagation()}
                  />
                </Fragment>
              ))}
              {isActivePage && activePageGuides?.horizontal.map((y, gi) => (
                <Fragment key={`pgh-${gi}-${y}`}>
                  <div
                    className="pointer-events-none absolute left-0 z-[3] h-px bg-sky-500/90 dark:bg-sky-400/90"
                    style={{ top: gOy + y, width: PAGE_W }}
                  />
                  <div
                    role="separator"
                    aria-label="Horizontal layout guide"
                    title="Drag to move. Drop on the top ruler to delete. Alt-click to delete."
                    className={`absolute left-0 z-[30] h-2 touch-none ${drawMode ? 'pointer-events-none' : 'cursor-ns-resize'}`}
                    style={{ top: gOy + y - 4, width: PAGE_W }}
                    onPointerDown={onExistingGuidePointerDown('horizontal', gi, y)}
                    onMouseDown={(ev) => ev.stopPropagation()}
                  />
                </Fragment>
              ))}
              {isActivePage && guideRulerPreview?.axis === 'vertical' ? (
                <div
                  className="pointer-events-none absolute z-[4] w-px bg-sky-400/70 dark:bg-sky-300/70"
                  style={{ left: guideRulerPreview.pt, top: gOy, height: gGuideH }}
                />
              ) : null}
              {isActivePage && guideRulerPreview?.axis === 'horizontal' ? (
                <div
                  className="pointer-events-none absolute left-0 z-[4] h-px bg-sky-400/70 dark:bg-sky-300/70"
                  style={{ top: gOy + guideRulerPreview.pt, width: PAGE_W }}
                />
              ) : null}
              {isActivePage && dragGuides.vertical.map((x) => (
                <div
                  key={`vg-${x}`}
                  className="pointer-events-none absolute z-[25] w-px bg-fuchsia-500 dark:bg-fuchsia-400"
                  style={{ left: gOx + x, top: gOy, height: gGuideH }}
                />
              ))}
              {isActivePage && dragGuides.horizontal.map((y) => (
                <div
                  key={`hg-${y}`}
                  className="pointer-events-none absolute left-0 z-[25] h-px bg-fuchsia-500 dark:bg-fuchsia-400"
                  style={{ top: gOy + y, width: PAGE_W }}
                />
              ))}
              {/* Path-edit mode chrome (vertex handles + snap guides).
                  Lives in page-coord space — the overlay positions
                  itself at the editing element's (x, y). Renders null
                  when no element is being path-edited. Active page only. */}
              {isActivePage && (
                <div
                  className="pointer-events-none absolute z-[26]"
                  style={{ left: gOx, top: gOy, width: PAGE_W, height: PAGE_H }}
                >
                  <PathEditOverlay />
                </div>
              )}
              {/* Marquee / rubber-band selection rectangle. Only rendered
                  while the Select-tool drag exceeds the click threshold
                  (a plain click shows nothing — matches Figma / Excalidraw). */}
              {isActivePage && marqueeRect && (
                <div
                  className="pointer-events-none absolute z-[24] border border-dashed border-violet-500 bg-violet-500/10 dark:border-violet-400 dark:bg-violet-400/10"
                  style={{
                    left: gOx + marqueeRect.x,
                    top: gOy + marqueeRect.y,
                    width: marqueeRect.w,
                    height: marqueeRect.h,
                  }}
                />
              )}
              {isActivePage && bandEditBox ? (
                <BandEditOutsideMasks box={bandEditBox} pageW={PAGE_W} pageH={PAGE_H} />
              ) : null}
              {isActivePage && bandEditBox ? (
                <div
                  className="absolute z-[35] overflow-hidden"
                  style={{
                    left: bandEditBox.x,
                    top: bandEditBox.y,
                    width: bandEditBox.w,
                    height: bandEditBox.h,
                  }}
                >
                  <div className="relative h-full w-full">
                    {pageDisplayElements.flatMap((el) => {
                      if ((el.type === 'HEADER' || el.type === 'FOOTER') && el.bandElements?.length) {
                        return [
                          <div
                            key={el.id}
                            className="absolute"
                            style={{ left: el.x, top: el.y, width: el.width, height: el.height }}
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              useEditorStore.getState().enterBandCanvasEdit(el.id)
                            }}
                            title="Double-click to edit header/footer band"
                          >
                            {el.bandElements.map((ch) => (
                              <CanvasElement
                                key={ch.id}
                                el={ch}
                                exemptFromInlineCommitRef={exemptFromInlineCommitRef}
                                onElementContextMenu={onElementContextMenu}
                                onCommentClick={onCommentClick}
                              />
                            ))}
                          </div>,
                        ]
                      }
                      return [
                        <CanvasElement
                          key={el.id}
                          el={el}
                          exemptFromInlineCommitRef={exemptFromInlineCommitRef}
                          onElementContextMenu={onElementContextMenu}
                          onCommentClick={onCommentClick}
                        />,
                      ]
                    })}
                    {selectionBounds != null ? (
                      <div
                        className="pointer-events-none absolute z-[24] rounded border-2 border-dashed border-violet-500/80 dark:border-violet-400/70"
                        style={{
                          left: selectionBounds.left,
                          top: selectionBounds.top,
                          width: selectionBounds.width,
                          height: selectionBounds.height,
                        }}
                        aria-hidden
                      />
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  {pageDisplayElements.flatMap((el) => {
                    if ((el.type === 'HEADER' || el.type === 'FOOTER') && el.bandElements?.length) {
                      return [
                        <div
                          key={el.id}
                          className="absolute"
                          style={{ left: el.x, top: el.y, width: el.width, height: el.height }}
                          onDoubleClick={(e) => {
                            if (!isActivePage) return
                            e.stopPropagation()
                            e.preventDefault()
                            useEditorStore.getState().enterBandCanvasEdit(el.id)
                          }}
                          title="Double-click to edit header/footer band"
                        >
                          {el.bandElements.map((ch) => (
                            <CanvasElement
                              key={ch.id}
                              el={ch}
                              exemptFromInlineCommitRef={exemptFromInlineCommitRef}
                              onElementContextMenu={onElementContextMenu}
                              onCommentClick={onCommentClick}
                            />
                          ))}
                        </div>,
                      ]
                    }
                    return [
                      <CanvasElement
                        key={el.id}
                        el={el}
                        exemptFromInlineCommitRef={exemptFromInlineCommitRef}
                        onElementContextMenu={onElementContextMenu}
                        onCommentClick={onCommentClick}
                      />,
                    ]
                  })}
                  {isActivePage && selectionBounds != null ? (
                    <div
                      className="pointer-events-none absolute z-[24] rounded border-2 border-dashed border-violet-500/80 dark:border-violet-400/70"
                      style={{
                        left: selectionBounds.left,
                        top: selectionBounds.top,
                        width: selectionBounds.width,
                        height: selectionBounds.height,
                      }}
                      aria-hidden
                    />
                  ) : null}
                </>
              )}
            </div>
          </div>
            </div>
            )
          })}
          </div>
        </div>
      </div>
    </div>
    <AddImageModal open={imageModalOpen} onClose={dismissImageModal} onAdd={confirmImageInsert} />
    {elementContextMenu ? (
      <>
        <button
          type="button"
          className="fixed inset-0 z-[350] cursor-default bg-transparent"
          aria-label="Close menu"
          onClick={() => setElementContextMenu(null)}
        />
        <div
          className="fixed z-[360] min-w-[11rem] rounded-lg border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
          style={{
            left: Math.min(elementContextMenu.x, typeof window !== 'undefined' ? window.innerWidth - 200 : 0),
            top: Math.min(elementContextMenu.y, typeof window !== 'undefined' ? window.innerHeight - 120 : 0),
          }}
          role="menu"
        >
          {!viewOnly && (
            <>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40"
                onClick={() => {
                  const st = useEditorStore.getState()
                  const elId = st.selectedIds[st.selectedIds.length - 1]
                  setElementContextMenu(null)
                  if (elId) st.openAiModalForElement(elId)
                }}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14.5 9.5L4 20" />
                  <path d="M14.5 9.5l5-5" />
                  <path d="M13 8l3 3" />
                </svg>
                Modify with AI…
              </button>
              <div className="border-t border-zinc-100 dark:border-zinc-700" />
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => {
                  const name = window.prompt('Component name', 'My component')
                  if (name?.trim()) {
                    saveSelectionAsLayoutComponent(name.trim())
                  }
                  setElementContextMenu(null)
                }}
              >
                Save as component…
              </button>
              {canDivide ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => {
                    divideSelectionIntoRegions()
                    setElementContextMenu(null)
                  }}
                >
                  Divide shapes (split into regions)…
                </button>
              ) : null}
              <div className="border-t border-zinc-100 dark:border-zinc-700" />
            </>
          )}
          {commentingEnabled && (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => {
                const st = useEditorStore.getState()
                const elId = st.selectedIds[0]
                setElementContextMenu(null)
                if (elId) {
                  setEditorSidebarTab('comments')
                  // In-app modal — see AddCommentModal. Replaces the
                  // native window.prompt that was producing the ugly
                  // "localhost:5173 says" browser dialog.
                  st.openAddCommentModal(elId)
                }
              }}
            >
              <svg className="h-3.5 w-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
              Add comment
            </button>
          )}
        </div>
      </>
    ) : null}
    </>
    </MeasurementProvider>
  )
}
