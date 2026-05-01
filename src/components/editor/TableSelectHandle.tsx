import { useEditorStore } from '../../stores/editorStore'

/**
 * Small block-handle pinned at the top-right of a TABLE element that
 * gives the user a direct "select the whole table, not a cell"
 * affordance. Held at 80% opacity so it stays unobtrusive on top of
 * table content, and lifts to 100% on hover for click feedback.
 *
 * Visibility: rendered only when one of
 *   • the parent element is being hovered (the outer wrapper has the
 *     `group` class; we use Tailwind's `group-hover:` variant to show
 *     the handle on cursor hover)
 *   • a cell inside THIS table is currently selected (`tableSelection`)
 *   • a cell inside THIS table is in edit mode (`tableCellEdit`)
 *
 * In the last two cases the handle doubles as a Google-Sheets-style
 * "escape hatch" — step back out of cell editing to whole-table
 * selection with a single click.
 *
 * On click: clears cell selection AND cell-edit state, then sets the
 * whole table element as the only selected element. The table's
 * context toolbar, properties panel, etc. take over from there.
 */
export function TableSelectHandle({ tableId }: { tableId: string }) {
  const tableSelection = useEditorStore((s) => s.tableSelection)
  const tableCellEdit = useEditorStore((s) => s.tableCellEdit)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const select = useEditorStore((s) => s.select)
  const setTableSelection = useEditorStore((s) => s.setTableSelection)
  const setTableCellEdit = useEditorStore((s) => s.setTableCellEdit)

  const cellActive =
    tableSelection?.tableId === tableId || tableCellEdit?.tableId === tableId
  const selfSelected =
    selectedIds.length === 1 && selectedIds[0] === tableId && !cellActive

  // When the table is the sole element selected AND no cell is active, the
  // normal element-selection ring is drawn around the table by
  // `EditorCanvas` — the handle is no longer needed as an "escape hatch",
  // but we keep it visible on hover so the user can re-enter the table
  // after clicking away. `group-hover:` handles that below.
  const persistent = cellActive || selfSelected

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    // Explicit order: drop cell edit → drop cell selection → select the
    // table element. `select(tableId)` alone wouldn't clear tableSelection
    // / tableCellEdit because those already point at the same tableId; the
    // store's `select` helper only clears them when the PRIMARY shifts to
    // a different element. Clearing by hand gives the "jump out of cell
    // mode" effect the handle is supposed to deliver.
    setTableCellEdit(null)
    setTableSelection(null)
    select(tableId)
  }

  return (
    <button
      type="button"
      // Block swallowing clicks in the outer wrapper's onClick / the
      // grid-cell click handlers inside TableElementCanvas — we don't want
      // the click to also fire a cell select.
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      title="Select table"
      aria-label="Select table"
      className={`absolute -right-3 -top-3 z-[45] flex h-6 w-6 items-center justify-center rounded-md border border-violet-300 bg-white text-violet-700 shadow-sm transition-opacity hover:border-violet-500 hover:bg-violet-50 hover:text-violet-800 hover:opacity-100 dark:border-violet-600 dark:bg-zinc-800 dark:text-violet-300 dark:hover:bg-violet-950/50 ${
        persistent ? 'opacity-80' : 'opacity-0 group-hover:opacity-80'
      }`}
    >
      {/* Grid icon — reads as "the whole table". Keeps the visual distinct
          from the Locked/Group/comment badges (coloured pill chips) and
          the remote-presence avatar (coloured circle) at the other
          corners. */}
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="3" y1="15" x2="21" y2="15" />
        <line x1="9" y1="3" x2="9" y2="21" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    </button>
  )
}
