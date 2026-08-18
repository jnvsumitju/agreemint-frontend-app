import { useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { selectAllTemplateElements, useEditorStore } from '../../stores/editorStore'
import { extractVariableKeys, uniqueTableDataKeys } from '../../lib/variables'
import { scalarVariableKeys } from '../../lib/previewFormData'
import { variableMergeFieldSurfaceLabel } from '../../lib/layoutBehaviourResolve'
import { PreviewTableEditor } from './PreviewTableEditor'

/**
 * Right-hand tab while previewing: the values the document renders with.
 *
 * <p>Writes straight to {@code editorStore.variableValues} through
 * {@code setVariableValue} — the same field the Vars tab edits. The modal this
 * replaced kept its own local copy, seeded from the store on open and never
 * written back, so a value typed in the preview vanished when it closed and the
 * two surfaces disagreed about what the document said. Sharing the store is
 * what keeps a second editing surface honest.
 *
 * <p>Deliberately lighter than the Vars tab: field names and values only, no
 * key renaming, descriptions or local variables. Someone checking a rendered
 * document wants to try different content, not restructure the schema.
 */
export function PreviewValuesTab() {
  const elements = useEditorStore(useShallow(selectAllTemplateElements))
  const globalDefs = useEditorStore((s) => s.globalVariableDefinitions)
  const values = useEditorStore((s) => s.variableValues)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)
  const activePage = useEditorStore((s) => s.pages[s.activePageIndex])

  // Union of what the document references and what the author declared, so a
  // declared-but-unbound field still gets a box to type into.
  const keys = useMemo(() => {
    const referenced = extractVariableKeys(elements)
    const declared = (globalDefs ?? [])
      .map((d) => d.key)
      .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    return Array.from(new Set([...referenced, ...declared]))
  }, [elements, globalDefs])

  const tableKeys = useMemo(() => uniqueTableDataKeys(elements), [elements])
  const scalarKeys = useMemo(() => scalarVariableKeys(keys, tableKeys), [keys, tableKeys])

  if (scalarKeys.length === 0 && tableKeys.length === 0) {
    return (
      <div className="p-4">
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          This template has no variables. The preview renders it exactly as laid out.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
        These are the same preview values as the Vars tab — editing either changes both.
        Refresh the preview to render with them.
      </p>

      {scalarKeys.length > 0 && (
        <section className="flex flex-col gap-2.5">
          {scalarKeys.map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                {variableMergeFieldSurfaceLabel(key, globalDefs ?? [], activePage)}
              </span>
              <span className="font-mono text-[9px] text-zinc-400 dark:text-zinc-500">
                {`{{${key}}}`}
              </span>
              <input
                type="text"
                value={values[key] ?? ''}
                onChange={(e) => setVariableValue(key, e.target.value)}
                placeholder="Preview value"
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </label>
          ))}
        </section>
      )}

      {tableKeys.length > 0 && (
        <section className="flex flex-col gap-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Tables
          </h3>
          {tableKeys.map((key) => (
            <PreviewTableEditor
              key={key}
              dataKey={key}
              elements={elements}
              value={values[key] ?? ''}
              onChange={(json) => setVariableValue(key, json)}
            />
          ))}
        </section>
      )}
    </div>
  )
}
