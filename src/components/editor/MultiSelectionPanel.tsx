import { useEditorStore } from '../../stores/editorStore'
import type { LayoutElement } from '../../types/layout'
import { ActionButton } from './ui/ActionButton'
import { DocumentPageSection } from './DocumentPageSection'

export function MultiSelectionPanel({
  count,
  selectedIds,
  elements,
  hideDocumentPage,
  bandEditorMode,
}: {
  count: number
  selectedIds: string[]
  elements: LayoutElement[]
  hideDocumentPage?: boolean
  bandEditorMode?: boolean
}) {
  const groupSelection = useEditorStore((s) => s.groupSelection)
  const ungroupSelection = useEditorStore((s) => s.ungroupSelection)
  const removeElements = useEditorStore((s) => s.removeElements)
  const idSet = new Set(selectedIds)
  const anyGrouped = elements.some((e) => idSet.has(e.id) && e.groupId)

  return (
    <div className="flex flex-col gap-3 p-3">
      {!hideDocumentPage ? <DocumentPageSection /> : null}
      <div className="rounded-lg border border-violet-200 bg-violet-50/80 p-3 dark:border-violet-800 dark:bg-violet-950/30">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 lg:text-xs dark:text-violet-200">
          {count} selected
        </h2>
        <p className="mt-1 text-[9px] leading-snug text-zinc-600 lg:text-[11px] dark:text-zinc-400">
          ⌘/Ctrl/Shift+click on the canvas to add or remove items. Drag any selected item to move all
          selected together. Group to keep them moving as one even after you click elsewhere.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton
            variant="highlight"
            disabled={bandEditorMode || count < 2}
            title={
              bandEditorMode
                ? 'Grouping is for the main page canvas, not while editing header/footer here.'
                : undefined
            }
            onClick={() => groupSelection()}
          >
            Group
          </ActionButton>
          <ActionButton
            disabled={bandEditorMode || !anyGrouped}
            title={
              bandEditorMode
                ? 'Ungroup from the main page canvas, not while editing header/footer here.'
                : undefined
            }
            onClick={() => ungroupSelection()}
          >
            Ungroup
          </ActionButton>
          <ActionButton variant="danger" onClick={() => removeElements([...selectedIds])}>
            Delete all
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
