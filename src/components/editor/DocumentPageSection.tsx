import { useEditorStore } from '../../stores/editorStore'
import { pageDimensionsPt, PAGE_SIZE_PRESETS, type GradientDef, type PageBackground } from '../../types/layout'
import { ColorRow } from './elementAppearanceFields'
import { FieldInput } from './ui/FieldInput'

const SIZE_OPTIONS = Object.entries(PAGE_SIZE_PRESETS).map(([key, v]) => ({
  key,
  label: v.label,
}))

export function DocumentPageSection() {
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const setPageMargins = useEditorStore((s) => s.setPageMargins)
  const setPageSize = useEditorStore((s) => s.setPageSize)
  const setActivePageBackground = useEditorStore((s) => s.setActivePageBackground)
  const setApplyBackgroundToAllPages = useEditorStore((s) => s.setApplyBackgroundToAllPages)
  const setVerificationMark = useEditorStore((s) => s.setVerificationMark)
  // Read the active page's background — DocumentPageSection always shows
  // the current page's bg, even when the "apply to all" toggle is off.
  const activePageBackground = useEditorStore((s) => s.pages[s.activePageIndex]?.background)
  const { width, height } = pageDimensionsPt(pageSpec)
  const m = pageSpec.margins
  const orientation = pageSpec.orientation ?? 'portrait'
  // Default ON for new templates, but respect an explicit `false` from
  // older or migrated layouts.
  const applyToAll = pageSpec.applyBackgroundToAllPages !== false
  // Off unless explicitly enabled — most documents do not want the furniture.
  const verificationMark = pageSpec.verificationMark === true

  // Mutating helpers that drop empty fields rather than persisting them.
  const setBgColor = (next: string) => {
    const trimmed = next.trim()
    const updated: PageBackground = { ...(activePageBackground ?? {}), color: trimmed || undefined }
    if (!updated.color) delete updated.color
    setActivePageBackground(updated.color || updated.gradient ? updated : undefined)
  }
  const setBgGradient = (g: GradientDef | undefined) => {
    const updated: PageBackground = { ...(activePageBackground ?? {}) }
    if (g) updated.gradient = g
    else delete updated.gradient
    setActivePageBackground(updated.color || updated.gradient ? updated : undefined)
  }
  const clearBg = () => setActivePageBackground(undefined)

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

      {/* Background — colour + gradient. Mirrors element bg picker UI so
          the affordance is identical to filling a BOX. The sticky toggle
          below decides whether the same background applies to every page
          or just the active one. */}
      <div className="mt-3 border-t border-zinc-200 pt-2.5 dark:border-zinc-600">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[9px] font-medium text-zinc-500 lg:text-[10px] dark:text-zinc-400">Background</p>
          {(activePageBackground?.color || activePageBackground?.gradient) && (
            <button
              type="button"
              className="text-[9px] text-zinc-500 hover:text-zinc-800 lg:text-[10px] dark:text-zinc-400 dark:hover:text-zinc-100"
              onClick={clearBg}
            >
              Clear
            </button>
          )}
        </div>
        <div className="text-[10px] lg:text-[11px]">
          <ColorRow
            label="Page fill"
            textInputId="ag-page-bg-color"
            value={activePageBackground?.color}
            onChange={setBgColor}
            onClear={clearBg}
            gradient={activePageBackground?.gradient}
            onGradientChange={setBgGradient}
          />
        </div>
        <label className="mt-2 flex cursor-pointer items-center justify-between gap-2 text-[10px] lg:text-[11px] text-zinc-600 dark:text-zinc-300">
          <span>Apply to all pages</span>
          <button
            type="button"
            role="switch"
            aria-checked={applyToAll}
            onClick={() => setApplyBackgroundToAllPages(!applyToAll)}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 ${
              applyToAll ? 'bg-violet-600' : 'bg-zinc-300 dark:bg-zinc-600'
            }`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                applyToAll ? 'translate-x-3' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>

        {/* Verification mark. Separated by a rule because it is a property of
            the issued document rather than of the page's appearance — it
            changes what generated PDFs carry, not how the canvas looks. */}
        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          <label className="flex cursor-pointer items-center justify-between gap-2 text-[10px] lg:text-[11px] text-zinc-600 dark:text-zinc-300">
            <span>Verification mark</span>
            <button
              type="button"
              role="switch"
              aria-checked={verificationMark}
              aria-label="Print a verification code and QR on generated documents"
              onClick={() => setVerificationMark(!verificationMark)}
              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 ${
                verificationMark ? 'bg-violet-600' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                  verificationMark ? 'translate-x-3' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
          <p className="mt-1 text-[9px] leading-snug text-zinc-500 lg:text-[10px] dark:text-zinc-400">
            Prints a code and QR in the footer of generated documents so a
            recipient can check them from a printout. Does not appear on the
            canvas or in previews.
          </p>
        </div>
      </div>
    </div>
  )
}
