import type { RefObject } from 'react'
import type { LayoutElement } from '../../types/layout'
import { getTableColumnsForDataKey, humanizeVariableKey } from '../../lib/previewFormData'
import { richContentToPlainText } from '../../lib/richContent'

function idSafeKey(s: string) {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function TableDataEditor({
  dataKey,
  columns,
  rows,
  onChange,
  onColumnHeaderChange,
}: {
  dataKey: string
  columns: { header: string; key: string }[]
  rows: Record<string, string>[]
  onChange: (next: Record<string, string>[]) => void
  /** Called when the user edits a column header inline in the data panel.
   * The callback writes plain text back to {@code el.columns[i].header}. */
  onColumnHeaderChange?: (colIndex: number, header: string) => void
}) {
  const colKeys = columns.map((c) => c.key)

  const setCell = (rowIndex: number, key: string, value: string) => {
    const next = rows.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r))
    onChange(next)
  }

  const addRow = () => {
    onChange([...rows, Object.fromEntries(colKeys.map((k) => [k, '']))])
  }

  const removeRow = (index: number) => {
    if (rows.length <= 1) return
    onChange(rows.filter((_, i) => i !== index))
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50/80 dark:border-zinc-600 dark:bg-zinc-800/40">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-2.5 py-2 dark:border-zinc-600">
        <div>
          <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
            {humanizeVariableKey(dataKey)}
          </h3>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Table · {dataKey}</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-500 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
          onClick={addRow}
        >
          Add row
        </button>
      </div>
      <div className="max-h-[min(40vh,280px)] overflow-auto">
        <table className="w-full min-w-[200px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-100/90 dark:border-zinc-600 dark:bg-zinc-900/50">
              {columns.map((c, ci) => (
                <th
                  key={c.key}
                  className="px-1 py-1 text-left font-semibold text-zinc-700 dark:text-zinc-200"
                >
                  <input
                    id={`ag-preview-table-${idSafeKey(dataKey)}-hdr-c${idSafeKey(c.key)}`}
                    name={`ag-preview-table-${idSafeKey(dataKey)}-hdr-c${idSafeKey(c.key)}`}
                    type="text"
                    className="w-full min-w-[3.5rem] rounded border border-zinc-300 bg-white px-1.5 py-1 text-[11px] font-semibold text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                    value={richContentToPlainText(c.header)}
                    placeholder={`Column ${ci + 1}`}
                    onChange={(e) => onColumnHeaderChange?.(ci, e.target.value)}
                    disabled={!onColumnHeaderChange}
                    aria-label={`Column ${ci + 1} header`}
                  />
                </th>
              ))}
              <th className="w-8 px-1 py-1.5" aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-700/80"
              >
                {columns.map((c) => (
                  <td key={c.key} className="p-1 align-middle">
                    <input
                      id={`ag-preview-table-${idSafeKey(dataKey)}-r${ri}-c${idSafeKey(c.key)}`}
                      name={`ag-preview-table-${idSafeKey(dataKey)}-r${ri}-c${idSafeKey(c.key)}`}
                      type="text"
                      className="w-full min-w-[3.5rem] rounded border border-zinc-300 bg-white px-1.5 py-1 text-[11px] text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                      value={richContentToPlainText(row[c.key])}
                      onChange={(e) => setCell(ri, c.key, e.target.value)}
                      aria-label={`${richContentToPlainText(c.header) || c.key} row ${ri + 1}`}
                    />
                  </td>
                ))}
                <td className="p-1 align-middle">
                  <button
                    type="button"
                    className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                    onClick={() => removeRow(ri)}
                    disabled={rows.length <= 1}
                    aria-label={`Remove row ${ri + 1}`}
                    title="Remove row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function PreviewDataPanel({
  formSectionRef,
  scalarKeys,
  scalars,
  onScalarChange,
  elements,
  tableKeys,
  tableRows,
  onTableRowsChange,
  onTableColumnHeaderChange,
  onGenerate,
  loading,
  err,
}: {
  formSectionRef: RefObject<HTMLDivElement | null>
  scalarKeys: string[]
  scalars: Record<string, string>
  onScalarChange: (key: string, value: string) => void
  elements: LayoutElement[]
  tableKeys: string[]
  tableRows: Record<string, Record<string, string>[]>
  onTableRowsChange: (dataKey: string, rows: Record<string, string>[]) => void
  /** Optional: when provided, the header row becomes editable inputs that
   * write the typed plain text back to the TABLE element's columns. */
  onTableColumnHeaderChange?: (dataKey: string, colIndex: number, header: string) => void
  onGenerate: () => void
  loading: boolean
  err: string | null
}) {
  const hasAnyFields = scalarKeys.length > 0 || tableKeys.length > 0

  return (
    <div ref={formSectionRef} className="flex min-h-0 min-w-0 flex-1 flex-col md:max-w-md lg:max-w-lg">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Fill in the fields below, then generate the PDF. Table columns match your template.
        </p>

        {!hasAnyFields ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No variables detected in this template. You can still generate to preview the layout.
          </p>
        ) : null}

        {scalarKeys.length > 0 ? (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Text fields
            </h3>
            <div className="flex flex-col gap-3">
              {scalarKeys.map((k) => (
                <label key={k} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                    {humanizeVariableKey(k)}
                  </span>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{`{{${k}}}`}</span>
                  <input
                    id={`ag-preview-scalar-${idSafeKey(k)}`}
                    name={`ag-preview-scalar-${idSafeKey(k)}`}
                    type="text"
                    className="rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                    value={scalars[k] ?? ''}
                    onChange={(e) => onScalarChange(k, e.target.value)}
                    autoComplete="off"
                  />
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {tableKeys.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Tables
            </h3>
            {tableKeys.map((tk) => {
              const cols = getTableColumnsForDataKey(elements, tk)
              const empty = [Object.fromEntries(cols.map((c) => [c.key, '']))]
              return (
                <TableDataEditor
                  key={tk}
                  dataKey={tk}
                  columns={cols}
                  rows={tableRows[tk] ?? empty}
                  onChange={(next) => onTableRowsChange(tk, next)}
                  onColumnHeaderChange={
                    onTableColumnHeaderChange
                      ? (ci, header) => onTableColumnHeaderChange(tk, ci, header)
                      : undefined
                  }
                />
              )
            })}
          </section>
        ) : null}
      </div>

      <div className="mt-3 shrink-0 border-t border-zinc-200 pt-3 dark:border-zinc-700">
        <button
          type="button"
          className="w-full rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:shadow-none"
          onClick={onGenerate}
          disabled={loading}
        >
          {loading ? 'Generating…' : 'Generate PDF'}
        </button>
        {err ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{err}</p> : null}
      </div>
    </div>
  )
}
