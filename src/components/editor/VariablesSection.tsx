import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  documentBandElementsFromFirstPage,
  findElementByIdInDocument,
} from '../../lib/documentPageMerge'
import {
  isSystemGlobalVariableKey,
  systemGlobalVariableDefinitions,
} from '../../lib/systemTemplateVariables'
import { extractVariableKeys, uniqueTableDataKeys } from '../../lib/variables'
import type { VariableDefinition } from '../../types/layout'
import { normalizeCatalogVariableKey } from '../../types/layout'
import { pageLocalShadowStorageKey } from '../../lib/layoutBehaviourResolve'
import { selectAllTemplateElements, useEditorStore } from '../../stores/editorStore'

function catalogKeySet(globalDefs: VariableDefinition[], localDefs: VariableDefinition[]): Set<string> {
  const s = new Set<string>()
  for (const d of globalDefs) {
    const k = normalizeCatalogVariableKey(d.key)
    if (k) s.add(k)
  }
  for (const d of localDefs) {
    const k = normalizeCatalogVariableKey(d.key)
    if (k) s.add(k)
  }
  return s
}

/** First row in list order wins; merges descriptions; removes other duplicate rows. */
function mergeDuplicateCatalogRowsAtBlur(
  defs: VariableDefinition[],
  blurredRowIndex: number
): { next: VariableDefinition[]; keptIndex: number } | null {
  const nk = normalizeCatalogVariableKey(defs[blurredRowIndex]?.key ?? '')
  if (!nk) return null

  const dupIndices = defs
    .map((d, i) => (normalizeCatalogVariableKey(d.key) === nk ? i : -1))
    .filter((i): i is number => i >= 0)
    .sort((a, b) => a - b)

  if (dupIndices.length < 2) return null

  const keep = dupIndices[0]!
  const remove = new Set(dupIndices.filter((i) => i !== keep))

  const descParts: string[] = []
  const seenDesc = new Set<string>()
  for (const i of dupIndices) {
    const t = defs[i]?.description?.trim()
    if (t && !seenDesc.has(t)) {
      seenDesc.add(t)
      descParts.push(t)
    }
  }
  const mergedDescription = descParts.length > 0 ? descParts.join('\n') : defs[keep]?.description

  const next: VariableDefinition[] = []
  let keptIndex = -1
  for (let i = 0; i < defs.length; i++) {
    if (remove.has(i)) continue
    if (i === keep) {
      keptIndex = next.length
      next.push({
        ...defs[keep],
        key: nk,
        description:
          mergedDescription === '' || mergedDescription === undefined ? undefined : mergedDescription,
      })
    } else {
      next.push(defs[i]!)
    }
  }
  return { next, keptIndex }
}

function duplicateRowCount(defs: VariableDefinition[], rowIndex: number): number {
  const nk = normalizeCatalogVariableKey(defs[rowIndex]?.key ?? '')
  if (!nk) return 0
  return defs.filter((d) => normalizeCatalogVariableKey(d.key) === nk).length
}

export function VariablesSection() {
  const [mergeFlash, setMergeFlash] = useState<{ scope: 'global' | 'local'; index: number } | null>(null)

  const elements = useEditorStore(useShallow(selectAllTemplateElements))
  const pages = useEditorStore((s) => s.pages)
  const bandEditorMode = useEditorStore((s) => s.bandCanvasEditElementId != null)
  const bandNestedEditorMounted = useEditorStore((s) => s.bandNestedEditorMounted)
  const bandCanvasEditElementId = useEditorStore((s) => s.bandCanvasEditElementId)
  const bandElements = useMemo(() => documentBandElementsFromFirstPage(pages), [pages])
  const openBandContainer = useMemo(() => {
    if (!bandNestedEditorMounted || !bandCanvasEditElementId) return undefined
    return findElementByIdInDocument(pages, bandCanvasEditElementId)
  }, [bandNestedEditorMounted, bandCanvasEditElementId, pages])
  const elementsForVarKeys =
    bandNestedEditorMounted && openBandContainer?.bandElements?.length
      ? openBandContainer.bandElements
      : bandEditorMode
        ? bandElements
        : elements
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const globalVariableDefinitions = useEditorStore((s) => s.globalVariableDefinitions)
  const setGlobalVariableDefinitions = useEditorStore((s) => s.setGlobalVariableDefinitions)
  const setPageLocalVariableDefinitions = useEditorStore((s) => s.setPageLocalVariableDefinitions)
  const variableValues = useEditorStore((s) => s.variableValues)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)

  const activePage = pages[activePageIndex]
  const localDefs = activePage?.localVariables ?? []

  const tableKeys = useMemo(() => new Set(uniqueTableDataKeys(elementsForVarKeys)), [elementsForVarKeys])
  const templateKeys = useMemo(() => extractVariableKeys(elementsForVarKeys), [elementsForVarKeys])

  const declaredHere = useMemo(() => {
    const s = bandEditorMode
      ? catalogKeySet(globalVariableDefinitions, [])
      : catalogKeySet(globalVariableDefinitions, localDefs)
    for (const d of systemGlobalVariableDefinitions()) {
      const k = normalizeCatalogVariableKey(d.key)
      if (k) s.add(k)
    }
    return s
  }, [globalVariableDefinitions, localDefs, bandEditorMode])

  const otherPageCatalogKeys = useMemo(() => {
    if (bandEditorMode) return [] as string[]
    const s = new Set<string>()
    pages.forEach((p, idx) => {
      if (idx === activePageIndex) return
      for (const d of p.localVariables ?? []) {
        const k = normalizeCatalogVariableKey(d.key)
        if (k) s.add(k)
      }
    })
    return [...s].sort()
  }, [pages, activePageIndex, bandEditorMode])

  const extraKeys = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>(declaredHere)
    for (const k of [...templateKeys, ...otherPageCatalogKeys]) {
      if (isSystemGlobalVariableKey(k)) continue
      if (seen.has(k)) continue
      seen.add(k)
      out.push(k)
    }
    return out.sort()
  }, [templateKeys, otherPageCatalogKeys, declaredHere])

  const fieldClass =
    'rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'

  const updateGlobalRow = (index: number, patch: Partial<VariableDefinition>) => {
    const row = globalVariableDefinitions[index]
    if (!row) return
    const merged = { ...row, ...patch }
    setGlobalVariableDefinitions(globalVariableDefinitions.map((d, i) => (i === index ? merged : d)))
  }

  const updateLocalRow = (index: number, patch: Partial<VariableDefinition>) => {
    if (!activePage) return
    const row = localDefs[index]
    if (!row) return
    const merged = { ...row, ...patch }
    setPageLocalVariableDefinitions(
      activePage.id,
      localDefs.map((d, i) => (i === index ? merged : d))
    )
  }

  const flashMerged = (scope: 'global' | 'local', keptIndex: number) => {
    setMergeFlash({ scope, index: keptIndex })
    window.setTimeout(() => setMergeFlash(null), 850)
  }

  const onGlobalKeyBlur = (index: number) => {
    const merged = mergeDuplicateCatalogRowsAtBlur(globalVariableDefinitions, index)
    if (!merged) return
    setGlobalVariableDefinitions(merged.next)
    flashMerged('global', merged.keptIndex)
  }

  const onLocalKeyBlur = (index: number) => {
    if (!activePage) return
    const merged = mergeDuplicateCatalogRowsAtBlur(localDefs, index)
    if (!merged) return
    setPageLocalVariableDefinitions(activePage.id, merged.next)
    flashMerged('local', merged.keptIndex)
  }

  const renderValueEditor = (normKey: string, isTable: boolean, fieldIdBase: string) => {
    if (!normKey) {
      const pid = `${fieldIdBase}-preview-placeholder`
      return (
        <input
          id={pid}
          name={pid}
          type="text"
          className={fieldClass}
          disabled
          placeholder="Set a field name first"
          value=""
          readOnly
        />
      )
    }
    if (isTable) {
      const tid = `${fieldIdBase}-table-json`
      return (
        <>
          <textarea
            id={tid}
            name={tid}
            className="min-h-[88px] w-full resize-y rounded border border-zinc-300 px-2 py-1.5 font-mono text-[11px] leading-snug text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            spellCheck={false}
            value={variableValues[normKey] ?? ''}
            onChange={(e) => setVariableValue(normKey, e.target.value)}
            placeholder={`[{"name":"A","price":1},{"name":"B","price":2}]`}
          />
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
            One JSON array of objects. Keys should match each column&apos;s field key.
          </span>
        </>
      )
    }
    const sid = `${fieldIdBase}-scalar`
    return (
      <input
        id={sid}
        name={sid}
        type="text"
        className={fieldClass}
        value={variableValues[normKey] ?? ''}
        onChange={(e) => setVariableValue(normKey, e.target.value)}
        placeholder="Preview value"
      />
    )
  }

  const renderCatalogRows = (
    scope: 'global' | 'local',
    defs: VariableDefinition[],
    onUpdateRow: (i: number, p: Partial<VariableDefinition>) => void,
    onRemoveRow: (i: number) => void,
    onAddRow: () => void,
    onKeyBlur: (i: number) => void
  ) => (
    <>
      <ul className="flex flex-col gap-3">
        {defs.map((d, i) => {
          const nk = normalizeCatalogVariableKey(d.key)
          const isTable = tableKeys.has(nk)
          const dupN = duplicateRowCount(defs, i)
          const isDup = dupN > 1
          const isFlash = mergeFlash?.scope === scope && mergeFlash.index === i
          const previewStorageKey =
            scope === 'local' &&
            nk &&
            globalVariableDefinitions.some((d) => normalizeCatalogVariableKey(d.key) === nk)
              ? pageLocalShadowStorageKey(nk)
              : nk

          return (
            <li
              key={`${scope}-${i}`}
              className={[
                'rounded-lg border p-3 transition-[transform,box-shadow,background-color,border-color] duration-500 ease-out',
                isDup
                  ? 'border-red-300 bg-red-50/80 dark:border-red-900/55 dark:bg-red-950/25'
                  : 'border-zinc-200 bg-white/90 dark:border-zinc-600 dark:bg-zinc-900/50',
                isFlash ? 'scale-[1.02] shadow-lg ring-2 ring-teal-400/90 dark:ring-teal-500/80' : '',
              ].join(' ')}
            >
              {isDup ? (
                <p className="mb-2 text-[10px] font-medium leading-snug text-red-800 dark:text-red-200">
                  Same key as another row in this list. Click away from the key field to merge into the
                  first row (descriptions are combined).
                </p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">Field key</span>
                  <input
                    id={`ag-var-${scope}-${i}-key`}
                    name={`ag-var-${scope}-${i}-key`}
                    type="text"
                    className={`${fieldClass} font-mono text-xs`}
                    value={d.key}
                    onChange={(e) => onUpdateRow(i, { key: e.target.value })}
                    onBlur={() => onKeyBlur(i)}
                    placeholder="e.g. customer_name"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">Description (optional)</span>
                  <input
                    id={`ag-var-${scope}-${i}-description`}
                    name={`ag-var-${scope}-${i}-description`}
                    type="text"
                    className={fieldClass}
                    value={d.description ?? ''}
                    onChange={(e) => onUpdateRow(i, { description: e.target.value || undefined })}
                    placeholder="Shown to authors in the catalog only"
                  />
                </label>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Preview value
                  {isTable && nk ? (
                    <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                      table rows
                    </span>
                  ) : null}
                </span>
                {scope === 'local' && nk && previewStorageKey !== nk ? (
                  <p className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
                    Same name as a global field — this preview is stored as{' '}
                    <code className="rounded bg-zinc-100 px-0.5 font-mono dark:bg-zinc-800">
                      {previewStorageKey}
                    </code>{' '}
                    so template-wide and page values stay separate. Use the matching entry from the{' '}
                    <kbd className="rounded border border-zinc-300 px-0.5 font-mono dark:border-zinc-600">@</kbd>{' '}
                    list when inserting into text.
                  </p>
                ) : null}
                {renderValueEditor(previewStorageKey, isTable, `ag-var-${scope}-${i}`)}
              </div>
              <button
                type="button"
                className="mt-2 text-[11px] text-red-600 hover:underline dark:text-red-400"
                onClick={() => onRemoveRow(i)}
              >
                Remove row
              </button>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        className="mt-2 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        onClick={onAddRow}
      >
        Add variable
      </button>
    </>
  )

  return (
    <div className="flex flex-col gap-8 p-3">
      {bandEditorMode ? (
        <p className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">
          While editing <span className="font-medium text-zinc-600 dark:text-zinc-300">header / footer</span>, only{' '}
          <span className="font-medium text-zinc-600 dark:text-zinc-300">global</span> template variables (and
          built-ins) are listed — merge fields in the band use these keys. Single-line previews feed{' '}
          <code className="font-mono text-[10px]">{'{{tokens}}'}</code>; JSON arrays feed table row data.
        </p>
      ) : (
        <p className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-600 dark:text-zinc-300">Global</span> names are available on
          every page. <span className="font-medium text-zinc-600 dark:text-zinc-300">Local</span> names apply
          to the current page only. Single-line preview values feed text tokens;{' '}
          <span className="font-medium">JSON arrays</span> feed table row data.
        </p>
      )}

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          Global variables
        </h3>
        <p className="mb-3 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
          Declared for the whole template (saved as <code className="font-mono">globalVariables</code> in
          layout JSON).
        </p>
        <ul className="mb-4 flex flex-col gap-3">
          {systemGlobalVariableDefinitions().map((d) => {
            const nk = normalizeCatalogVariableKey(d.key)
            return (
              <li
                key={`builtin-${nk}`}
                className="rounded-lg border border-zinc-200 bg-zinc-50/90 p-3 dark:border-zinc-600 dark:bg-zinc-800/40"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Built-in (read-only)
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">Field key</span>
                    <input
                      type="text"
                      className={`${fieldClass} cursor-not-allowed font-mono text-xs opacity-90`}
                      value={d.key}
                      readOnly
                      disabled
                      title="This variable is provided by the editor and cannot be renamed."
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">Description</span>
                    <input
                      type="text"
                      className={`${fieldClass} cursor-not-allowed opacity-90`}
                      value={d.description ?? ''}
                      readOnly
                      disabled
                    />
                  </label>
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Preview value</span>
                  <input
                    type="text"
                    className={`${fieldClass} cursor-not-allowed font-mono text-xs opacity-90`}
                    value={nk ? variableValues[nk] ?? '' : ''}
                    readOnly
                    disabled
                    title="Computed from the document; not editable."
                  />
                </div>
              </li>
            )
          })}
        </ul>
        {renderCatalogRows(
          'global',
          globalVariableDefinitions,
          updateGlobalRow,
          (i) => setGlobalVariableDefinitions(globalVariableDefinitions.filter((_, j) => j !== i)),
          () => setGlobalVariableDefinitions([...globalVariableDefinitions, { key: '', description: '' }]),
          onGlobalKeyBlur
        )}
      </section>

      {activePage && !bandEditorMode ? (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
            Local variables — {activePage.name}
          </h3>
          <p className="mb-3 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
            Only this page&apos;s behaviour and content should use these keys; they are stored under this
            page in layout JSON.
          </p>
          {renderCatalogRows(
            'local',
            localDefs,
            updateLocalRow,
            (i) =>
              setPageLocalVariableDefinitions(
                activePage.id,
                localDefs.filter((_, j) => j !== i)
              ),
            () =>
              setPageLocalVariableDefinitions(activePage.id, [
                ...localDefs,
                { key: '', description: '' },
              ]),
            onLocalKeyBlur
          )}
        </section>
      ) : null}

      {!bandEditorMode && extraKeys.length > 0 ? (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
            Also used in this template
          </h3>
          <p className="mb-3 text-[10px] text-zinc-500 dark:text-zinc-400">
            Keys referenced in text or tables, or declared on another page, that are not listed in the
            sections above.
          </p>
          <ul className="flex flex-col gap-4">
            {extraKeys.map((k) => {
              const isTable = tableKeys.has(k)
              return (
                <li key={k}>
                  <label className="flex flex-col gap-1.5 text-xs">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {k}
                      {isTable ? (
                        <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                          table rows
                        </span>
                      ) : null}
                    </span>
                    {renderValueEditor(
                      k,
                      isTable,
                      `ag-var-extra-${k.replace(/[^a-zA-Z0-9_-]/g, '_')}`
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {globalVariableDefinitions.length === 0 &&
      (bandEditorMode || localDefs.length === 0) &&
      extraKeys.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {bandEditorMode
            ? 'No custom globals yet. Add names under Global variables above, or insert merge fields in the band text.'
            : 'No variables yet. Add global or local names above, or insert merge fields in text on the canvas.'}
        </p>
      ) : null}
    </div>
  )
}
