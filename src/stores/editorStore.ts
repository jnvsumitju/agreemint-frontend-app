import { create } from 'zustand'
import { richTextDebugLog } from '../lib/richTextDebugLog'
import type { Editor as TipTapEditor } from '@tiptap/core'
import type {
  ElementComment,
  ElementType,
  LayoutDocumentPage,
  LayoutElement,
  PageMargins,
  PageSpec,
} from '../types/layout'
import {
  LEGACY_SINGLE_PAGE_ID,
  defaultPageSpec,
  newElementId,
  newGroupId,
  newPageId,
  normalizeCatalogVariableKey,
  normalizePageSpec,
  type PageGuides,
  pageDimensionsPt,
  snap,
  type ParsedLayoutResult,
  type VariableDefinition,
} from '../types/layout'
import type { DragGuideState } from '../lib/canvasGuides'
import {
  clampElementLayoutToPrintMargins,
  clampGroupTranslationDelta,
  clampHeaderFooterLayoutToPage,
} from '../lib/layoutMargins'
import { reorderIdsInList } from '../lib/layerOrder'
import type { TableSelection } from '../types/tableSelection'
import { shadowStorageKeysForCatalogCollisions } from '../lib/layoutBehaviourResolve'
import { preferStoreRichContentIfEditorEmpty, serializeRunsToContent } from '../lib/richContent'
import { pmDocToRuns } from '../lib/tipTapRichBridge'
import {
  filterPersistableVariableDefinitions,
  isSystemGlobalVariableKey,
  SYSTEM_GLOBAL_VARIABLE_KEYS,
} from '../lib/systemTemplateVariables'
import {
  defaultPreviewValueForVariable,
  defaultSampleListItemsJson,
  defaultSampleTableRowsJson,
  extractVariableKeys,
  uniqueListDataKeys,
  uniqueTableDataKeys,
} from '../lib/variables'
import {
  loadLayoutComponentsFromStorage,
  persistLayoutComponents,
  type SavedLayoutComponent,
} from '../lib/savedLayoutComponents'
import {
  distributeContent,
  joinParagraphContents,
  measureContentHeight,
  splitContentIntoParagraphs,
} from '../lib/textReflow'
import {
  isMergeableShapeType,
  mergeLayoutShapeElements,
  subtractLayoutShapeElements,
} from '../lib/shapeGeometry'
import {
  MAX_UNDO_STEPS,
  captureEditorUndoSnapshot,
  isUndoSuppressed,
  snapshotToPatch,
  withUndoSuppressed,
  type EditorUndoSnapshot,
} from '../lib/editorHistory'
import {
  clampBandGroupTranslationDelta,
  clampBandNestedElement,
  ensureBandElementsFromLegacy,
  findBandNestedChild,
  isBandChildOf,
  placeBandElementOnDrop,
} from '../lib/bandNestedLayout'

/**
 * Live TipTap `Editor` keyed by layout element id for canvas inline edit. A single global ref was
 * cleared by Strict Mode / stale `onUnmount` while a newer instance kept running — the map only
 * deletes when the unmounting instance still owns the slot (`unregister` no-ops if replaced).
 * Do not clear the map from TipTap `destroy` — destroy can run before the replacement `onReady`,
 * leaving the map empty while the same `canvasInlineEditId` is still active (Strict Mode / useEditor swap).
 */
export const activeCanvasTipTapEditorByElementId = new Map<string, TipTapEditor>()

export function registerActiveCanvasTipTapEditor(elementId: string, editor: TipTapEditor) {
  if (editor.isDestroyed) return
  activeCanvasTipTapEditorByElementId.set(elementId, editor)
  richTextDebugLog('store', 'activeCanvasTipTap map set', {
    elementId,
    mapSize: activeCanvasTipTapEditorByElementId.size,
  })
}

export function unregisterActiveCanvasTipTapEditor(elementId: string, editor: TipTapEditor) {
  const cur = activeCanvasTipTapEditorByElementId.get(elementId)
  if (cur !== editor) {
    richTextDebugLog('store', 'activeCanvasTipTap map unregister skip (newer instance)', {
      elementId,
    })
    return
  }
  activeCanvasTipTapEditorByElementId.delete(elementId)
  richTextDebugLog('store', 'activeCanvasTipTap map delete', { elementId })
}

function removeActiveCanvasTipTapEditorFromMapByInstance(editor: TipTapEditor) {
  for (const [id, ed] of activeCanvasTipTapEditorByElementId) {
    if (ed === editor) {
      activeCanvasTipTapEditorByElementId.delete(id)
      richTextDebugLog('store', 'activeCanvasTipTap map delete by destroy', { id })
      return
    }
  }
}

function clearActiveCanvasTipTapEditorMap() {
  activeCanvasTipTapEditorByElementId.clear()
}

function catalogVariableKeys(
  globalDefs: VariableDefinition[],
  pages: LayoutDocumentPage[]
): string[] {
  const set = new Set<string>()
  for (const k of SYSTEM_GLOBAL_VARIABLE_KEYS) set.add(k)
  for (const d of globalDefs) {
    const k = normalizeCatalogVariableKey(d.key ?? '')
    if (k) set.add(k)
  }
  for (const p of pages) {
    for (const d of p.localVariables ?? []) {
      const k = normalizeCatalogVariableKey(d.key ?? '')
      if (k) set.add(k)
    }
  }
  return [...set]
}

function mergeVariableValues(
  prev: Record<string, string>,
  elements: LayoutElement[],
  globalDefs: VariableDefinition[],
  pages: LayoutDocumentPage[],
  activePageIndex: number
): Record<string, string> {
  const keys = new Set([
    ...extractVariableKeys(elements),
    ...catalogVariableKeys(globalDefs, pages),
    ...shadowStorageKeysForCatalogCollisions(globalDefs, pages),
  ])
  const tableKeys = new Set(uniqueTableDataKeys(elements))
  const listKeys = new Set(uniqueListDataKeys(elements))
  const next: Record<string, string> = {}
  for (const k of keys) {
    if (k in prev) {
      next[k] = prev[k]
    } else if (tableKeys.has(k)) {
      next[k] = defaultSampleTableRowsJson()
    } else if (listKeys.has(k)) {
      next[k] = defaultSampleListItemsJson()
    } else {
      next[k] = defaultPreviewValueForVariable(k)
    }
  }
  const totalPages = Math.max(1, pages.length)
  const idx = pages.length ? Math.min(Math.max(0, activePageIndex), pages.length - 1) : 0
  next.totalPages = String(totalPages)
  next.pageNumber = String(idx + 1)
  return next
}

function allPageElements(pages: LayoutDocumentPage[]): LayoutElement[] {
  const out: LayoutElement[] = []
  for (const p of pages) {
    for (const e of p.elements) {
      out.push(e)
      if ((e.type === 'HEADER' || e.type === 'FOOTER') && e.bandElements?.length) {
        out.push(...e.bandElements)
      }
    }
  }
  return out
}

export function bandViewportDims(
  s: Pick<EditorState, 'pageSpec'>,
  container: LayoutElement
): { w: number; h: number; width: number; height: number } {
  const c = clampHeaderFooterLayoutToPage(container, s.pageSpec)
  const w = c.width
  const h = c.height
  /** `width` / `height` mirror `w` / `h` — canvas snap helpers expect `viewportPt.{width,height}`. */
  return { w, h, width: w, height: h }
}

function reclampBandChildrenToContainer(
  s: Pick<EditorState, 'pageSpec'>,
  container: LayoutElement
): LayoutElement {
  if (
    (container.type !== 'HEADER' && container.type !== 'FOOTER') ||
    !container.bandElements?.length
  ) {
    return container
  }
  const { w, h } = bandViewportDims(s, container)
  return {
    ...container,
    bandElements: container.bandElements.map((ch) => clampBandNestedElement(ch, w, h)),
  }
}

function patchBandContainer(
  s: EditorState,
  containerId: string,
  mapContainer: (c: LayoutElement) => LayoutElement,
  options?: { skipHistory?: boolean }
): Partial<EditorState> | Record<string, never> {
  const loc = findElementLocation(s, containerId)
  if (!loc) return {}
  const nextC = mapContainer(loc.el)
  const els = loc.elements.map((e) => (e.id === containerId ? nextC : e))
  const pages = s.pages.map((p, i) => (i === loc.pageIndex ? { ...p, elements: els } : p))
  const barrier = options?.skipHistory ? {} : takeUndoBarrier(s)
  return {
    ...barrier,
    pages,
    variableValues: mergeVariableValues(
      s.variableValues,
      allPageElements(pages),
      s.globalVariableDefinitions,
      pages,
      s.activePageIndex
    ),
  }
}

function activeElements(s: Pick<EditorState, 'pages' | 'activePageIndex'>): LayoutElement[] {
  return s.pages[s.activePageIndex]?.elements ?? []
}

function findElementLocation(
  s: Pick<EditorState, 'pages'>,
  id: string
): { pageIndex: number; elements: LayoutElement[]; el: LayoutElement; index: number } | null {
  for (let pi = 0; pi < s.pages.length; pi++) {
    const els = s.pages[pi]?.elements ?? []
    const idx = els.findIndex((e) => e.id === id)
    if (idx >= 0) return { pageIndex: pi, elements: els, el: els[idx]!, index: idx }
  }
  return null
}

function replacePageElements(s: EditorState, pageIndex: number, elements: LayoutElement[]): Partial<EditorState> {
  const pages = s.pages.map((p, idx) => (idx === pageIndex ? { ...p, elements } : p))
  return {
    pages,
    variableValues: mergeVariableValues(
      s.variableValues,
      allPageElements(pages),
      s.globalVariableDefinitions,
      pages,
      s.activePageIndex
    ),
  }
}

function replaceActiveElements(s: EditorState, elements: LayoutElement[]): Partial<EditorState> {
  return replacePageElements(s, s.activePageIndex, elements)
}

function takeUndoBarrier(s: EditorState): Partial<Pick<EditorState, 'undoPast' | 'undoFuture'>> {
  if (isUndoSuppressed() || s.historyBatchDepth > 0) return {}
  return {
    undoPast: [...s.undoPast, captureEditorUndoSnapshot(s)].slice(-MAX_UNDO_STEPS),
    undoFuture: [],
  }
}

/** Persist open canvas TipTap doc into the active page before clearing inline edit. */
function tryFlushCanvasInlineEdit(s: EditorState): Partial<EditorState> | null {
  const editId = s.canvasInlineEditId
  const ed = s.inlineTipTapEditor
  if (!editId || !ed) return null
  try {
    const nested = findBandNestedChild(s.pages, editId)
    if (nested) {
      const cur = nested.child
      const fromEditor = ed.isDestroyed ? '' : serializeRunsToContent(pmDocToRuns(ed.state.doc))
      const serialized = preferStoreRichContentIfEditorEmpty(fromEditor, cur.content)
      const nextNested = nested.container.bandElements!.map((e) =>
        e.id === editId ? { ...e, content: serialized } : e
      )
      return {
        ...takeUndoBarrier(s),
        ...patchBandContainer(s, nested.container.id, (c) => ({ ...c, bandElements: nextNested })),
      }
    }
    const loc = findElementLocation(s, editId)
    if (!loc) return null
    const cur = loc.el
    const fromEditor = ed.isDestroyed ? '' : serializeRunsToContent(pmDocToRuns(ed.state.doc))
    const serialized = preferStoreRichContentIfEditorEmpty(fromEditor, cur.content)
    const elements = loc.elements.map((e) => (e.id === editId ? { ...e, content: serialized } : e))
    return {
      ...takeUndoBarrier(s),
      ...replacePageElements(s, loc.pageIndex, elements),
    }
  } catch {
    return null
  }
}

function instantiateSavedComponent(
  saved: SavedLayoutComponent,
  dropX: number,
  dropY: number
): LayoutElement[] {
  const raw = saved.elements.map((e) => JSON.parse(JSON.stringify(e)) as LayoutElement)
  const gid = raw.length > 1 ? newGroupId() : undefined
  return raw.map((e) => ({
    ...e,
    id: newElementId(),
    x: snap(e.x + dropX),
    y: snap(e.y + dropY),
    groupId: gid,
  }))
}

function defaultPages(): LayoutDocumentPage[] {
  return [{ id: LEGACY_SINGLE_PAGE_ID, name: 'Page 1', elements: [] }]
}

/** Stable fallback so selectors never return a fresh `[]` each call (React 19 useSyncExternalStore). */
const EMPTY_ELEMENTS: LayoutElement[] = []

/** Left-bar / canvas interaction mode (Select, Move, Draw-to-place, Pan viewport, Merge shapes). */
export type EditorCanvasTool = 'select' | 'move' | 'draw' | 'pan' | 'mergeShapes'

/** Active canvas page element stack (Zustand selector). */
export function selectActivePageElements(s: EditorState): LayoutElement[] {
  const els = s.pages[s.activePageIndex]?.elements
  return els ?? EMPTY_ELEMENTS
}

/** All elements on every page (e.g. variables sidebar). Returns a new array each call — use with `useShallow`. */
export function selectAllTemplateElements(s: EditorState): LayoutElement[] {
  return s.pages.flatMap((p) => p.elements)
}

export interface EditorState {
  templateId: string | null
  templateName: string
  currentVersionId: string | null
  versionNumber: number | null
  pages: LayoutDocumentPage[]
  activePageIndex: number
  /** Selection order: last id is primary (properties panel when a single item is implied). */
  selectedIds: string[]
  /** Canvas preview: values for {{variable}} tokens (not persisted in layout JSON). */
  variableValues: Record<string, string>
  /** Template-wide variable catalog (persisted in layout JSON `globalVariables`). */
  globalVariableDefinitions: VariableDefinition[]
  /** TEXT being edited in-place on the canvas (double-click). */
  canvasInlineEditId: string | null
  /**
   * HEADER/FOOTER: dedicated band editor is open (main canvas collapsed to a strip on the left).
   * When set, the right pane shows a full mini-canvas for `bandElements` on this container.
   */
  bandCanvasEditElementId: string | null
  /** True while the embedded band `EditorCanvas` is mounted (so strip canvas does not treat drops as band edits). */
  bandNestedEditorMounted: boolean
  setBandNestedEditorMounted: (v: boolean) => void
  /** Leave band mode (Done / Cancel / Esc from band shell); flushes inline rich text if any. */
  exitBandCanvasEdit: () => void
  /** TipTap instance for canvas inline rich text (toolbar + commit). */
  inlineTipTapEditor: TipTapEditor | null
  /** Properties panel: focused text run index for navbar formatting (TEXT only). */
  focusedTextRunIndex: number | null
  /** TABLE: selection on canvas (cell, whole columns, or whole rows). */
  tableSelection: TableSelection
  /** TABLE: inline cell edit (double-click). */
  tableCellEdit: { tableId: string; row: number; col: number } | null
  /** View-only mode — disables editing, shows comment icon on hover. */
  viewOnly: boolean
  /** Whether commenting is enabled (false for VIEWER role). */
  commentingEnabled: boolean
  /** Element ID currently highlighted from the comments panel. */
  commentHighlightId: string | null
  /** Right sidebar tab (toolbar can open Variables for table JSON). */
  editorSidebarTab: 'properties' | 'behaviour' | 'layers' | 'variables' | 'history' | 'comments' | 'activity' | 'reviews'
  /** Document page (size, margins). */
  pageSpec: PageSpec
  /** Snap element moves/resizes to grid when not aligned to a smart guide. */
  snapToGrid: boolean
  /** Show the grid lines on the canvas. */
  showGrid: boolean
  /** Grid spacing in pt (default 10). */
  gridSize: number
  /** Show alignment guides to margins, page center, and sibling elements while dragging. */
  smartGuidesEnabled: boolean
  /** Transient alignment lines (pt) while dragging or resizing. */
  dragGuides: DragGuideState
  /** Last pointer position over the page (pt), for status bar. */
  canvasPointerPt: { x: number; y: number } | null
  /** Visual scale of the editor page (1 = 100%). Does not change layout pt values. */
  canvasZoom: number
  setCanvasZoom: (zoom: number) => void
  /** Multiply current zoom by factor (e.g. 1.1 / 0.9), clamped. */
  adjustCanvasZoom: (factor: number) => void
  /** Spacebar held: temporary move tool (grab cursor, drag without long-press delay). */
  spaceMoveTool: boolean
  setSpaceMoveTool: (v: boolean) => void
  /** Persistent tool from the left Insert panel (Space still adds temporary move on top). */
  canvasTool: EditorCanvasTool
  setCanvasTool: (tool: EditorCanvasTool) => void
  /** Block type used when Draw tool + click on empty page. */
  placementElementType: ElementType
  setPlacementElementType: (t: ElementType) => void
  reset: () => void
  setTemplateMeta: (id: string, name: string) => void
  setVersionInfo: (versionId: string | null, versionNumber: number | null) => void
  setVariableValue: (key: string, value: string) => void
  setGlobalVariableDefinitions: (defs: VariableDefinition[]) => void
  setPageLocalVariableDefinitions: (pageId: string, defs: VariableDefinition[]) => void
  /** Load full layout including multiple pages. */
  loadLayout: (payload: ParsedLayoutResult) => void
  /** Single-page helper (e.g. empty template). */
  loadElements: (elements: LayoutElement[], page?: PageSpec) => void
  setActivePageIndex: (index: number) => void
  addPage: () => void
  removePage: (pageId: string) => void
  renamePage: (pageId: string, name: string) => void
  setPageMargins: (patch: Partial<PageMargins>) => void
  setPageSize: (size: string, orientation?: 'portrait' | 'landscape') => void
  setSnapToGrid: (v: boolean) => void
  setShowGrid: (v: boolean) => void
  setGridSize: (v: number) => void
  setSmartGuidesEnabled: (v: boolean) => void
  setDragGuides: (guides: DragGuideState) => void
  /** Add a user layout guide on the active page (pt, snapped to 10pt grid). */
  addActivePageGuide: (axis: 'vertical' | 'horizontal', positionPt: number) => void
  /** Move an existing guide on the active page (undoable). */
  moveActivePageGuide: (axis: 'vertical' | 'horizontal', index: number, positionPt: number) => void
  /** Remove one guide by index on the active page. */
  removeActivePageGuideAt: (axis: 'vertical' | 'horizontal', index: number) => void
  /** Remove all user guides on the active page. */
  clearActivePageGuides: () => void
  addActiveBandGuide: (axis: 'vertical' | 'horizontal', positionPt: number) => void
  moveActiveBandGuide: (axis: 'vertical' | 'horizontal', index: number, positionPt: number) => void
  removeActiveBandGuideAt: (axis: 'vertical' | 'horizontal', index: number) => void
  clearActiveBandGuides: () => void
  moveBandNestedLayer: (id: string, direction: 'forward' | 'backward') => void
  bringBandNestedLayerToFront: (id: string) => void
  sendBandNestedLayerToBack: (id: string) => void
  reorderBandNestedLayerDrop: (
    draggedId: string,
    targetId: string,
    position: 'before' | 'after'
  ) => void
  setCanvasPointerPt: (pt: { x: number; y: number } | null) => void
  addElement: (el: LayoutElement) => void
  updateElement: (id: string, patch: Partial<LayoutElement>, options?: { skipHistory?: boolean }) => void
  removeElement: (id: string) => void
  removeElements: (ids: string[]) => void
  /** Duplicate selected elements in-place with new IDs and a small offset. */
  duplicateElements: (ids: string[]) => void
  /** Add a comment to an element. */
  addComment: (elementId: string, text: string, author?: string) => void
  /** Add a reply to an existing comment. */
  addReply: (elementId: string, commentId: string, text: string, author?: string) => void
  /** Toggle resolved state of a comment on an element. */
  resolveComment: (elementId: string, commentId: string) => void
  /** Delete a comment (or nested reply) from an element. */
  deleteComment: (elementId: string, commentId: string) => void
  /** Set the element highlighted from the comments panel. */
  setCommentHighlightId: (id: string | null) => void
  select: (id: string | null, options?: { additive?: boolean }) => void
  groupSelection: () => void
  ungroupSelection: () => void
  setCanvasInlineEdit: (id: string | null) => void
  /** Open HEADER/FOOTER in the split band editor (sets `canvasInlineEditId` to the same element). */
  enterBandCanvasEdit: (elementId: string) => void
  setInlineTipTapEditor: (editor: TipTapEditor | null) => void
  setFocusedTextRunIndex: (index: number | null) => void
  setTableSelection: (sel: TableSelection) => void
  openTableCellEdit: (payload: { tableId: string; row: number; col: number }) => void
  setTableCellEdit: (edit: { tableId: string; row: number; col: number } | null) => void
  setViewOnly: (v: boolean) => void
  setCommentingEnabled: (v: boolean) => void
  setEditorSidebarTab: (tab: 'properties' | 'behaviour' | 'layers' | 'variables' | 'history' | 'comments' | 'activity' | 'reviews') => void
  /** Stack order: later items paint on top. Pass `pageIndex` to reorder a non-active page (e.g. page 0 bands). */
  moveLayer: (id: string, direction: 'forward' | 'backward', pageIndex?: number) => void
  bringLayerToFront: (id: string, pageIndex?: number) => void
  sendLayerToBack: (id: string, pageIndex?: number) => void
  /** `displayIds` = front → back (same as Layers list top → bottom). */
  reorderLayerDrop: (
    draggedId: string,
    targetId: string,
    position: 'before' | 'after',
    pageIndex?: number
  ) => void
  moveElement: (id: string, x: number, y: number) => void
  resizeElement: (id: string, width: number, height: number) => void
  /** Union a grouped set of shapes into one MERGED_SHAPE (all group members must be mergeable). */
  mergeGroupedShapesContaining: (elId: string) => void
  /**
   * Punch hole: subtract the smaller-bbox shape from the larger (two selected, or a group of two mergeable shapes).
   */
  subtractSelectionToMergedShape: () => void
  /** Reverse a merge: replace the selected MERGED_SHAPE with its original elements. */
  unmergeSelection: () => void
  /** User-saved snippets (localStorage); drag from left palette onto the page. */
  savedComponents: SavedLayoutComponent[]
  saveSelectionAsLayoutComponent: (name: string) => void
  removeLayoutComponent: (id: string) => void
  insertLayoutComponentAt: (componentId: string, pos: { x: number; y: number }) => void
  /**
   * Linked text frame reflow: redistribute content across a linked chain of TEXT elements.
   * Automatically creates continuation elements/pages for overflow and removes empty ones.
   */
  reflowLinkedText: (elementId: string) => void
  /** Coalesce move/resize: first call pushes one undo point; paired with `endHistoryBatch`. */
  beginHistoryBatch: () => void
  endHistoryBatch: () => void
  undo: () => void
  redo: () => void
  historyBatchDepth: number
  undoPast: EditorUndoSnapshot[]
  undoFuture: EditorUndoSnapshot[]
  /**
   * Apply a structural op received from another collaborator.
   *
   * Mutates `pages` / `globalVariableDefinitions` in place for the given op
   * without going through the editing mutations (skips undo capture, skips
   * variable-value rebuilding, skips the view-only gate). The observer in
   * `useCollab` is expected to have set `remoteOpInFlight` for the duration
   * of this call so that the diff observer does not echo the change back.
   */
  applyRemoteOp: (op: CollabOpForStore) => void
}

/**
 * Minimal op shape used by `applyRemoteOp`. Kept as a local union to avoid
 * importing from the collab module (which depends on STOMP types) here.
 * Must stay structurally compatible with `src/collab/collabBus.ts#CollabOp`.
 */
export type CollabOpForStore =
  | { type: 'addElement'; pageIndex: number; element: LayoutElement }
  | { type: 'deleteElements'; pageIndex: number; elementIds: string[] }
  | { type: 'updateElement'; pageIndex: number; elementId: string; patch: Partial<LayoutElement> }
  | {
      type: 'bulkUpdateElements'
      pageIndex: number
      updates: Array<{ elementId: string; patch: Partial<LayoutElement> }>
    }
  | { type: 'addPage'; index: number; page: LayoutDocumentPage }
  | { type: 'deletePage'; index: number }
  | { type: 'reorderPages'; from: number; to: number }
  | { type: 'updatePage'; pageIndex: number; patch: Partial<LayoutDocumentPage> }
  | { type: 'setGlobalVariables'; variables: VariableDefinition[] }
  | { type: 'setPageVariables'; pageIndex: number; variables: VariableDefinition[] | undefined }
  | { type: 'setPageSpec'; pageSpec: PageSpec }

/** Primary (last-clicked) selected element id, if any. */
export function primarySelectedId(s: Pick<EditorState, 'selectedIds'>): string | null {
  const n = s.selectedIds.length
  return n ? s.selectedIds[n - 1]! : null
}

function clampCanvasZoom(z: number): number {
  return Math.min(3, Math.max(0.25, Math.round(z * 100) / 100))
}

const clearEditorUi = {
  selectedIds: [] as string[],
  canvasInlineEditId: null,
  bandCanvasEditElementId: null as string | null,
  bandNestedEditorMounted: false,
  inlineTipTapEditor: null as TipTapEditor | null,
  focusedTextRunIndex: null,
  tableSelection: null,
  tableCellEdit: null,
  viewOnly: false,
  commentingEnabled: true,
  commentHighlightId: null as string | null,
  editorSidebarTab: 'properties' as const,
  dragGuides: { vertical: [] as number[], horizontal: [] as number[] },
  canvasPointerPt: null,
  canvasZoom: 1,
  spaceMoveTool: false,
  canvasTool: 'select' as EditorCanvasTool,
  placementElementType: 'TEXT' as ElementType,
}

/**
 * TipTap can destroy an `Editor` in-place while Zustand still holds the same reference, so subscribers
 * never re-render. We register `destroy` once per assigned instance and null the store when it fires.
 */
let inlineTipTapDestroyRegistration: { editor: TipTapEditor; onDestroy: () => void } | null = null

export function unregisterInlineTipTapDestroyListener() {
  if (!inlineTipTapDestroyRegistration) return
  const { editor: ed, onDestroy } = inlineTipTapDestroyRegistration
  inlineTipTapDestroyRegistration = null
  try {
    if (!ed.isDestroyed) ed.off('destroy', onDestroy)
  } catch {
    /* noop */
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  templateId: null,
  templateName: '',
  currentVersionId: null,
  versionNumber: null,
  pages: defaultPages(),
  activePageIndex: 0,
  savedComponents: loadLayoutComponentsFromStorage(),
  selectedIds: [],
  variableValues: {},
  globalVariableDefinitions: [],
  canvasInlineEditId: null,
  bandCanvasEditElementId: null,
  bandNestedEditorMounted: false,
  inlineTipTapEditor: null,
  focusedTextRunIndex: null,
  tableSelection: null,
  tableCellEdit: null,
  viewOnly: false,
  commentingEnabled: true,
  commentHighlightId: null,
  editorSidebarTab: 'properties',
  pageSpec: defaultPageSpec(),
  snapToGrid: true,
  showGrid: true,
  gridSize: 10,
  smartGuidesEnabled: true,
  dragGuides: { vertical: [], horizontal: [] },
  canvasPointerPt: null,
  canvasZoom: 1,
  spaceMoveTool: false,
  canvasTool: 'select',
  placementElementType: 'TEXT',
  historyBatchDepth: 0,
  undoPast: [],
  undoFuture: [],

  setSpaceMoveTool: (v) => set({ spaceMoveTool: v }),
  setCanvasTool: (tool) => set({ canvasTool: tool }),
  setPlacementElementType: (placementElementType) => set({ placementElementType }),

  reset: () =>
    withUndoSuppressed(() => {
      unregisterInlineTipTapDestroyListener()
      clearActiveCanvasTipTapEditorMap()
      return set({
        templateId: null,
        templateName: '',
        currentVersionId: null,
        versionNumber: null,
        pages: defaultPages(),
        activePageIndex: 0,
        selectedIds: [],
        variableValues: {},
        globalVariableDefinitions: [],
        canvasInlineEditId: null,
        bandCanvasEditElementId: null,
        bandNestedEditorMounted: false,
        inlineTipTapEditor: null,
        focusedTextRunIndex: null,
        tableSelection: null,
        tableCellEdit: null,
        viewOnly: false,
        commentingEnabled: true,
        commentHighlightId: null,
        editorSidebarTab: 'properties',
        pageSpec: defaultPageSpec(),
        snapToGrid: true,
        showGrid: true,
        gridSize: 10,
        smartGuidesEnabled: true,
        dragGuides: { vertical: [], horizontal: [] },
        canvasPointerPt: null,
        canvasZoom: 1,
        spaceMoveTool: false,
        canvasTool: 'select',
        placementElementType: 'TEXT',
        historyBatchDepth: 0,
        undoPast: [],
        undoFuture: [],
      })
    }),

  setBandNestedEditorMounted: (v) => set({ bandNestedEditorMounted: v }),

  exitBandCanvasEdit: () => {
    unregisterInlineTipTapDestroyListener()
    clearActiveCanvasTipTapEditorMap()
    return set((s) => {
      const flushed = tryFlushCanvasInlineEdit(s)
      return {
        ...(flushed ?? {}),
        bandCanvasEditElementId: null,
        bandNestedEditorMounted: false,
        canvasInlineEditId: null,
        inlineTipTapEditor: null,
        focusedTextRunIndex: null,
        tableSelection: null,
        tableCellEdit: null,
        selectedIds: [],
      }
    })
  },

  setTemplateMeta: (id, name) => set({ templateId: id, templateName: name }),

  setVersionInfo: (versionId, versionNumber) =>
    set({ currentVersionId: versionId, versionNumber: versionNumber }),

  setVariableValue: (key, value) =>
    set((s) => {
      if (isSystemGlobalVariableKey(normalizeCatalogVariableKey(key))) return {}
      return {
        ...takeUndoBarrier(s),
        variableValues: { ...s.variableValues, [key]: value },
      }
    }),

  setGlobalVariableDefinitions: (defs) =>
    set((s) => {
      const normalized = filterPersistableVariableDefinitions(
        defs.map((d) => ({
          key: d.key.trim(),
          // Keep description as typed (spaces); trim only when serializing in `parseVariableDefinitionList`.
          description:
            d.description === '' || d.description === undefined ? undefined : d.description,
        }))
      )
      return {
        ...takeUndoBarrier(s),
        globalVariableDefinitions: normalized,
        variableValues: mergeVariableValues(
          s.variableValues,
          allPageElements(s.pages),
          normalized,
          s.pages,
          s.activePageIndex
        ),
      }
    }),

  setPageLocalVariableDefinitions: (pageId, defs) =>
    set((s) => {
      const normalized = filterPersistableVariableDefinitions(
        defs.map((d) => ({
          key: d.key.trim(),
          description:
            d.description === '' || d.description === undefined ? undefined : d.description,
        }))
      )
      const pages = s.pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              // Keep rows with empty keys so "Add variable" shows new rows before the key is filled.
              localVariables: normalized.length > 0 ? normalized : undefined,
            }
          : p
      )
      return {
        ...takeUndoBarrier(s),
        pages,
        variableValues: mergeVariableValues(
          s.variableValues,
          allPageElements(pages),
          s.globalVariableDefinitions,
          pages,
          s.activePageIndex
        ),
      }
    }),

  loadLayout: ({ pages, page, globalVariables }) => {
    const normPages = pages.length ? pages : defaultPages()
    const globals = filterPersistableVariableDefinitions(globalVariables ?? [])
    withUndoSuppressed(() => {
      unregisterInlineTipTapDestroyListener()
      clearActiveCanvasTipTapEditorMap()
      return set((s) => ({
        pages: normPages,
        activePageIndex: 0,
        pageSpec: normalizePageSpec(page),
        globalVariableDefinitions: globals,
        variableValues: mergeVariableValues({}, allPageElements(normPages), globals, normPages, 0),
        ...clearEditorUi,
        // Preserve role-based access (viewOnly/commentingEnabled) across layout reloads
        viewOnly: s.viewOnly,
        commentingEnabled: s.commentingEnabled,
        historyBatchDepth: 0,
        undoPast: [],
        undoFuture: [],
      }))
    })
  },

  loadElements: (elements, page) =>
    get().loadLayout({
      pages: [{ id: LEGACY_SINGLE_PAGE_ID, name: 'Page 1', elements }],
      page: page ?? defaultPageSpec(),
      globalVariables: [],
    }),

  setActivePageIndex: (index) =>
    set((s) => {
      if (index < 0 || index >= s.pages.length) return {}
      return {
        activePageIndex: index,
        selectedIds: [],
        canvasInlineEditId: null,
        bandCanvasEditElementId: null,
        inlineTipTapEditor: null,
        focusedTextRunIndex: null,
        tableSelection: null,
        tableCellEdit: null,
        canvasTool: 'select',
        spaceMoveTool: false,
        variableValues: mergeVariableValues(
          s.variableValues,
          allPageElements(s.pages),
          s.globalVariableDefinitions,
          s.pages,
          index
        ),
      }
    }),

  addPage: () =>
    set((s) => {
      if (s.viewOnly) return {}
      const n = s.pages.length + 1
      const newPage: LayoutDocumentPage = { id: newPageId(), name: `Page ${n}`, elements: [] }
      const pages = [...s.pages, newPage]
      return {
        ...takeUndoBarrier(s),
        pages,
        activePageIndex: pages.length - 1,
        variableValues: mergeVariableValues(
          s.variableValues,
          allPageElements(pages),
          s.globalVariableDefinitions,
          pages,
          pages.length - 1
        ),
        selectedIds: [],
        canvasInlineEditId: null,
        bandCanvasEditElementId: null,
        inlineTipTapEditor: null,
        focusedTextRunIndex: null,
        tableSelection: null,
        tableCellEdit: null,
        canvasTool: 'select',
        spaceMoveTool: false,
      }
    }),

  removePage: (pageId) =>
    set((s) => {
      if (s.viewOnly) return {}
      if (s.pages.length <= 1) return {}
      const idx = s.pages.findIndex((p) => p.id === pageId)
      if (idx < 0) return {}
      const pages = s.pages.filter((p) => p.id !== pageId)
      let activePageIndex = s.activePageIndex
      if (idx < activePageIndex) activePageIndex--
      else if (idx === activePageIndex) activePageIndex = Math.min(activePageIndex, pages.length - 1)
      return {
        ...takeUndoBarrier(s),
        pages,
        activePageIndex,
        variableValues: mergeVariableValues(
          s.variableValues,
          allPageElements(pages),
          s.globalVariableDefinitions,
          pages,
          activePageIndex
        ),
        selectedIds: [],
        canvasInlineEditId: null,
        inlineTipTapEditor: null,
        focusedTextRunIndex: null,
        tableSelection: null,
        tableCellEdit: null,
        canvasTool: 'select',
        spaceMoveTool: false,
      }
    }),

  renamePage: (pageId, name) =>
    set((s) => {
      if (s.viewOnly) return {}
      return {
        ...takeUndoBarrier(s),
        pages: s.pages.map((p) =>
          p.id === pageId ? { ...p, name: name.trim() || p.name } : p
        ),
      }
    }),

  addElement: (el) =>
    set((s) => {
      if (s.viewOnly) return {}
      if (s.bandNestedEditorMounted && s.bandCanvasEditElementId) {
        if (el.type === 'HEADER' || el.type === 'FOOTER') return {}
        const loc = findElementLocation(s, s.bandCanvasEditElementId)
        if (!loc) return {}
        const c = loc.el
        if (c.type !== 'HEADER' && c.type !== 'FOOTER') return {}
        const { w, h } = bandViewportDims(s, c)
        const placed = placeBandElementOnDrop(el, w, h)
        const nested = [...(c.bandElements ?? []), placed]
        return {
          ...takeUndoBarrier(s),
          ...patchBandContainer(s, c.id, (box) => ({ ...box, bandElements: nested })),
          selectedIds: [placed.id],
        }
      }
      const placed = clampElementLayoutToPrintMargins(el, s.pageSpec, s.gridSize)
      const elements = [...activeElements(s), placed]
      return {
        ...takeUndoBarrier(s),
        ...replaceActiveElements(s, elements),
        selectedIds: [placed.id],
      }
    }),

  saveSelectionAsLayoutComponent: (name) =>
    set((s) => {
      const nameTrim = name.trim()
      if (!nameTrim) return {}
      let elements = activeElements(s)
      if (s.bandNestedEditorMounted && s.bandCanvasEditElementId) {
        const loc = findElementLocation(s, s.bandCanvasEditElementId)
        if (!loc) return {}
        elements = loc.el.bandElements ?? []
      }
      const sel = new Set(s.selectedIds)
      if (sel.size === 0) return {}
      const groupIds = new Set(
        elements.filter((e) => sel.has(e.id) && e.groupId).map((e) => e.groupId as string)
      )
      const idSet = new Set(sel)
      for (const e of elements) {
        if (e.groupId && groupIds.has(e.groupId)) idSet.add(e.id)
      }
      const order = elements.filter((e) => idSet.has(e.id))
      if (order.length === 0) return {}
      let minX = Infinity
      let minY = Infinity
      for (const e of order) {
        minX = Math.min(minX, e.x)
        minY = Math.min(minY, e.y)
      }
      const normalized: LayoutElement[] = order.map((e) => ({
        ...e,
        x: e.x - minX,
        y: e.y - minY,
        groupId: undefined,
      }))
      const comp: SavedLayoutComponent = {
        id: `comp_${crypto.randomUUID().slice(0, 10)}`,
        name: nameTrim,
        elements: normalized,
      }
      const savedComponents = [...s.savedComponents, comp]
      persistLayoutComponents(savedComponents)
      return { savedComponents }
    }),

  removeLayoutComponent: (id) =>
    set((s) => {
      const savedComponents = s.savedComponents.filter((c) => c.id !== id)
      persistLayoutComponents(savedComponents)
      return { savedComponents }
    }),

  insertLayoutComponentAt: (componentId, pos) =>
    set((s) => {
      const saved = s.savedComponents.find((c) => c.id === componentId)
      if (!saved || saved.elements.length === 0) return {}
      const newEls = instantiateSavedComponent(saved, pos.x, pos.y).map((e) =>
        clampElementLayoutToPrintMargins(e, s.pageSpec, s.gridSize)
      )
      if (s.bandNestedEditorMounted && s.bandCanvasEditElementId) {
        const loc = findElementLocation(s, s.bandCanvasEditElementId)
        if (!loc) return {}
        const c = loc.el
        if (c.type !== 'HEADER' && c.type !== 'FOOTER') return {}
        const { w, h } = bandViewportDims(s, c)
        const clamped = newEls.map((e) => placeBandElementOnDrop(e, w, h))
        if (clamped.some((e) => e.type === 'HEADER' || e.type === 'FOOTER')) return {}
        const nested = [...(c.bandElements ?? []), ...clamped]
        return {
          ...takeUndoBarrier(s),
          ...patchBandContainer(s, c.id, (box) => ({ ...box, bandElements: nested })),
          selectedIds: clamped.map((e) => e.id),
        }
      }
      const merged = [...activeElements(s), ...newEls]
      return {
        ...takeUndoBarrier(s),
        ...replaceActiveElements(s, merged),
        selectedIds: newEls.map((e) => e.id),
      }
    }),

  updateElement: (id, patch, options) =>
    set((s) => {
      if (s.viewOnly) return {}
      const hit = findBandNestedChild(s.pages, id)
      if (hit) {
        let merged: LayoutElement = { ...hit.child, ...patch }
        if (
          patch.x !== undefined ||
          patch.y !== undefined ||
          patch.width !== undefined ||
          patch.height !== undefined
        ) {
          const { w, h } = bandViewportDims(s, hit.container)
          merged = clampBandNestedElement(merged, w, h)
        }
        const nextNested = hit.container.bandElements!.map((e) => (e.id === id ? merged : e))
        return {
          ...(options?.skipHistory ? {} : takeUndoBarrier(s)),
          ...patchBandContainer(s, hit.container.id, (c) => ({ ...c, bandElements: nextNested }), options),
        }
      }
      const loc = findElementLocation(s, id)
      if (!loc) return {}
      let merged: LayoutElement = { ...loc.el, ...patch }
      if (
        patch.x !== undefined ||
        patch.y !== undefined ||
        patch.width !== undefined ||
        patch.height !== undefined
      ) {
        merged = clampElementLayoutToPrintMargins(merged, s.pageSpec, s.gridSize)
        merged = reclampBandChildrenToContainer(s, merged)
      }
      const elements = loc.elements.map((e) => (e.id === id ? merged : e))
      const barrier = options?.skipHistory ? {} : takeUndoBarrier(s)
      return { ...barrier, ...replacePageElements(s, loc.pageIndex, elements) }
    }),

  removeElement: (id) =>
    set((s) => {
      if (s.viewOnly) return {}
      const nestedHit = findBandNestedChild(s.pages, id)
      if (nestedHit) {
        const wasInSelection = s.selectedIds.includes(id)
        const nextNested = nestedHit.container.bandElements!.filter((e) => e.id !== id)
        return {
          ...takeUndoBarrier(s),
          ...patchBandContainer(s, nestedHit.container.id, (c) => ({ ...c, bandElements: nextNested })),
          selectedIds: s.selectedIds.filter((i) => i !== id),
          canvasInlineEditId: s.canvasInlineEditId === id ? null : s.canvasInlineEditId,
          inlineTipTapEditor: s.canvasInlineEditId === id ? null : s.inlineTipTapEditor,
          focusedTextRunIndex: wasInSelection ? null : s.focusedTextRunIndex,
          tableSelection:
            wasInSelection || s.tableSelection?.tableId === id ? null : s.tableSelection,
          tableCellEdit:
            wasInSelection || s.tableCellEdit?.tableId === id ? null : s.tableCellEdit,
        }
      }
      const loc = findElementLocation(s, id)
      if (!loc) return {}
      const elements = loc.elements.filter((e) => e.id !== id)
      const wasInSelection = s.selectedIds.includes(id)
      return {
        ...takeUndoBarrier(s),
        ...replacePageElements(s, loc.pageIndex, elements),
        selectedIds: s.selectedIds.filter((i) => i !== id),
        canvasInlineEditId: s.canvasInlineEditId === id ? null : s.canvasInlineEditId,
        bandCanvasEditElementId: s.bandCanvasEditElementId === id ? null : s.bandCanvasEditElementId,
        bandNestedEditorMounted:
          s.bandCanvasEditElementId === id ? false : s.bandNestedEditorMounted,
        inlineTipTapEditor: s.canvasInlineEditId === id ? null : s.inlineTipTapEditor,
        focusedTextRunIndex: wasInSelection ? null : s.focusedTextRunIndex,
        tableSelection:
          wasInSelection || s.tableSelection?.tableId === id ? null : s.tableSelection,
        tableCellEdit:
          wasInSelection || s.tableCellEdit?.tableId === id ? null : s.tableCellEdit,
      }
    }),

  removeElements: (ids) =>
    set((s) => {
      if (s.viewOnly) return {}
      const remove = new Set(ids)
      if (remove.size === 0) return {}

      // Collect dataKeys from TABLE elements being removed (for variable cleanup)
      const removedTableDataKeys = new Set<string>()
      for (const p of s.pages) {
        for (const e of p.elements) {
          if (remove.has(e.id) && e.type === 'TABLE' && e.dataKey) {
            removedTableDataKeys.add(e.dataKey)
          }
        }
      }

      const pages = s.pages.map((p) => {
        const filtered = p.elements.filter((e) => !remove.has(e.id))
        // Clean up page-local variable definitions for removed table data keys
        const locals = p.localVariables
        const cleanedLocals =
          removedTableDataKeys.size > 0 && locals?.length
            ? locals.filter((d) => !removedTableDataKeys.has(d.key))
            : locals
        return {
          ...p,
          elements: filtered,
          ...(cleanedLocals !== locals ? { localVariables: cleanedLocals?.length ? cleanedLocals : undefined } : {}),
        }
      })

      // Clean up global variable definitions for removed table data keys
      const globalDefs =
        removedTableDataKeys.size > 0
          ? s.globalVariableDefinitions.filter((d) => !removedTableDataKeys.has(d.key))
          : s.globalVariableDefinitions

      const hitEdit = s.canvasInlineEditId != null && remove.has(s.canvasInlineEditId)
      const hitBand = s.bandCanvasEditElementId != null && remove.has(s.bandCanvasEditElementId)
      const hitTable =
        (s.tableSelection && remove.has(s.tableSelection.tableId)) ||
        (s.tableCellEdit && remove.has(s.tableCellEdit.tableId))
      return {
        ...takeUndoBarrier(s),
        pages,
        globalVariableDefinitions: globalDefs,
        variableValues: mergeVariableValues(
          s.variableValues,
          allPageElements(pages),
          globalDefs,
          pages,
          s.activePageIndex
        ),
        selectedIds: s.selectedIds.filter((i) => !remove.has(i)),
        canvasInlineEditId: hitEdit ? null : s.canvasInlineEditId,
        bandCanvasEditElementId: hitBand ? null : s.bandCanvasEditElementId,
        inlineTipTapEditor: hitEdit ? null : s.inlineTipTapEditor,
        focusedTextRunIndex: hitEdit ? null : s.focusedTextRunIndex,
        tableSelection: hitTable ? null : s.tableSelection,
        tableCellEdit: hitTable ? null : s.tableCellEdit,
      }
    }),

  duplicateElements: (ids) =>
    set((s) => {
      if (s.viewOnly) return {}
      if (ids.length === 0) return {}
      const idSet = new Set(ids)
      const src = activeElements(s).filter((e) => idSet.has(e.id))
      if (src.length === 0) return {}
      const OFFSET = 10
      const clones = src.map((e) => ({
        ...structuredClone(e),
        id: newElementId(),
        x: e.x + OFFSET,
        y: e.y + OFFSET,
        groupId: undefined as string | undefined,
      }))
      const elements = [...activeElements(s), ...clones]
      return {
        ...takeUndoBarrier(s),
        ...replaceActiveElements(s, elements),
        selectedIds: clones.map((c) => c.id),
      }
    }),

  addComment: (elementId, text, author) =>
    set((s) => {
      // Defense in depth — the CommentsPanel already hides the add-comment UI
      // when commentingEnabled is false (VIEWER role). Block at the store too
      // so any stray call-site can't slip past.
      if (!s.commentingEnabled) return {}
      const elements = activeElements(s)
      const idx = elements.findIndex((e) => e.id === elementId)
      if (idx === -1) return {}
      const el = elements[idx]
      const comment: ElementComment = {
        id: newElementId(),
        text,
        author: author ?? 'User',
        createdAt: new Date().toISOString(),
      }
      const updated = [...elements]
      updated[idx] = { ...el, comments: [...(el.comments ?? []), comment] }
      return { ...takeUndoBarrier(s), ...replaceActiveElements(s, updated) }
    }),

  addReply: (elementId, commentId, text, author) =>
    set((s) => {
      if (!s.commentingEnabled) return {}
      const elements = activeElements(s)
      const idx = elements.findIndex((e) => e.id === elementId)
      if (idx === -1) return {}
      const el = elements[idx]
      const reply: ElementComment = {
        id: newElementId(),
        text,
        author: author ?? 'User',
        createdAt: new Date().toISOString(),
      }
      const addReplyDeep = (comments: ElementComment[]): ElementComment[] =>
        comments.map((c) =>
          c.id === commentId
            ? { ...c, replies: [...(c.replies ?? []), reply] }
            : c.replies?.length
              ? { ...c, replies: addReplyDeep(c.replies) }
              : c,
        )
      const updated = [...elements]
      updated[idx] = { ...el, comments: addReplyDeep(el.comments ?? []) }
      return { ...takeUndoBarrier(s), ...replaceActiveElements(s, updated) }
    }),

  resolveComment: (elementId, commentId) =>
    set((s) => {
      if (!s.commentingEnabled) return {}
      const elements = activeElements(s)
      const idx = elements.findIndex((e) => e.id === elementId)
      if (idx === -1) return {}
      const el = elements[idx]
      const resolveDeep = (comments: ElementComment[]): ElementComment[] =>
        comments.map((c) =>
          c.id === commentId
            ? { ...c, resolved: true }
            : c.replies?.length
              ? { ...c, replies: resolveDeep(c.replies) }
              : c,
        )
      const updated = [...elements]
      updated[idx] = { ...el, comments: resolveDeep(el.comments ?? []) }
      return { ...takeUndoBarrier(s), ...replaceActiveElements(s, updated) }
    }),

  deleteComment: (elementId, commentId) =>
    set((s) => {
      if (!s.commentingEnabled) return {}
      const elements = activeElements(s)
      const idx = elements.findIndex((e) => e.id === elementId)
      if (idx === -1) return {}
      const el = elements[idx]
      // Recursively filter: remove from top-level or from any reply tree
      const removeDeep = (comments: ElementComment[]): ElementComment[] =>
        comments
          .filter((c) => c.id !== commentId)
          .map((c) =>
            c.replies?.length ? { ...c, replies: removeDeep(c.replies) } : c,
          )
      const updated = [...elements]
      updated[idx] = { ...el, comments: removeDeep(el.comments ?? []) }
      return { ...takeUndoBarrier(s), ...replaceActiveElements(s, updated) }
    }),

  setCommentHighlightId: (id) => set({ commentHighlightId: id }),

  groupSelection: () =>
    set((s) => {
      if (s.viewOnly) return {}
      const ids = s.selectedIds
      if (ids.length < 2) return {}
      const gid = newGroupId()
      const idSet = new Set(ids)
      if (s.bandNestedEditorMounted && s.bandCanvasEditElementId) {
        const loc = findElementLocation(s, s.bandCanvasEditElementId)
        if (!loc) return {}
        const c = loc.el
        const cur = c.bandElements ?? []
        const next = cur.map((e) => (idSet.has(e.id) ? { ...e, groupId: gid } : e))
        return { ...takeUndoBarrier(s), ...patchBandContainer(s, c.id, (box) => ({ ...box, bandElements: next })) }
      }
      const elements = activeElements(s).map((e) =>
        idSet.has(e.id) ? { ...e, groupId: gid } : e
      )
      return { ...takeUndoBarrier(s), ...replaceActiveElements(s, elements) }
    }),

  ungroupSelection: () =>
    set((s) => {
      if (s.viewOnly) return {}
      const sel = new Set(s.selectedIds)
      if (sel.size === 0) return {}
      if (s.bandNestedEditorMounted && s.bandCanvasEditElementId) {
        const loc = findElementLocation(s, s.bandCanvasEditElementId)
        if (!loc) return {}
        const elements = loc.el.bandElements ?? []
        const groupIds = new Set(
          elements.filter((e) => sel.has(e.id) && e.groupId).map((e) => e.groupId as string)
        )
        if (groupIds.size === 0) return {}
        const next = elements.map((e) =>
          e.groupId && groupIds.has(e.groupId) ? { ...e, groupId: undefined } : e
        )
        return {
          ...takeUndoBarrier(s),
          ...patchBandContainer(s, loc.el.id, (box) => ({ ...box, bandElements: next })),
        }
      }
      const elements = activeElements(s)
      const groupIds = new Set(
        elements.filter((e) => sel.has(e.id) && e.groupId).map((e) => e.groupId as string)
      )
      if (groupIds.size === 0) return {}
      const next = elements.map((e) =>
        e.groupId && groupIds.has(e.groupId) ? { ...e, groupId: undefined } : e
      )
      return { ...takeUndoBarrier(s), ...replaceActiveElements(s, next) }
    }),

  select: (id, opts) =>
    set((s) => {
      if (s.bandCanvasEditElementId != null) {
        if (id == null) {
          const flushed = tryFlushCanvasInlineEdit(s)
          return {
            ...(flushed ?? {}),
            selectedIds: [],
            canvasInlineEditId: null,
            inlineTipTapEditor: null,
            focusedTextRunIndex: null,
            tableSelection: null,
            tableCellEdit: null,
          }
        }
        if (opts?.additive) return {}
        if (isBandChildOf(s.pages, s.bandCanvasEditElementId, id)) {
          if (id === s.canvasInlineEditId) {
            return s.selectedIds.length === 1 && s.selectedIds[0] === id
              ? {}
              : { selectedIds: [id] }
          }
          return {
            selectedIds: [id],
            canvasInlineEditId: null,
            inlineTipTapEditor: null,
            focusedTextRunIndex: null,
            tableSelection: null,
            tableCellEdit: null,
          }
        }
        const loc = findElementLocation(s, id)
        if (!loc) return {}
        const { el, pageIndex } = loc
        if (pageIndex !== 0 || (el.type !== 'HEADER' && el.type !== 'FOOTER')) return {}
        // Re-selecting the same open band (e.g. pointer bubbling from TipTap) must not clear inline edit.
        if (el.id === s.bandCanvasEditElementId && s.canvasInlineEditId != null) {
          return {}
        }
        const firstBand = el.bandElements?.[0]?.id
        return {
          bandCanvasEditElementId: id,
          bandNestedEditorMounted: true,
          canvasInlineEditId: null,
          selectedIds: firstBand ? [firstBand] : [],
          inlineTipTapEditor: null,
          focusedTextRunIndex: null,
          tableSelection: null,
          tableCellEdit: null,
        }
      }
      if (id == null) {
        const flushed = tryFlushCanvasInlineEdit(s)
        return {
          ...(flushed ?? {}),
          selectedIds: [],
          canvasInlineEditId: null,
          bandCanvasEditElementId: null,
          bandNestedEditorMounted: false,
          inlineTipTapEditor: null,
          focusedTextRunIndex: null,
          tableSelection: null,
          tableCellEdit: null,
        }
      }
      const additive = opts?.additive ?? false
      let nextIds: string[]
      if (!additive) {
        nextIds = [id]
      } else {
        const i = s.selectedIds.indexOf(id)
        nextIds = i >= 0 ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
      }
      const seen = new Set<string>()
      nextIds = nextIds.filter((x) => {
        if (seen.has(x)) return false
        seen.add(x)
        return true
      })

      let nextEdit = s.canvasInlineEditId
      if (nextIds.length > 1) nextEdit = null
      else if (nextEdit != null && !nextIds.includes(nextEdit)) nextEdit = null

      const primary = nextIds.length === 1 ? nextIds[0] : null
      const keepRunFocus =
        primary != null &&
        s.canvasInlineEditId === primary &&
        s.focusedTextRunIndex != null

      let nextTable = s.tableSelection
      if (primary == null || (nextTable != null && nextTable.tableId !== primary)) {
        nextTable = null
      }
      let nextCellEdit = s.tableCellEdit
      if (primary == null || (nextCellEdit != null && nextCellEdit.tableId !== primary)) {
        nextCellEdit = null
      }

      const flushed =
        s.canvasInlineEditId && s.inlineTipTapEditor && nextEdit === null
          ? tryFlushCanvasInlineEdit(s)
          : null

      const nextBand =
        nextEdit != null &&
        nextIds.length === 1 &&
        nextIds[0] === s.bandCanvasEditElementId &&
        s.bandCanvasEditElementId != null
          ? s.bandCanvasEditElementId
          : null

      return {
        ...(flushed ?? {}),
        selectedIds: nextIds,
        canvasInlineEditId: nextEdit,
        bandCanvasEditElementId: nextBand,
        inlineTipTapEditor:
          nextEdit == null
            ? null
            : nextEdit === s.canvasInlineEditId
              ? s.inlineTipTapEditor
              : null,
        focusedTextRunIndex: keepRunFocus ? s.focusedTextRunIndex : null,
        tableSelection: nextTable,
        tableCellEdit: nextCellEdit,
      }
    }),

  enterBandCanvasEdit: (elementId) =>
    set((s) => {
      if (s.viewOnly) return {}
      const loc = findElementLocation(s, elementId)
      if (!loc) return {}
      const el = loc.el
      if (el.type !== 'HEADER' && el.type !== 'FOOTER') return {}
      if (loc.pageIndex !== 0) return {}
      const migrated = ensureBandElementsFromLegacy(loc.el, s.pageSpec)
      let pages = s.pages
      if (migrated !== loc.el) {
        const els = loc.elements.map((e) => (e.id === elementId ? migrated : e))
        pages = s.pages.map((p, i) => (i === loc.pageIndex ? { ...p, elements: els } : p))
      }
      const nextVar = mergeVariableValues(
        s.variableValues,
        allPageElements(pages),
        s.globalVariableDefinitions,
        pages,
        s.activePageIndex
      )
      const firstBandChildId = migrated.bandElements?.[0]?.id
      const selectedIds = firstBandChildId ? [firstBandChildId] : []
      if (s.bandCanvasEditElementId != null) {
        if (s.bandCanvasEditElementId === elementId) return {}
        return {
          pages,
          variableValues: nextVar,
          bandCanvasEditElementId: elementId,
          bandNestedEditorMounted: true,
          canvasInlineEditId: null,
          selectedIds,
          inlineTipTapEditor: null,
          focusedTextRunIndex: null,
          tableSelection: null,
          tableCellEdit: null,
        }
      }
      return {
        pages,
        variableValues: nextVar,
        bandCanvasEditElementId: elementId,
        bandNestedEditorMounted: true,
        canvasInlineEditId: null,
        selectedIds,
        inlineTipTapEditor: null,
        focusedTextRunIndex: null,
        tableSelection: null,
        tableCellEdit: null,
      }
    }),

  setCanvasInlineEdit: (id) =>
    set((s) => {
      if (id === null) {
        const flushed = tryFlushCanvasInlineEdit(s)
        return {
          ...(flushed ?? {}),
          canvasInlineEditId: null,
          inlineTipTapEditor: null,
          focusedTextRunIndex: null,
        }
      }
      if (s.viewOnly) return {}
      const bandNested = findBandNestedChild(s.pages, id)
      if (bandNested && s.bandCanvasEditElementId !== bandNested.container.id) {
        return {}
      }
      if (s.bandCanvasEditElementId != null) {
        if (id === s.bandCanvasEditElementId) return {}
        if (isBandChildOf(s.pages, s.bandCanvasEditElementId, id)) {
          return { canvasInlineEditId: id }
        }
        return {}
      }
      return {
        canvasInlineEditId: id,
        bandCanvasEditElementId: null,
        inlineTipTapEditor: null,
        focusedTextRunIndex: null,
      }
    }),

  setInlineTipTapEditor: (editor) => {
    unregisterInlineTipTapDestroyListener()
    if (editor?.isDestroyed) {
      richTextDebugLog('store', 'setInlineTipTapEditor rejected destroyed', {})
      removeActiveCanvasTipTapEditorFromMapByInstance(editor)
      return set({ inlineTipTapEditor: null })
    }
    if (!editor) {
      return set({ inlineTipTapEditor: null })
    }
    const onDestroy = () => {
      if (inlineTipTapDestroyRegistration?.editor === editor) {
        inlineTipTapDestroyRegistration = null
      }
      useEditorStore.setState((s) =>
        s.inlineTipTapEditor === editor ? { inlineTipTapEditor: null } : {}
      )
    }
    inlineTipTapDestroyRegistration = { editor, onDestroy }
    editor.on('destroy', onDestroy)
    richTextDebugLog('store', 'setInlineTipTapEditor', {
      hasEditor: !!editor,
      isDestroyed: editor?.isDestroyed,
    })
    return set({ inlineTipTapEditor: editor })
  },

  setFocusedTextRunIndex: (index) => set({ focusedTextRunIndex: index }),

  setTableSelection: (sel) =>
    set((s) => {
      const keepEdit =
        sel?.mode === 'cell' &&
        s.tableCellEdit &&
        sel.tableId === s.tableCellEdit.tableId &&
        sel.row === s.tableCellEdit.row &&
        sel.col === s.tableCellEdit.col
      return {
        tableSelection: sel,
        tableCellEdit: keepEdit ? s.tableCellEdit : null,
      }
    }),

  openTableCellEdit: ({ tableId, row, col }) =>
    set((s) => {
      if (s.viewOnly) return {}
      return {
        tableSelection: { tableId, mode: 'cell', row, col },
        tableCellEdit: { tableId, row, col },
      }
    }),

  setTableCellEdit: (edit) => set({ tableCellEdit: edit, ...(edit === null ? { inlineTipTapEditor: null } : {}) }),

  setViewOnly: (v) => set({ viewOnly: v }),

  setCommentingEnabled: (v) => set({ commentingEnabled: v }),

  setEditorSidebarTab: (tab) => set({ editorSidebarTab: tab }),

  moveLayer: (id, direction, pageIndex) =>
    set((s) => {
      if (s.viewOnly) return {}
      const pi = pageIndex ?? s.activePageIndex
      const cur = s.pages[pi]?.elements ?? []
      const i = cur.findIndex((e) => e.id === id)
      if (i < 0) return {}
      const els = [...cur]
      if (direction === 'forward' && i < els.length - 1) {
        ;[els[i], els[i + 1]] = [els[i + 1], els[i]]
      } else if (direction === 'backward' && i > 0) {
        ;[els[i], els[i - 1]] = [els[i - 1], els[i]]
      } else return {}
      return { ...takeUndoBarrier(s), ...replacePageElements(s, pi, els) }
    }),

  bringLayerToFront: (id, pageIndex) =>
    set((s) => {
      if (s.viewOnly) return {}
      const pi = pageIndex ?? s.activePageIndex
      const cur = s.pages[pi]?.elements ?? []
      const i = cur.findIndex((e) => e.id === id)
      if (i < 0 || i === cur.length - 1) return {}
      const els = [...cur]
      const [item] = els.splice(i, 1)
      els.push(item)
      return { ...takeUndoBarrier(s), ...replacePageElements(s, pi, els) }
    }),

  sendLayerToBack: (id, pageIndex) =>
    set((s) => {
      if (s.viewOnly) return {}
      const pi = pageIndex ?? s.activePageIndex
      const cur = s.pages[pi]?.elements ?? []
      const i = cur.findIndex((e) => e.id === id)
      if (i <= 0) return {}
      const els = [...cur]
      const [item] = els.splice(i, 1)
      els.unshift(item)
      return { ...takeUndoBarrier(s), ...replacePageElements(s, pi, els) }
    }),

  reorderLayerDrop: (draggedId, targetId, position, pageIndex) =>
    set((s) => {
      if (s.viewOnly) return {}
      if (draggedId === targetId) return {}
      const pi = pageIndex ?? s.activePageIndex
      const cur = s.pages[pi]?.elements ?? []
      const displayIds = [...cur].reverse().map((e) => e.id)
      const nextIds = reorderIdsInList(displayIds, draggedId, targetId, position)
      const byId = new Map(cur.map((e) => [e.id, e]))
      const elements = nextIds.map((id) => byId.get(id)).filter(Boolean) as LayoutElement[]
      if (elements.length !== cur.length) return {}
      return { ...takeUndoBarrier(s), ...replacePageElements(s, pi, elements) }
    }),

  setPageMargins: (patch) =>
    set((s) => ({
      ...takeUndoBarrier(s),
      pageSpec: {
        ...s.pageSpec,
        margins: { ...s.pageSpec.margins, ...patch },
      },
    })),

  setPageSize: (size, orientation) =>
    set((s) => ({
      ...takeUndoBarrier(s),
      pageSpec: {
        ...s.pageSpec,
        size,
        ...(orientation != null ? { orientation } : {}),
      },
    })),

  setSnapToGrid: (v) => set({ snapToGrid: v }),
  setShowGrid: (v) => set({ showGrid: v }),
  setGridSize: (v) => set({ gridSize: Math.max(2, Math.round(v)) }),
  setSmartGuidesEnabled: (v) => set({ smartGuidesEnabled: v }),

  setDragGuides: (guides) => set({ dragGuides: guides }),

  addActivePageGuide: (axis, positionPt) =>
    set((s) => {
      const i = s.activePageIndex
      const p = s.pages[i]
      if (!p) return {}
      const { width: pw, height: ph } = pageDimensionsPt(s.pageSpec)
      const g = p.guides ?? { vertical: [], horizontal: [] }
      const clamped =
        axis === 'vertical'
          ? Math.max(0, Math.min(pw, positionPt))
          : Math.max(0, Math.min(ph, positionPt))
      const pos = snap(clamped)
      const nextArr =
        axis === 'vertical' ? [...g.vertical, pos] : [...g.horizontal, pos]
      const dedup = [...new Set(nextArr.map((n) => snap(n)))].sort((a, b) => a - b)
      const next: PageGuides =
        axis === 'vertical' ? { vertical: dedup, horizontal: [...g.horizontal] } : { vertical: [...g.vertical], horizontal: dedup }
      const pages = s.pages.map((pg, idx) => (idx === i ? { ...p, guides: next } : pg))
      return { ...takeUndoBarrier(s), pages }
    }),

  moveActivePageGuide: (axis, index, positionPt) =>
    set((s) => {
      const i = s.activePageIndex
      const p = s.pages[i]
      if (!p?.guides) return {}
      const { width: pw, height: ph } = pageDimensionsPt(s.pageSpec)
      const g = p.guides
      const arr = axis === 'vertical' ? [...g.vertical] : [...g.horizontal]
      if (index < 0 || index >= arr.length) return {}
      const clamped =
        axis === 'vertical'
          ? Math.max(0, Math.min(pw, positionPt))
          : Math.max(0, Math.min(ph, positionPt))
      arr[index] = snap(clamped)
      const dedup = [...new Set(arr.map((n) => snap(n)))].sort((a, b) => a - b)
      const next: PageGuides =
        axis === 'vertical'
          ? { vertical: dedup, horizontal: [...g.horizontal] }
          : { vertical: [...g.vertical], horizontal: dedup }
      const pages = s.pages.map((pg, idx) => (idx === i ? { ...p, guides: next } : pg))
      return { ...takeUndoBarrier(s), pages }
    }),

  removeActivePageGuideAt: (axis, index) =>
    set((s) => {
      const i = s.activePageIndex
      const p = s.pages[i]
      if (!p?.guides) return {}
      const g = p.guides
      const arr = axis === 'vertical' ? [...g.vertical] : [...g.horizontal]
      if (index < 0 || index >= arr.length) return {}
      arr.splice(index, 1)
      const next: PageGuides =
        axis === 'vertical'
          ? { vertical: arr, horizontal: [...g.horizontal] }
          : { vertical: [...g.vertical], horizontal: arr }
      const pages = s.pages.map((pg, idx) =>
        idx === i
          ? {
              ...p,
              guides:
                next.vertical.length || next.horizontal.length ? next : undefined,
            }
          : pg
      )
      return { ...takeUndoBarrier(s), pages }
    }),

  clearActivePageGuides: () =>
    set((s) => {
      const i = s.activePageIndex
      const pages = s.pages.map((p, idx) => (idx === i ? { ...p, guides: undefined } : p))
      return { ...takeUndoBarrier(s), pages }
    }),

  addActiveBandGuide: (axis, positionPt) =>
    set((s) => {
      if (!s.bandNestedEditorMounted || !s.bandCanvasEditElementId) return {}
      const loc = findElementLocation(s, s.bandCanvasEditElementId)
      if (!loc) return {}
      const c = loc.el
      if (c.type !== 'HEADER' && c.type !== 'FOOTER') return {}
      const { w: pw, h: ph } = bandViewportDims(s, c)
      const g = c.bandGuides ?? { vertical: [], horizontal: [] }
      const clamped =
        axis === 'vertical'
          ? Math.max(0, Math.min(pw, positionPt))
          : Math.max(0, Math.min(ph, positionPt))
      const pos = snap(clamped)
      const nextArr = axis === 'vertical' ? [...g.vertical, pos] : [...g.horizontal, pos]
      const dedup = [...new Set(nextArr.map((n) => snap(n)))].sort((a, b) => a - b)
      const next: PageGuides =
        axis === 'vertical'
          ? { vertical: dedup, horizontal: [...g.horizontal] }
          : { vertical: [...g.vertical], horizontal: dedup }
      return { ...takeUndoBarrier(s), ...patchBandContainer(s, c.id, (box) => ({ ...box, bandGuides: next })) }
    }),

  moveActiveBandGuide: (axis, index, positionPt) =>
    set((s) => {
      if (!s.bandNestedEditorMounted || !s.bandCanvasEditElementId) return {}
      const loc = findElementLocation(s, s.bandCanvasEditElementId)
      if (!loc) return {}
      const c = loc.el
      if (c.type !== 'HEADER' && c.type !== 'FOOTER') return {}
      const g = c.bandGuides
      if (!g) return {}
      const { w: pw, h: ph } = bandViewportDims(s, c)
      const arr = axis === 'vertical' ? [...g.vertical] : [...g.horizontal]
      if (index < 0 || index >= arr.length) return {}
      const clamped =
        axis === 'vertical'
          ? Math.max(0, Math.min(pw, positionPt))
          : Math.max(0, Math.min(ph, positionPt))
      arr[index] = snap(clamped)
      const dedup = [...new Set(arr.map((n) => snap(n)))].sort((a, b) => a - b)
      const next: PageGuides =
        axis === 'vertical'
          ? { vertical: dedup, horizontal: [...g.horizontal] }
          : { vertical: [...g.vertical], horizontal: dedup }
      return { ...takeUndoBarrier(s), ...patchBandContainer(s, c.id, (box) => ({ ...box, bandGuides: next })) }
    }),

  removeActiveBandGuideAt: (axis, index) =>
    set((s) => {
      if (!s.bandNestedEditorMounted || !s.bandCanvasEditElementId) return {}
      const loc = findElementLocation(s, s.bandCanvasEditElementId)
      if (!loc) return {}
      const c = loc.el
      const g = c.bandGuides
      if (!g) return {}
      const arr = axis === 'vertical' ? [...g.vertical] : [...g.horizontal]
      if (index < 0 || index >= arr.length) return {}
      arr.splice(index, 1)
      const next: PageGuides =
        axis === 'vertical'
          ? { vertical: arr, horizontal: [...g.horizontal] }
          : { vertical: [...g.vertical], horizontal: arr }
      const cleared =
        next.vertical.length || next.horizontal.length ? next : undefined
      return {
        ...takeUndoBarrier(s),
        ...patchBandContainer(s, c.id, (box) => ({ ...box, bandGuides: cleared })),
      }
    }),

  clearActiveBandGuides: () =>
    set((s) => {
      if (!s.bandCanvasEditElementId) return {}
      return {
        ...takeUndoBarrier(s),
        ...patchBandContainer(s, s.bandCanvasEditElementId, (box) => ({ ...box, bandGuides: undefined })),
      }
    }),

  moveBandNestedLayer: (id, direction) =>
    set((s) => {
      if (!s.bandCanvasEditElementId) return {}
      const loc = findElementLocation(s, s.bandCanvasEditElementId)
      if (!loc) return {}
      const c = loc.el
      const cur = [...(c.bandElements ?? [])]
      const i = cur.findIndex((e) => e.id === id)
      if (i < 0) return {}
      const els = [...cur]
      if (direction === 'forward' && i < els.length - 1) {
        ;[els[i], els[i + 1]] = [els[i + 1], els[i]]
      } else if (direction === 'backward' && i > 0) {
        ;[els[i], els[i - 1]] = [els[i - 1], els[i]]
      } else return {}
      return { ...takeUndoBarrier(s), ...patchBandContainer(s, c.id, (b) => ({ ...b, bandElements: els })) }
    }),

  bringBandNestedLayerToFront: (id) =>
    set((s) => {
      if (!s.bandCanvasEditElementId) return {}
      const loc = findElementLocation(s, s.bandCanvasEditElementId)
      if (!loc) return {}
      const c = loc.el
      const cur = [...(c.bandElements ?? [])]
      const i = cur.findIndex((e) => e.id === id)
      if (i < 0 || i === cur.length - 1) return {}
      const els = [...cur]
      const [item] = els.splice(i, 1)
      els.push(item)
      return { ...takeUndoBarrier(s), ...patchBandContainer(s, c.id, (b) => ({ ...b, bandElements: els })) }
    }),

  sendBandNestedLayerToBack: (id) =>
    set((s) => {
      if (!s.bandCanvasEditElementId) return {}
      const loc = findElementLocation(s, s.bandCanvasEditElementId)
      if (!loc) return {}
      const c = loc.el
      const cur = [...(c.bandElements ?? [])]
      const i = cur.findIndex((e) => e.id === id)
      if (i <= 0) return {}
      const els = [...cur]
      const [item] = els.splice(i, 1)
      els.unshift(item)
      return { ...takeUndoBarrier(s), ...patchBandContainer(s, c.id, (b) => ({ ...b, bandElements: els })) }
    }),

  reorderBandNestedLayerDrop: (draggedId, targetId, position) =>
    set((s) => {
      if (draggedId === targetId || !s.bandCanvasEditElementId) return {}
      const loc = findElementLocation(s, s.bandCanvasEditElementId)
      if (!loc) return {}
      const c = loc.el
      const cur = [...(c.bandElements ?? [])]
      const displayIds = [...cur].reverse().map((e) => e.id)
      const nextIds = reorderIdsInList(displayIds, draggedId, targetId, position)
      const byId = new Map(cur.map((e) => [e.id, e]))
      const elements = nextIds.map((id) => byId.get(id)).filter(Boolean) as LayoutElement[]
      if (elements.length !== cur.length) return {}
      return { ...takeUndoBarrier(s), ...patchBandContainer(s, c.id, (b) => ({ ...b, bandElements: elements })) }
    }),

  setCanvasPointerPt: (pt) => set({ canvasPointerPt: pt }),

  setCanvasZoom: (zoom) => set({ canvasZoom: clampCanvasZoom(zoom) }),

  adjustCanvasZoom: (factor) =>
    set((s) => ({ canvasZoom: clampCanvasZoom(s.canvasZoom * factor) })),

  moveElement: (id, x, y) =>
    set((s) => {
      if (s.viewOnly) return {}
      const n = findBandNestedChild(s.pages, id)
      if (n) {
        const elements = n.container.bandElements ?? []
        const el = n.child
        if (el.locked) return {}
        const dx = x - el.x
        const dy = y - el.y
        if (dx === 0 && dy === 0) return {}
        const { w: bw, h: bh } = bandViewportDims(s, n.container)
        let moveIds: Set<string>
        if (s.selectedIds.includes(id) && s.selectedIds.length > 1) {
          moveIds = new Set(
            s.selectedIds.filter((sid) => {
              const e = elements.find((x) => x.id === sid)
              return e && !e.locked
            })
          )
        } else if (el.groupId) {
          moveIds = new Set(
            elements.filter((e) => e.groupId === el.groupId && !e.locked).map((e) => e.id)
          )
        } else {
          moveIds = new Set([id])
        }
        const { dx: cdx, dy: cdy } = clampBandGroupTranslationDelta(elements, moveIds, dx, dy, bw, bh)
        const next = elements.map((e) => {
          if (!moveIds.has(e.id)) return e
          return clampBandNestedElement({ ...e, x: e.x + cdx, y: e.y + cdy }, bw, bh)
        })
        return {
          ...takeUndoBarrier(s),
          ...patchBandContainer(s, n.container.id, (c) => ({ ...c, bandElements: next })),
        }
      }
      const loc = findElementLocation(s, id)
      if (!loc) return {}
      const elements = loc.elements
      const el = loc.el
      if (el.locked) return {}
      const dx = x - el.x
      const dy = y - el.y
      if (dx === 0 && dy === 0) return {}

      let moveIds: Set<string>
      if (s.selectedIds.includes(id) && s.selectedIds.length > 1) {
        moveIds = new Set(
          s.selectedIds.filter((sid) => {
            const e = elements.find((x) => x.id === sid)
            return e && !e.locked
          })
        )
      } else if (el.groupId) {
        moveIds = new Set(
          elements.filter((e) => e.groupId === el.groupId && !e.locked).map((e) => e.id)
        )
      } else {
        moveIds = new Set([id])
      }

      const { dx: cdx, dy: cdy } = clampGroupTranslationDelta(elements, moveIds, dx, dy, s.pageSpec)
      const next = elements.map((e) => {
        if (!moveIds.has(e.id)) return e
        const cand = { ...e, x: e.x + cdx, y: e.y + cdy }
        return clampElementLayoutToPrintMargins(cand, s.pageSpec, s.gridSize)
      })
      return { ...takeUndoBarrier(s), ...replacePageElements(s, loc.pageIndex, next) }
    }),

  resizeElement: (id, width, height) =>
    set((s) => {
      if (s.viewOnly) return {}
      const hit = findBandNestedChild(s.pages, id)
      if (hit) {
        const el = hit.child
        if (el.locked) return {}
        if (el.type === 'MERGED_SHAPE') return {}
        const { w: bw, h: bh } = bandViewportDims(s, hit.container)
        const clamped = clampBandNestedElement({ ...el, width, height }, bw, bh)
        const nextNested = hit.container.bandElements!.map((e) =>
          e.id === id ? { ...e, ...clamped } : e
        )
        return {
          ...takeUndoBarrier(s),
          ...patchBandContainer(s, hit.container.id, (c) => ({ ...c, bandElements: nextNested })),
        }
      }
      const loc = findElementLocation(s, id)
      if (!loc) return {}
      const el = loc.el
      if (el.locked) return {}
      if (el.type === 'MERGED_SHAPE') return {}
      let merged = clampElementLayoutToPrintMargins({ ...el, width, height }, s.pageSpec, s.gridSize)
      merged = reclampBandChildrenToContainer(s, merged)
      return {
        ...takeUndoBarrier(s),
        ...replacePageElements(
          s,
          loc.pageIndex,
          loc.elements.map((e) => (e.id === id ? merged : e))
        ),
      }
    }),

  mergeGroupedShapesContaining: (elId) =>
    set((s) => {
      if (s.viewOnly) return {}
      const elements = activeElements(s)
      const el = elements.find((e) => e.id === elId)
      if (!el?.groupId) return {}
      const gid = el.groupId
      const groupEls = elements.filter((e) => e.groupId === gid && !e.locked)
      if (groupEls.length < 2) return {}
      if (!groupEls.every((e) => isMergeableShapeType(e.type))) return {}
      const merged = mergeLayoutShapeElements(groupEls)
      if (!merged) return {}
      const bg = groupEls.find((e) => e.style?.backgroundColor?.trim())?.style?.backgroundColor?.trim()
      const newEl: LayoutElement = {
        id: newElementId(),
        type: 'MERGED_SHAPE',
        x: snap(merged.x),
        y: snap(merged.y),
        width: merged.width,
        height: merged.height,
        shapePolys: merged.shapePolys,
        strokeWidth: merged.strokeWidth,
        mergedFromElements: groupEls.map((e) => ({ ...e })),
        style: {
          ...(merged.color ? { color: merged.color } : { color: '#374151' }),
          ...(bg ? { backgroundColor: bg } : {}),
        },
      }
      const removeIds = new Set(groupEls.map((e) => e.id))
      const next = elements.filter((e) => !removeIds.has(e.id)).concat(newEl)
      return {
        ...takeUndoBarrier(s),
        ...replaceActiveElements(s, next),
        selectedIds: [newEl.id],
        canvasTool: 'select',
        canvasInlineEditId: null,
        bandCanvasEditElementId: null,
        inlineTipTapEditor: null,
        tableSelection: null,
        tableCellEdit: null,
      }
    }),

  subtractSelectionToMergedShape: () =>
    set((s) => {
      if (s.viewOnly) return {}
      const elements = activeElements(s)
      let a: LayoutElement | undefined
      let b: LayoutElement | undefined
      if (s.selectedIds.length === 2) {
        a = elements.find((e) => e.id === s.selectedIds[0])
        b = elements.find((e) => e.id === s.selectedIds[1])
      } else if (s.selectedIds.length === 1) {
        const el = elements.find((e) => e.id === s.selectedIds[0])
        if (!el?.groupId) return {}
        const grp = elements.filter((e) => e.groupId === el.groupId && !e.locked)
        if (grp.length !== 2) return {}
        a = grp[0]
        b = grp[1]
      } else {
        return {}
      }
      if (!a || !b || a.locked || b.locked) return {}
      if (!isMergeableShapeType(a.type) || !isMergeableShapeType(b.type)) return {}
      const areaA = a.width * a.height
      const areaB = b.width * b.height
      const [outer, inner] = areaA >= areaB ? [a, b] : [b, a]
      const merged = subtractLayoutShapeElements(outer, inner)
      if (!merged) return {}
      const newEl: LayoutElement = {
        id: newElementId(),
        type: 'MERGED_SHAPE',
        x: snap(merged.x),
        y: snap(merged.y),
        width: merged.width,
        height: merged.height,
        shapePolys: merged.shapePolys,
        strokeWidth: merged.strokeWidth,
        mergedFromElements: [{ ...outer }, { ...inner }],
        style: {
          ...(merged.color ? { color: merged.color } : { color: '#374151' }),
          ...(merged.backgroundColor ? { backgroundColor: merged.backgroundColor } : {}),
        },
      }
      const removeIds = new Set([a.id, b.id])
      const next = elements.filter((e) => !removeIds.has(e.id)).concat(newEl)
      return {
        ...takeUndoBarrier(s),
        ...replaceActiveElements(s, next),
        selectedIds: [newEl.id],
        canvasTool: 'select',
        canvasInlineEditId: null,
        bandCanvasEditElementId: null,
        inlineTipTapEditor: null,
        tableSelection: null,
        tableCellEdit: null,
      }
    }),

  unmergeSelection: () =>
    set((s) => {
      if (s.viewOnly) return {}
      if (s.selectedIds.length !== 1) return {}
      const elements = activeElements(s)
      const el = elements.find((e) => e.id === s.selectedIds[0])
      if (!el || el.type !== 'MERGED_SHAPE' || !el.mergedFromElements?.length) return {}
      const restored = el.mergedFromElements.map((orig) => ({
        ...orig,
        id: newElementId(),
        groupId: undefined,
        mergedFromElements: undefined,
      }))
      const next = elements.filter((e) => e.id !== el.id).concat(restored)
      return {
        ...takeUndoBarrier(s),
        ...replaceActiveElements(s, next),
        selectedIds: restored.map((e) => e.id),
        canvasTool: 'select' as const,
        canvasInlineEditId: null,
        bandCanvasEditElementId: null,
        inlineTipTapEditor: null,
        tableSelection: null,
        tableCellEdit: null,
      }
    }),

  reflowLinkedText: (elementId: string) =>
    set((s) => {
      // Only TEXT elements support linked flow
      const loc = findElementLocation(s, elementId)
      if (!loc || loc.el.type !== 'TEXT') return {}

      // ── Find chain head ──
      let headId = loc.el.id
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let found: LayoutElement | undefined
        for (const page of s.pages) {
          found = page.elements.find((e) => e.id === headId)
          if (found) break
        }
        if (!found?.linkedPrevId) break
        headId = found.linkedPrevId
      }

      // ── Collect chain in order ──
      interface ChainEntry {
        pageIndex: number
        elementIndex: number
        element: LayoutElement
      }
      const chain: ChainEntry[] = []
      let curId: string | undefined = headId
      const visited = new Set<string>()
      while (curId && !visited.has(curId)) {
        visited.add(curId)
        let found = false
        for (let pi = 0; pi < s.pages.length; pi++) {
          const ei = s.pages[pi].elements.findIndex((e) => e.id === curId)
          if (ei >= 0) {
            chain.push({ pageIndex: pi, elementIndex: ei, element: s.pages[pi].elements[ei] })
            curId = s.pages[pi].elements[ei].linkedNextId
            found = true
            break
          }
        }
        if (!found) break
      }
      if (chain.length === 0) return {}

      const headEl = chain[0].element

      // ── Collect all content from the chain ──
      const allContent = chain.length === 1
        ? (headEl.content ?? '')
        : joinParagraphContents(chain.map((c) => c.element.content ?? ''))

      const paragraphs = splitContentIntoParagraphs(allContent)

      // ── Available heights ──
      const pageDim = pageDimensionsPt(s.pageSpec)
      const margins = s.pageSpec.margins ?? { top: 40, right: 40, bottom: 40, left: 40 }
      const headMaxH = pageDim.height - margins.bottom - headEl.y
      const contMaxH = pageDim.height - margins.bottom - margins.top
      const containerWidth = headEl.width

      // Quick check: does head content even overflow?
      const headMeasured = measureContentHeight(allContent, containerWidth, headEl.style ?? {})
      if (headMeasured <= headMaxH && chain.length === 1) {
        // Everything fits in one frame, nothing to do
        return {}
      }

      // ── Distribute across frames ──
      const frames = distributeContent(
        paragraphs,
        headMaxH,
        contMaxH,
        containerWidth,
        headEl.style ?? {}
      )

      // ── Build new pages array ──
      let newPages = s.pages.map((p) => ({ ...p, elements: [...p.elements] }))

      // Track IDs for linking
      const frameIds: string[] = []

      // Frame 0: update head element
      const headPage = chain[0].pageIndex
      const headIdx = chain[0].elementIndex
      const headNewId = headEl.id
      frameIds.push(headNewId)
      newPages[headPage].elements[headIdx] = {
        ...headEl,
        content: frames[0].content,
        height: Math.min(frames[0].measuredHeight, headMaxH),
        linkedPrevId: undefined,
        linkedNextId: undefined, // set after all frames are created
      }

      // Frames 1..N: update existing or create new
      for (let fi = 1; fi < frames.length; fi++) {
        if (fi < chain.length) {
          // Update existing continuation element
          const existing = chain[fi]
          const id = existing.element.id
          frameIds.push(id)
          newPages[existing.pageIndex].elements[existing.elementIndex] = {
            ...existing.element,
            content: frames[fi].content,
            height: Math.min(frames[fi].measuredHeight, contMaxH),
            linkedPrevId: undefined,
            linkedNextId: undefined,
          }
        } else {
          // Need a new element — determine which page
          const targetPageIndex = headPage + fi
          // Create pages as needed
          while (newPages.length <= targetPageIndex) {
            const n = newPages.length + 1
            newPages.push({
              id: newPageId(),
              name: `Page ${n}`,
              elements: [],
            })
          }
          // Create continuation element inheriting head's style
          const newId = newElementId()
          frameIds.push(newId)
          const contEl: LayoutElement = {
            id: newId,
            type: 'TEXT',
            x: headEl.x,
            y: margins.top,
            width: headEl.width,
            height: Math.min(frames[fi].measuredHeight, contMaxH),
            content: frames[fi].content,
            style: headEl.style ? { ...headEl.style } : undefined,
            linkedPrevId: undefined,
            linkedNextId: undefined,
          }
          newPages[targetPageIndex].elements.push(contEl)
        }
      }

      // Remove excess chain elements (chain shrank)
      for (let fi = frames.length; fi < chain.length; fi++) {
        const excess = chain[fi]
        newPages[excess.pageIndex].elements = newPages[excess.pageIndex].elements.filter(
          (e) => e.id !== excess.element.id
        )
      }

      // Remove empty auto-created pages at the end (but keep at least the original page count)
      const originalPageCount = s.pages.length
      while (
        newPages.length > originalPageCount &&
        newPages[newPages.length - 1].elements.length === 0
      ) {
        newPages.pop()
      }

      // ── Wire linked IDs ──
      for (let fi = 0; fi < frameIds.length; fi++) {
        const fid = frameIds[fi]
        const nextId = fi < frameIds.length - 1 ? frameIds[fi + 1] : undefined
        const prevId = fi > 0 ? frameIds[fi - 1] : undefined
        for (const page of newPages) {
          const el = page.elements.find((e) => e.id === fid)
          if (el) {
            el.linkedNextId = nextId
            el.linkedPrevId = prevId
            break
          }
        }
      }

      // ── If all content now fits in the head frame, clear link fields ──
      if (frameIds.length === 1) {
        for (const page of newPages) {
          const el = page.elements.find((e) => e.id === frameIds[0])
          if (el) {
            el.linkedNextId = undefined
            el.linkedPrevId = undefined
            break
          }
        }
      }

      return {
        ...takeUndoBarrier(s),
        pages: newPages,
        variableValues: mergeVariableValues(
          s.variableValues,
          allPageElements(newPages),
          s.globalVariableDefinitions,
          newPages,
          s.activePageIndex
        ),
      }
    }),

  beginHistoryBatch: () =>
    set((s) => {
      const nextDepth = s.historyBatchDepth + 1
      if (s.historyBatchDepth === 0) {
        return {
          historyBatchDepth: nextDepth,
          undoPast: [...s.undoPast, captureEditorUndoSnapshot(s)].slice(-MAX_UNDO_STEPS),
          undoFuture: [],
        }
      }
      return { historyBatchDepth: nextDepth }
    }),

  endHistoryBatch: () =>
    set((s) => ({
      historyBatchDepth: Math.max(0, s.historyBatchDepth - 1),
    })),

  undo: () =>
    withUndoSuppressed(() =>
      set((s) => {
        if (s.undoPast.length === 0) return {}
        const prev = s.undoPast[s.undoPast.length - 1]!
        const newPast = s.undoPast.slice(0, -1)
        const cur = captureEditorUndoSnapshot(s)
        const patch = snapshotToPatch(prev)
        return {
          ...patch,
          globalVariableDefinitions: filterPersistableVariableDefinitions(
            patch.globalVariableDefinitions ?? []
          ),
          bandCanvasEditElementId: patch.bandCanvasEditElementId ?? null,
          bandNestedEditorMounted: patch.bandNestedEditorMounted ?? false,
          variableValues: mergeVariableValues(
            patch.variableValues,
            allPageElements(patch.pages),
            filterPersistableVariableDefinitions(patch.globalVariableDefinitions ?? []),
            patch.pages,
            patch.activePageIndex
          ),
          undoPast: newPast,
          undoFuture: [cur, ...s.undoFuture].slice(0, MAX_UNDO_STEPS),
          historyBatchDepth: 0,
        }
      })
    ),

  redo: () =>
    withUndoSuppressed(() =>
      set((s) => {
        if (s.undoFuture.length === 0) return {}
        const next = s.undoFuture[0]!
        const newFuture = s.undoFuture.slice(1)
        const cur = captureEditorUndoSnapshot(s)
        const patch = snapshotToPatch(next)
        return {
          ...patch,
          globalVariableDefinitions: filterPersistableVariableDefinitions(
            patch.globalVariableDefinitions ?? []
          ),
          bandCanvasEditElementId: patch.bandCanvasEditElementId ?? null,
          bandNestedEditorMounted: patch.bandNestedEditorMounted ?? false,
          variableValues: mergeVariableValues(
            patch.variableValues,
            allPageElements(patch.pages),
            filterPersistableVariableDefinitions(patch.globalVariableDefinitions ?? []),
            patch.pages,
            patch.activePageIndex
          ),
          undoPast: [...s.undoPast, cur].slice(-MAX_UNDO_STEPS),
          undoFuture: newFuture,
          historyBatchDepth: 0,
        }
      })
    ),

  applyRemoteOp: (op) =>
    set((s) => {
      let pages = s.pages
      let globalVariableDefinitions = s.globalVariableDefinitions
      let pageSpec = s.pageSpec

      switch (op.type) {
        case 'addElement': {
          pages = s.pages.map((p, i) =>
            i === op.pageIndex ? { ...p, elements: [...p.elements, op.element] } : p
          )
          break
        }
        case 'deleteElements': {
          const remove = new Set(op.elementIds)
          pages = s.pages.map((p, i) =>
            i === op.pageIndex ? { ...p, elements: p.elements.filter((e) => !remove.has(e.id)) } : p
          )
          break
        }
        case 'updateElement': {
          pages = s.pages.map((p, i) =>
            i === op.pageIndex
              ? {
                  ...p,
                  elements: p.elements.map((e) =>
                    e.id === op.elementId ? ({ ...e, ...op.patch } as LayoutElement) : e
                  ),
                }
              : p
          )
          break
        }
        case 'bulkUpdateElements': {
          const byId = new Map(op.updates.map((u) => [u.elementId, u.patch]))
          pages = s.pages.map((p, i) =>
            i === op.pageIndex
              ? {
                  ...p,
                  elements: p.elements.map((e) => {
                    const patch = byId.get(e.id)
                    return patch ? ({ ...e, ...patch } as LayoutElement) : e
                  }),
                }
              : p
          )
          break
        }
        case 'addPage': {
          const next = [...s.pages]
          const idx = Math.max(0, Math.min(op.index, next.length))
          next.splice(idx, 0, op.page)
          pages = next
          break
        }
        case 'deletePage': {
          if (op.index < 0 || op.index >= s.pages.length || s.pages.length <= 1) break
          pages = s.pages.filter((_, i) => i !== op.index)
          break
        }
        case 'reorderPages': {
          if (
            op.from < 0 || op.from >= s.pages.length ||
            op.to < 0 || op.to >= s.pages.length ||
            op.from === op.to
          ) break
          const next = [...s.pages]
          const [moved] = next.splice(op.from, 1)
          next.splice(op.to, 0, moved)
          pages = next
          break
        }
        case 'updatePage': {
          pages = s.pages.map((p, i) =>
            i === op.pageIndex ? ({ ...p, ...op.patch } as LayoutDocumentPage) : p
          )
          break
        }
        case 'setGlobalVariables': {
          globalVariableDefinitions = op.variables
          break
        }
        case 'setPageVariables': {
          pages = s.pages.map((p, i) =>
            i === op.pageIndex ? { ...p, localVariables: op.variables } : p
          )
          break
        }
        case 'setPageSpec': {
          pageSpec = op.pageSpec
          break
        }
      }

      // Clamp activePageIndex in case a page was removed.
      const activePageIndex = Math.min(s.activePageIndex, Math.max(0, pages.length - 1))
      return {
        pages,
        globalVariableDefinitions,
        pageSpec,
        activePageIndex,
      }
    }),
}))

export function createDefaultElement(
  type: LayoutElement['type'],
  pos: { x: number; y: number }
): LayoutElement {
  const id = newElementId()
  const base = { id, x: snap(pos.x), y: snap(pos.y) }
  switch (type) {
    case 'TEXT':
      return {
        ...base,
        type: 'TEXT',
        width: 400,
        height: 80,
        content: serializeRunsToContent([]),
        style: { fontSize: 12, bold: false, align: 'left' },
      }
    case 'HEADER':
      return {
        ...base,
        type: 'HEADER',
        width: 500,
        height: 32,
        style: { fontSize: 12, bold: false, align: 'left' },
      }
    case 'FOOTER':
      return {
        ...base,
        type: 'FOOTER',
        width: 500,
        height: 32,
        style: { fontSize: 12, bold: false, align: 'left' },
      }
    case 'TABLE':
      return {
        ...base,
        type: 'TABLE',
        width: 200,
        height: 88,
        columns: [
          { header: serializeRunsToContent([]), key: 'c0' },
          { header: serializeRunsToContent([]), key: 'c1' },
        ],
        columnWidths: [1, 1],
        tablePreviewBodyRows: 2,
      }
    case 'IMAGE':
      return {
        ...base,
        type: 'IMAGE',
        width: 120,
        height: 120,
        src: '',
      }
    case 'LINE':
      return {
        ...base,
        type: 'LINE',
        width: 400,
        height: 4,
        strokeWidth: 1,
      }
    case 'BOX':
      return {
        ...base,
        type: 'BOX',
        width: 160,
        height: 80,
        style: { color: '#64748b' },
      }
    case 'ELLIPSE':
      return {
        ...base,
        type: 'ELLIPSE',
        width: 120,
        height: 80,
        strokeWidth: 2,
        style: { color: '#6366f1' },
      }
    case 'TRIANGLE':
      return {
        ...base,
        type: 'TRIANGLE',
        width: 100,
        height: 90,
        strokeWidth: 2,
        style: { color: '#0ea5e9' },
      }
    case 'ARROW':
      return {
        ...base,
        type: 'ARROW',
        width: 140,
        height: 48,
        strokeWidth: 2,
        style: { color: '#7c3aed' },
      }
    case 'DIAMOND':
      return {
        ...base,
        type: 'DIAMOND',
        width: 100,
        height: 100,
        strokeWidth: 2,
        style: { color: '#db2777' },
      }
    case 'STAR':
      return {
        ...base,
        type: 'STAR',
        width: 100,
        height: 100,
        strokeWidth: 2,
        style: { color: '#ca8a04' },
      }
    case 'RING':
      return {
        ...base,
        type: 'RING',
        width: 120,
        height: 120,
        ringInnerRatio: 0.55,
        strokeWidth: 2,
        style: { color: '#0f766e', backgroundColor: '#99f6e4' },
      }
    case 'LIST':
      return {
        ...base,
        type: 'LIST',
        width: 300,
        height: 120,
        listStyle: 'disc',
        listItems: [
          { text: 'First item' },
          { text: 'Second item' },
          { text: 'Third item' },
        ],
        listItemSpacing: 4,
        listIndent: 16,
        listStartNumber: 1,
        style: { fontSize: 12, align: 'left' },
      }
    default:
      return {
        ...base,
        type: 'TEXT',
        width: 200,
        height: 24,
        content: serializeRunsToContent([]),
        style: { fontSize: 12, bold: false, align: 'left' },
      }
  }
}
