import { useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { selectAllTemplateElements, useEditorStore } from '../../stores/editorStore'
import { extractVariableKeys, uniqueTableDataKeys } from '../../lib/variables'
import { scalarVariableKeys } from '../../lib/previewFormData'
import { variableMergeFieldSurfaceLabel } from '../../lib/layoutBehaviourResolve'
import { PreviewTableEditor } from './PreviewTableEditor'
import { parseTableVariableData } from '../../lib/tableDataFormat'

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
          {/*
            A structured table must NOT be handed to PreviewTableEditor.

            That editor speaks the legacy shape — an array of row objects.
            Given a structured value ({"data":[[…]],"cellStyle":…}) it parses to
            a single blank row, and the first keystroke commits
            serializeTableRows over the top: the grid, cellStyle and borderStyle
            are gone, silently, from clicking into a cell on this tab.
            VariablesSection already guards the same value this way; this tab
            did not, and it is the one people open while filling a document in.
          */}
          {tableKeys.map((key) => {
            const raw = values[key] ?? ''
            const structured = parseTableVariableData(raw)
            if (structured) {
              const headers = structured.data[0] ?? []
              const bodyRows = Math.max(0, structured.data.length - 1)
              return (
                <div
                  key={key}
                  className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                >
                  <p className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{key}</p>
                  <span className="mt-1.5 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                    {headers.length} col{headers.length !== 1 ? 's' : ''} &times; {bodyRows} row
                    {bodyRows !== 1 ? 's' : ''}
                  </span>
                  {headers.length > 0 && (
                    <p className="mt-1.5 text-[11px] leading-snug text-emerald-700 dark:text-emerald-300">
                      <span className="font-medium">Headers:</span>{' '}
                      <span className="font-mono text-[10px]">{headers.join(', ')}</span>
                    </p>
                  )}
                  <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                    Edit this table on the canvas — editing it here would drop its cell and
                    border styling.
                  </p>
                </div>
              )
            }
            return (
              <PreviewTableEditor
                key={key}
                dataKey={key}
                elements={elements}
                value={raw}
                onChange={(json) => setVariableValue(key, json)}
              />
            )
          })}
        </section>
      )}
    </div>
  )
}
