import { usePreviewStore } from '../../stores/previewStore'
import { selectAllTemplateElements, useEditorStore } from '../../stores/editorStore'

/**
 * Left panel while previewing: every element the renderer clipped.
 *
 * <p>This replaces the yellow banner that sat above the PDF. That banner had
 * room for three entries and then said "+4 more", which is the wrong shape for
 * the information — the author needs to know <em>which</em> elements are wrong,
 * and each one is a place they have to go and fix. A list down the side has
 * room for all of them and can be clicked through.
 *
 * <p>Clicking a row selects that element, so leaving preview lands with the
 * offending box already selected rather than leaving the author to hunt for
 * "t010" on the canvas.
 */
export function PreviewIssuesPanel() {
  const overflows = usePreviewStore((s) => s.overflows)
  const pdfUrl = usePreviewStore((s) => s.pdfUrl)
  const loading = usePreviewStore((s) => s.loading)
  const select = useEditorStore((s) => s.select)
  const elements = useEditorStore(selectAllTemplateElements)

  /** The element's own text, so a row reads as content rather than as an id. */
  const labelFor = (id: string): string => {
    const el = elements.find((e) => e.id === id) as { content?: unknown } | undefined
    const raw = typeof el?.content === 'string' ? el.content.trim() : ''
    if (!raw) return id
    return raw.length > 42 ? `${raw.slice(0, 42)}…` : raw
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          Issues
        </h2>
        <p className="mt-1 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
          Content the renderer had to clip. Grow the element to fit it.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-xs text-zinc-400">Checking…</p>
        ) : !pdfUrl ? (
          <p className="text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
            Refresh the preview to check for clipped content.
          </p>
        ) : overflows.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <p className="text-[11px] leading-snug text-emerald-800 dark:text-emerald-200">
              Nothing is clipped — every element fits the space it was given.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {overflows.map((o) => (
              <li key={o.elementId}>
                <button
                  type="button"
                  onClick={() => select(o.elementId)}
                  className="w-full rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-left transition-colors hover:border-amber-300 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:hover:bg-amber-500/20"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-amber-900 dark:text-amber-100">
                      {labelFor(o.elementId)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-amber-700 dark:text-amber-300">
                      +{Math.round(o.delta)}pt
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-amber-700/80 dark:text-amber-300/80">
                    {o.elementType ?? 'TEXT'} {o.elementId}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
