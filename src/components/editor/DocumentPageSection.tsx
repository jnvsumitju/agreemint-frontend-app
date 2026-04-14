import { useEditorStore } from '../../stores/editorStore'
import { pageDimensionsPt, PAGE_SIZE_PRESETS } from '../../types/layout'
import { FieldInput } from './ui/FieldInput'

const SIZE_OPTIONS = Object.entries(PAGE_SIZE_PRESETS).map(([key, v]) => ({
  key,
  label: v.label,
}))

export function DocumentPageSection() {
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const setPageMargins = useEditorStore((s) => s.setPageMargins)
  const setPageSize = useEditorStore((s) => s.setPageSize)
  const { width, height } = pageDimensionsPt(pageSpec)
  const m = pageSpec.margins
  const orientation = pageSpec.orientation ?? 'portrait'

  const field = (side: keyof typeof m, label: string) => (
    <FieldInput
      key={side}
      label={`${label} (pt)`}
      id={`ag-doc-margin-${side}`}
      type="number"
      min={0}
      value={m[side]}
      onChange={(e) =>
        setPageMargins({
          [side]: Math.max(0, Math.round(Number(e.target.value) || 0)),
        })
      }
      className="flex flex-col gap-0.5 text-[9px] lg:text-[11px]"
    />
  )

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-2.5 dark:border-zinc-600 dark:bg-zinc-900/40">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-xs">Document</p>

      {/* Page size dropdown */}
      <div className="mb-2 flex flex-col gap-1">
        <label className="text-[9px] font-medium text-zinc-600 lg:text-[11px] dark:text-zinc-400" htmlFor="ag-page-size">
          Page size
        </label>
        <select
          id="ag-page-size"
          className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          value={pageSpec.size.toUpperCase()}
          onChange={(e) => setPageSize(e.target.value, orientation)}
        >
          {SIZE_OPTIONS.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Orientation toggle */}
      <div className="mb-2 flex gap-1">
        <button
          type="button"
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] font-medium transition-colors ${
            orientation === 'portrait'
              ? 'border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300'
              : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
          onClick={() => setPageSize(pageSpec.size, 'portrait')}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <rect x="5" y="2" width="14" height="20" rx="1" />
          </svg>
          Portrait
        </button>
        <button
          type="button"
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] font-medium transition-colors ${
            orientation === 'landscape'
              ? 'border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300'
              : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
          onClick={() => setPageSize(pageSpec.size, 'landscape')}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <rect x="2" y="5" width="20" height="14" rx="1" />
          </svg>
          Landscape
        </button>
      </div>

      {/* Dimensions display */}
      <p className="mb-2 text-[9px] leading-snug text-zinc-600 lg:text-[11px] dark:text-zinc-400">
        {width} x {height} pt
      </p>

      {/* Margins */}
      <p className="mb-1 text-[9px] font-medium text-zinc-500 lg:text-[10px] dark:text-zinc-400">Margins</p>
      <div className="grid grid-cols-2 gap-2">
        {field('top', 'Top')}
        {field('bottom', 'Bottom')}
        {field('left', 'Left')}
        {field('right', 'Right')}
      </div>
    </div>
  )
}
