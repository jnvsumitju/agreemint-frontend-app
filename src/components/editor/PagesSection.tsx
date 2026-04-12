import { useEffect, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'

function PageNameField({
  pageId,
  name,
  onCommit,
}: {
  pageId: string
  name: string
  onCommit: (name: string) => void
}) {
  const [v, setV] = useState(name)
  useEffect(() => setV(name), [name, pageId])
  const nameFieldId = `ag-page-name-${pageId}`
  return (
    <input
      id={nameFieldId}
      name={nameFieldId}
      type="text"
      className="mt-1 w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Page name"
    />
  )
}

export function PagesSection() {
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const setActivePageIndex = useEditorStore((s) => s.setActivePageIndex)
  const addPage = useEditorStore((s) => s.addPage)
  const removePage = useEditorStore((s) => s.removePage)
  const renamePage = useEditorStore((s) => s.renamePage)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
        Click a page to show it on the canvas. Add or remove pages; names are saved with the template.
      </p>
      <ul className="flex flex-col gap-1.5">
        {pages.map((p, i) => {
          const isActive = i === activePageIndex
          return (
            <li
              key={p.id}
              className={`cursor-pointer rounded-lg border px-2 py-2 transition-colors ${
                isActive
                  ? 'border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/40'
                  : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-600 dark:bg-zinc-800/50 dark:hover:border-zinc-500'
              }`}
              onClick={() => setActivePageIndex(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setActivePageIndex(i)
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                Page {i + 1} · {p.elements.length} element{p.elements.length === 1 ? '' : 's'}
              </div>
              <PageNameField pageId={p.id} name={p.name} onCommit={(n) => renamePage(p.id, n)} />
              {pages.length > 1 && (
                <button
                  type="button"
                  className="mt-2 w-full rounded border border-red-200 bg-white py-1 text-[10px] font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40"
                  onClick={(e) => {
                    e.stopPropagation()
                    removePage(p.id)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  Remove page
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        className="rounded-lg border border-zinc-300 bg-white py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        onClick={() => addPage()}
      >
        + Add page
      </button>
    </div>
  )
}
