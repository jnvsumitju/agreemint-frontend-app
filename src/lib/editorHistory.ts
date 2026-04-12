import type { LayoutDocumentPage, PageSpec, VariableDefinition } from '../types/layout'
import type { TableSelection } from '../types/tableSelection'

export const MAX_UNDO_STEPS = 50

export type EditorUndoSnapshot = {
  pages: LayoutDocumentPage[]
  pageSpec: PageSpec
  globalVariableDefinitions: VariableDefinition[]
  activePageIndex: number
  selectedIds: string[]
  variableValues: Record<string, string>
  canvasInlineEditId: string | null
  /** HEADER/FOOTER band editor (split canvas); v2+ snapshots only. */
  bandCanvasEditElementId?: string | null
  bandNestedEditorMounted?: boolean
  focusedTextRunIndex: number | null
  tableSelection: TableSelection
  tableCellEdit: { tableId: string; row: number; col: number } | null
}

type SnapshotSource = Pick<
  EditorUndoSnapshot,
  | 'pages'
  | 'pageSpec'
  | 'globalVariableDefinitions'
  | 'activePageIndex'
  | 'selectedIds'
  | 'variableValues'
  | 'canvasInlineEditId'
  | 'bandCanvasEditElementId'
  | 'bandNestedEditorMounted'
  | 'focusedTextRunIndex'
  | 'tableSelection'
  | 'tableCellEdit'
>

let suppressDepth = 0

export function withUndoSuppressed<T>(fn: () => T): T {
  suppressDepth++
  try {
    return fn()
  } finally {
    suppressDepth--
  }
}

export function isUndoSuppressed(): boolean {
  return suppressDepth > 0
}

export function captureEditorUndoSnapshot(s: SnapshotSource): EditorUndoSnapshot {
  return JSON.parse(
    JSON.stringify({
      pages: s.pages,
      pageSpec: s.pageSpec,
      globalVariableDefinitions: s.globalVariableDefinitions,
      activePageIndex: s.activePageIndex,
      selectedIds: s.selectedIds,
      variableValues: s.variableValues,
      canvasInlineEditId: s.canvasInlineEditId,
      bandCanvasEditElementId: s.bandCanvasEditElementId ?? null,
      bandNestedEditorMounted: s.bandNestedEditorMounted ?? false,
      focusedTextRunIndex: s.focusedTextRunIndex,
      tableSelection: s.tableSelection,
      tableCellEdit: s.tableCellEdit,
    })
  ) as EditorUndoSnapshot
}

/** Deep-cloned fields safe to merge into editor state. */
export function snapshotToPatch(snap: EditorUndoSnapshot): EditorUndoSnapshot {
  return JSON.parse(JSON.stringify(snap)) as EditorUndoSnapshot
}
