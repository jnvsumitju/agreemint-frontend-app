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
import { computeDragSnap, computeResizeSnap } from '../../lib/canvasGuides'
import { isHeaderOrFooterType } from '../../lib/layoutMargins'
import { findElementByIdInDocument, mergeDocumentBandsIntoPageElements } from '../../lib/documentPageMerge'
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
import { TableElementCanvas, type LayoutTableElement } from './TableElementCanvas'
import { AddImageModal } from './AddImageModal'
import {
  canSubtractPunchHoleSelection,
  isMergeableShapeType,
  shapePolygonToSvgPathD,
} from '../../lib/shapeGeometry'
import {
  resolveLayoutElement,
  variableValuesToDataTree,
} from '../../lib/layoutBehaviourResolve'
import type { Editor as TipTapEditor } from '@tiptap/core'

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

function CanvasElement({
  el,
  exemptFromInlineCommitRef,
  onElementContextMenu,
}: {
  el: LayoutElement
  exemptFromInlineCommitRef: RefObject<HTMLElement | null>
  onElementContextMenu?: (e: ReactMouseEvent, elId: string) => void
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const inlineEditorRef = useRef<HTMLDivElement>(null)
  /** Survives brief store/zustand timing gaps vs TipTap destroy order. */
  const inlineTipTapLocalRef = useRef<TipTapEditor | null>(null)
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
  const setInlineTipTapEditor = useEditorStore((s) => s.setInlineTipTapEditor)
  const spaceMoveTool = useEditorStore((s) => s.spaceMoveTool)
  const canvasTool = useEditorStore((s) => s.canvasTool)

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
  /** TABLE: never use the outer violet ring — selection is shown on cells inside the table. */
  const hideTableOuterSelectionRing = el.type === 'TABLE' && selected && !el.locked
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
  const canInlineEdit = isRichTextElement(el)

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

  const commitInlineEdit = useCallback(() => {
    if (commitGuardRef.current) return
    const st0 = useEditorStore.getState()
    const cur = findElementByIdInDocumentDeep(st0.pages, el.id)
    const nested = findBandNestedChild(st0.pages, el.id)
    const ed =
      inlineTipTapLocalRef.current ?? useEditorStore.getState().inlineTipTapEditor
    if (!ed) {
      if (!cur) return
      commitGuardRef.current = true
      const outer = outerRef.current
      let height: number | undefined
      if (outer && cur) {
        const phPage = pageDimensionsPt(st0.pageSpec).height
        const phCap = nested ? bandViewportDims(st0, nested.container).h : phPage
        const nh = Math.max(16, Math.min(phCap - cur.y, Math.ceil(outer.getBoundingClientRect().height)))
        if (Math.abs(nh - cur.height) > 0.5) height = nh
      }
      const content = cur.content ?? ''
      updateElement(el.id, height !== undefined ? { content, height } : { content })
      setCanvasInlineEdit(null)
      queueMicrotask(() => {
        commitGuardRef.current = false
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
      const phCap = nested ? bandViewportDims(st0, nested.container).h : phPage
      const nh = Math.max(16, Math.min(phCap - cur.y, Math.ceil(outer.getBoundingClientRect().height)))
      if (Math.abs(nh - cur.height) > 0.5) height = nh
    }
    updateElement(el.id, height !== undefined ? { content, height } : { content })
    setCanvasInlineEdit(null)
    queueMicrotask(() => {
      commitGuardRef.current = false
    })
  }, [el.id, updateElement, setCanvasInlineEdit])

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
    })
  }, [el.id, updateElement, setCanvasInlineEdit])

  useLayoutEffect(() => {
    if (!isInlineEditing) {
      inlineOpenedRef.current = false
      return
    }
    if (!inlineOpenedRef.current) {
      inlineOpenedRef.current = true
      inlineUndoRef.current = { content: el.content ?? '', height: el.height }
      contentSnapshotRef.current = el.content
    }
  }, [isInlineEditing, el.id, el.content, el.height])

  /** Grow frame with text (PDF-style); keep stored height in sync for save / layout. */
  useLayoutEffect(() => {
    if (!isInlineEditing || !canInlineEdit) return
    const root = outerRef.current
    if (!root) return
    let raf = 0
    const syncHeight = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const h = Math.ceil(root.getBoundingClientRect().height)
        const st = useEditorStore.getState()
        const cur = findElementByIdInDocumentDeep(st.pages, el.id)
        if (!cur) return
        const n = findBandNestedChild(st.pages, el.id)
        const phPage = pageDimensionsPt(st.pageSpec).height
        const maxH = (n ? bandViewportDims(st, n.container).h : phPage) - cur.y
        const next = Math.max(16, Math.min(maxH, h))
        if (Math.abs(next - cur.height) > 0.5) {
          st.updateElement(el.id, { height: next }, { skipHistory: true })
        }
      })
    }
    const ro = new ResizeObserver(syncHeight)
    ro.observe(root)
    syncHeight()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [isInlineEditing, canInlineEdit, el.id])

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
    if (st0.canvasTool === 'mergeShapes' && !st0.spaceMoveTool && e.button === 0) {
      e.preventDefault()
      e.stopPropagation()
      const additive = e.metaKey || e.ctrlKey || e.shiftKey
      if (isMergeableShapeType(el.type)) {
        st0.mergeGroupedShapesContaining(el.id)
      } else {
        select(el.id, additive ? { additive: true } : undefined)
      }
      return
    }
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
          snapToGrid: st.snapToGrid,
          smartGuides: st.smartGuidesEnabled,
          userGuides,
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
    if (!canInlineEdit || locked) return
    const t = e.target as HTMLElement
    if (
      isInlineEditing &&
      (t.closest('.ProseMirror') ||
        t.closest('[contenteditable="true"]') ||
        t.closest('[data-agreemint-tiptap-root]'))
    ) {
      return
    }
    e.stopPropagation()
    e.preventDefault()
    select(el.id)
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
      const { width, height, guides, violatesMargins } = computeResizeSnap(
        startW + dx,
        startH + dy,
        current,
        others,
        st.pageSpec,
        {
          snapToGrid: st.snapToGrid,
          smartGuides: st.smartGuidesEnabled,
          userGuides,
        },
        viewportPt
      )
      setMarginClampHighlight(violatesMargins)
      st.setDragGuides(guides)
      st.resizeElement(el.id, width, height)
    }
    const onUp = () => {
      setMarginClampHighlight(false)
      useEditorStore.getState().setDragGuides({ vertical: [], horizontal: [] })
      useEditorStore.getState().endHistoryBatch()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const growWithText = isInlineEditing && canInlineEdit
  const boxX = coerceLayoutScalar(el.x, 0)
  const boxY = coerceLayoutScalar(el.y, 0)
  const boxW = Math.max(1, coerceLayoutScalar(el.width, 20))
  const boxHRaw = coerceLayoutScalar(el.height, el.type === 'LINE' ? 4 : 16)
  const boxH = el.type === 'LINE' ? Math.max(boxHRaw, 4) : boxHRaw
  const style: React.CSSProperties = {
    left: boxX,
    top: boxY,
    width: boxW,
    ...(growWithText
      ? { height: 'auto', minHeight: 16, overflow: 'visible' }
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
  }

  return (
    <div
      ref={outerRef}
      className={`absolute box-border select-none transition-shadow ${
        marginClampHighlight && !isHeaderOrFooterType(el.type)
          ? 'ring-2 ring-red-500/85 ring-offset-1 shadow-[0_0_0_3px_rgba(248,113,113,0.22)]'
          : selected
            ? locked
              ? 'ring-2 ring-amber-500 ring-offset-1'
              : hideTableOuterSelectionRing
                ? 'ring-0 ring-offset-1 hover:ring-1 hover:ring-zinc-300 dark:hover:ring-zinc-600'
                : 'ring-2 ring-violet-500 ring-offset-1'
            : 'ring-0 ring-offset-1 hover:ring-1 hover:ring-zinc-300 dark:hover:ring-zinc-600'
      } ${locked ? 'opacity-[0.92]' : ''} ${isDragging ? 'z-10 opacity-90' : isInlineEditing ? 'z-20' : 'z-[1]'}`}
      style={style}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDownBubble}
      title={
        locked
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
        <div
          ref={inlineEditorRef}
          className={`w-full px-1 py-0.5 ${
            el.style?.color?.trim()
              ? ''
              : 'text-zinc-900 dark:text-zinc-100'
          } ${
            el.style?.backgroundColor?.trim()
              ? ''
              : 'bg-white/95 dark:bg-zinc-900/95'
          }`}
          style={{
            fontSize: el.style?.fontSize ?? 12,
            // Do not inherit element bold/italic onto the editor — it hides TipTap marks (B/I/sub/sup).
            fontWeight: 400,
            fontStyle: 'normal',
            textAlign: (el.style?.align ?? 'left') as React.CSSProperties['textAlign'],
            color: el.style?.color?.trim() || undefined,
            backgroundColor: el.style?.backgroundColor?.trim() || undefined,
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
            editorClassName="bg-transparent font-normal not-italic"
            editorStyle={{
              fontSize: el.style?.fontSize ?? 12,
              fontWeight: 400,
              fontStyle: 'normal',
              textAlign: (el.style?.align ?? 'left') as React.CSSProperties['textAlign'],
              color: el.style?.color?.trim() || undefined,
              backgroundColor: 'transparent',
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
      ) : (
        <ElementPreview el={el} />
      )}
      {soleSelected &&
        !locked &&
        el.type !== 'MERGED_SHAPE' &&
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
      {locked && (
        <span
          className="pointer-events-none absolute right-1 top-1 z-30 rounded bg-amber-100 px-1 py-px text-[9px] font-bold text-amber-900 dark:bg-amber-950/80 dark:text-amber-100"
          title="Layer locked — unlock in the Behaviour or Layers tab to move or edit"
        >
          Locked
        </span>
      )}
      {canInlineEdit && !isInlineEditing && soleSelected && !locked && (
        <span className="pointer-events-none absolute -top-5 left-0 max-w-[min(100%,280px)] text-[9px] leading-tight text-zinc-500 dark:text-zinc-400">
          {el.type === 'TEXT' && bandNested && bandCanvasEditElementId !== bandNested.container.id
            ? 'Double-click opens band editor — text edits only there · toolbar Page / Header / Footer · Esc when done'
            : el.type === 'TEXT'
              ? 'Double-click to edit · click a purple field for details · top bar for format · ⌘/Ctrl+Enter to finish'
              : el.type === 'HEADER' || el.type === 'FOOTER'
                ? 'Double-click for band editor (full width) · Esc / Done to return'
                : 'Double-click to edit · click a purple field for details · ⌘/Ctrl+Enter to finish'}
        </span>
      )}
    </div>
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
    if (el.bandElements?.length) {
      return (
        <div
          className="pointer-events-none relative h-full w-full overflow-hidden text-zinc-900 dark:text-zinc-100"
          style={{
            backgroundColor: el.style?.backgroundColor?.trim() || undefined,
          }}
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
        style={{
          backgroundColor: el.style?.backgroundColor?.trim() || undefined,
        }}
      >
        <RichTextBlockPreview
          content={el.content}
          variableValues={variableValues}
          variableSurfaceLabelResolver={variableSurfaceLabelResolver}
          fontSize={fs}
          textAlign={align}
          elementBold={el.style?.bold}
          elementItalic={el.style?.italic}
          color={el.style?.color}
        />
      </div>
    )
  }
  if (el.type === 'TABLE') {
    return <TableElementCanvas el={el as LayoutTableElement} locked={!!el.locked} />
  }
  if (el.type === 'IMAGE') {
    const c = el.style?.color?.trim()
    const bg = el.style?.backgroundColor?.trim()
    const hasSrc = Boolean(el.src?.trim())
    return (
      <div
        className={`pointer-events-none flex h-full items-center justify-center overflow-hidden text-xs text-zinc-500 ${
          bg ? '' : 'bg-zinc-200 dark:bg-zinc-700'
        }`}
        style={{
          backgroundColor: bg || undefined,
          borderWidth: c ? 2 : undefined,
          borderStyle: c ? 'solid' : undefined,
          borderColor: c || undefined,
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
    return (
      <div className="pointer-events-none flex h-full items-center">
        <div
          className={c ? 'w-full' : 'w-full bg-zinc-800 dark:bg-zinc-200'}
          style={{
            height: el.strokeWidth ?? 1,
            backgroundColor: c || undefined,
          }}
        />
      </div>
    )
  }
  if (el.type === 'BOX') {
    const c = el.style?.color?.trim()
    const bg = el.style?.backgroundColor?.trim()
    return (
      <div
        className={`pointer-events-none h-full w-full border-2 border-dashed ${c ? '' : 'border-zinc-400'}`}
        style={{
          borderColor: c || undefined,
          backgroundColor: bg || undefined,
        }}
      />
    )
  }
  const shapeStroke = el.style?.color?.trim() || 'currentColor'
  const shapeFill = el.style?.backgroundColor?.trim()
  const sw = el.strokeWidth ?? 2
  if (el.type === 'ELLIPSE') {
    const w = el.width
    const h = el.height
    return (
      <svg className="pointer-events-none h-full w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(0.5, w / 2 - sw / 2)}
          ry={Math.max(0.5, h / 2 - sw / 2)}
          fill={shapeFill || 'none'}
          stroke={shapeStroke}
          strokeWidth={sw}
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
        <path
          d={d}
          fill={shapeFill || 'none'}
          fillRule="evenodd"
          stroke={shapeStroke}
          strokeWidth={sw}
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
        <polygon points={pts} fill={shapeFill || 'none'} stroke={shapeStroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  if (el.type === 'DIAMOND') {
    const w = el.width
    const h = el.height
    const pts = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`
    return (
      <svg className="pointer-events-none h-full w-full" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <polygon points={pts} fill={shapeFill || 'none'} stroke={shapeStroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
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
        <polygon points={p.join(' ')} fill={shapeFill || 'none'} stroke={shapeStroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  if (el.type === 'ARROW') {
    const w = el.width
    const h = el.height
    const t = Math.min(h * 0.35, w * 0.18)
    const mid = h / 2
    const x0 = 0
    const xShaft = w * 0.68
    const xTip = w
    const d = `M ${x0} ${mid - t / 2} L ${xShaft} ${mid - t / 2} L ${xShaft} 0 L ${xTip} ${mid} L ${xShaft} ${h} L ${xShaft} ${mid + t / 2} L ${x0} ${mid + t / 2} Z`
    return (
      <svg className="pointer-events-none h-full w-full" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <path d={d} fill={shapeFill || 'none'} stroke={shapeStroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  if (el.type === 'MERGED_SHAPE' && el.shapePolys?.length) {
    return (
      <svg className="pointer-events-none h-full w-full" viewBox={`0 0 ${el.width} ${el.height}`} aria-hidden>
        {el.shapePolys.map((poly, pi) => (
          <path
            key={pi}
            d={shapePolygonToSvgPathD(poly)}
            fill={shapeFill || 'none'}
            fillRule="evenodd"
            stroke={shapeStroke}
            strokeWidth={sw}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    )
  }
  return (
    <div
      className={`pointer-events-none h-full w-full overflow-hidden ${el.style?.color?.trim() ? '' : 'text-zinc-900 dark:text-zinc-100'}`}
    >
      <RichTextBlockPreview
        content={el.content}
        variableValues={variableValues}
        variableSurfaceLabelResolver={variableSurfaceLabelResolver}
        fontSize={fs}
        textAlign={align}
        elementBold={el.style?.bold}
        elementItalic={el.style?.italic}
        color={el.style?.color}
        backgroundColor={el.style?.backgroundColor}
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
}: {
  widthPt: number
  elRef?: RefObject<HTMLDivElement | null>
  onPointerDownGuide?: (e: ReactPointerEvent<HTMLDivElement>) => void
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
    </div>
  )
}

function VerticalRuler({
  heightPt,
  elRef,
  onPointerDownGuide,
}: {
  heightPt: number
  elRef?: RefObject<HTMLDivElement | null>
  onPointerDownGuide?: (e: ReactPointerEvent<HTMLDivElement>) => void
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
  const mergedElements = useMemo(
    () =>
      bandContainerEl ? elements : mergeDocumentBandsIntoPageElements(pages, activePageIndex, activePageElements),
    [bandContainerEl, elements, pages, activePageIndex, activePageElements]
  )
  const displayElements = useMemo(() => {
    return mergedElements.flatMap((el) => {
      const { visible, element } = resolveLayoutElement(el, previewData, null)
      return visible ? [element] : []
    })
  }, [mergedElements, previewData])
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const punchHoleElements = useMemo(() => {
    if (bandContainerEl) return bandContainerEl.bandElements ?? []
    return pages[activePageIndex]?.elements ?? []
  }, [bandContainerEl, pages, activePageIndex])
  const canPunchHole = useEditorStore((s) =>
    canSubtractPunchHoleSelection({
      selectedIds: s.selectedIds,
      elements: punchHoleElements,
    })
  )
  const addElement = useEditorStore((s) => s.addElement)
  const insertLayoutComponentAt = useEditorStore((s) => s.insertLayoutComponentAt)
  const saveSelectionAsLayoutComponent = useEditorStore((s) => s.saveSelectionAsLayoutComponent)
  const subtractSelectionToMergedShape = useEditorStore((s) => s.subtractSelectionToMergedShape)
  const select = useEditorStore((s) => s.select)
  const pageSpec = useEditorStore((s) => s.pageSpec)
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

  const requestImageInsertAt = useCallback((pos: { x: number; y: number }) => {
    pendingImagePosRef.current = pos
    setImageModalOpen(true)
  }, [])

  const dismissImageModal = useCallback(() => {
    pendingImagePosRef.current = null
    setImageModalOpen(false)
  }, [])

  const confirmImageInsert = useCallback(
    (src: string) => {
      const pos = pendingImagePosRef.current
      pendingImagePosRef.current = null
      setImageModalOpen(false)
      if (pos) addElement({ ...createDefaultElement('IMAGE', pos), src: src.trim() })
    },
    [addElement]
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

  const onDropNew = useCallback(
    (clientX: number, clientY: number) => {
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

  const onScrollPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (canvasTool !== 'pan' || e.button !== 0) return
      const el = scrollRef.current
      if (!el) return
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
    const p = panSessionRef.current
    if (!p || p.pointerId !== e.pointerId) return
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = p.sl - (e.clientX - p.startX)
    el.scrollTop = p.st - (e.clientY - p.startY)
  }, [])

  const onScrollPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
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
      : canvasTool === 'mergeShapes'
        ? 'cursor-pointer'
        : moveGrabActive
          ? 'cursor-grab'
          : drawMode
            ? 'cursor-crosshair'
            : ''

  const scrollTitle =
    canvasTool === 'pan'
      ? 'Drag to pan the canvas'
      : canvasTool === 'mergeShapes'
        ? 'Merge shapes — group shapes first, then click any member to merge into one outline'
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

  const onPageMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setElementContextMenu(null)
      if (e.button !== 0) return
      const st = useEditorStore.getState()
      if (st.canvasTool === 'draw' && !st.spaceMoveTool) {
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
      select(null)
    },
    [addElement, select, requestImageInsertAt]
  )

  return (
    <>
    <div
      ref={scrollRef}
      data-agreemint-canvas-root
      className={`min-w-0 flex-1 overflow-auto bg-zinc-200/80 p-6 dark:bg-zinc-950 ${scrollCursorClass}`}
      title={scrollTitle}
      onPointerDownCapture={onScrollPointerDownCapture}
      onPointerMove={onScrollPointerMove}
      onPointerUp={onScrollPointerUp}
      onPointerCancel={onScrollPointerUp}
    >
      <div
        className="mx-auto min-w-0"
        style={{
          width: (22 + PAGE_W) * canvasZoom,
          height: (22 + PAGE_H) * canvasZoom,
        }}
      >
        <div
          className="inline-block min-w-0 origin-top-left"
          style={{
            transform: `scale(${canvasZoom})`,
            width: 22 + PAGE_W,
            height: 22 + PAGE_H,
          }}
        >
          <div className="flex flex-col">
          <div className="flex">
            <RulerCorner elRef={rulerCornerBoundRef} />
            <HorizontalRuler
              widthPt={PAGE_W}
              elRef={horizontalRulerBoundRef}
              onPointerDownGuide={onRulerGuidePointerDown('horizontal')}
            />
          </div>
          <div className="flex">
            <VerticalRuler
              heightPt={PAGE_H}
              elRef={verticalRulerBoundRef}
              onPointerDownGuide={onRulerGuidePointerDown('vertical')}
            />
            <div
              ref={connectDropRef}
              className={`relative bg-white shadow-lg dark:bg-zinc-100 ${
                moveGrabActive ? 'cursor-grab' : drawMode ? 'cursor-crosshair' : ''
              }`}
              style={{
                width: PAGE_W,
                height: PAGE_H,
                backgroundImage:
                  'linear-gradient(to right, rgb(228 228 231 / 0.5) 1px, transparent 1px), linear-gradient(to bottom, rgb(228 228 231 / 0.5) 1px, transparent 1px)',
                backgroundSize: '10px 10px',
              }}
              onMouseDown={onPageMouseDown}
              onMouseMove={onPageMouseMove}
              onMouseLeave={() => setCanvasPointerPt(null)}
            >
              {!bandContainerEl ? (
                <div
                  className="pointer-events-none absolute z-[2] border border-dashed border-sky-500/45 dark:border-sky-400/55"
                  style={{
                    left: m.left,
                    top: m.top,
                    width: Math.max(0, PAGE_W - m.left - m.right),
                    height: Math.max(0, PAGE_H - m.top - m.bottom),
                  }}
                  title="Print margins"
                />
              ) : null}
              {activePageGuides?.vertical.map((x, gi) => (
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
              {activePageGuides?.horizontal.map((y, gi) => (
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
              {guideRulerPreview?.axis === 'vertical' ? (
                <div
                  className="pointer-events-none absolute z-[4] w-px bg-sky-400/70 dark:bg-sky-300/70"
                  style={{ left: guideRulerPreview.pt, top: gOy, height: gGuideH }}
                />
              ) : null}
              {guideRulerPreview?.axis === 'horizontal' ? (
                <div
                  className="pointer-events-none absolute left-0 z-[4] h-px bg-sky-400/70 dark:bg-sky-300/70"
                  style={{ top: gOy + guideRulerPreview.pt, width: PAGE_W }}
                />
              ) : null}
              {dragGuides.vertical.map((x) => (
                <div
                  key={`vg-${x}`}
                  className="pointer-events-none absolute z-[25] w-px bg-fuchsia-500 dark:bg-fuchsia-400"
                  style={{ left: gOx + x, top: gOy, height: gGuideH }}
                />
              ))}
              {dragGuides.horizontal.map((y) => (
                <div
                  key={`hg-${y}`}
                  className="pointer-events-none absolute left-0 z-[25] h-px bg-fuchsia-500 dark:bg-fuchsia-400"
                  style={{ top: gOy + y, width: PAGE_W }}
                />
              ))}
              {bandEditBox ? (
                <BandEditOutsideMasks box={bandEditBox} pageW={PAGE_W} pageH={PAGE_H} />
              ) : null}
              {bandEditBox ? (
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
                    {displayElements.flatMap((el) => {
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
                  {displayElements.flatMap((el) => {
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
                </>
              )}
            </div>
          </div>
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
          {canPunchHole ? (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => {
                subtractSelectionToMergedShape()
                setElementContextMenu(null)
              }}
            >
              Punch hole (subtract shapes)…
            </button>
          ) : null}
          <p className="border-t border-zinc-100 px-3 py-1.5 text-[10px] leading-snug text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Saves the current selection. If any item is grouped, the whole group on this page is included.
          </p>
        </div>
      </>
    ) : null}
    </>
  )
}
