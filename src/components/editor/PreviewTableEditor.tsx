import { useMemo } from 'react'
import type { LayoutElement } from '../../types/layout'
import {
  emptyTableRow,
  getTableColumnsForDataKey,
  parseTableRowsFromJson,
  tableRowsToPayload,
} from '../../lib/previewFormData'

/**
 * Serialise rows into the shape the render path reads back.
 *
 * <p>An ARRAY OF ROW OBJECTS keyed by column key — the same thing
 * {@link parseTableRowsFromJson} expects and {@code buildPreviewData} feeds to
 * the renderer. Exported so that contract can be tested directly: the textarea
 * this replaced advertised `{"data":[[...]]}`, a shape nothing reads, so anyone
 * following the only hint on screen produced data the renderer ignored.
 *
 * <p>Rows that are entirely blank are dropped rather than stored, because an
 * empty row renders as an empty line in the finished document.
 */
export function serializeTableRows(rows: Record<string, string>[]): string {
  const meaningful = rows.filter((r) => Object.values(r).some((v) => v.trim() !== ''))
  return JSON.stringify(tableRowsToPayload(meaningful))
}

/**
 * Row editor for a table-bound variable.
 *
 * <p>This replaced a raw JSON textarea, which failed on its own terms: the
 * stored shape is an array of row objects keyed by the template's own column
 * keys, and nothing on screen said so. The placeholder even suggested a
 * different shape entirely, so following the only available hint produced data
 * the renderer ignored.
 *
 * <p>The column names come from the TABLE element itself, so the fields here
 * are the columns the author actually laid out — "Description", "HSN/SAC",
 * "Qty" — rather than anything the person filling them in has to know.
 *
 * <p>Laid out as one card per row with labelled fields, not as a grid. This
 * lives in the right-hand panel, and a seven-column invoice grid at that width
 * gives each cell about forty pixels, which is unusable. Stacking costs
 * vertical space and buys legible labels on every field.
 */
export function PreviewTableEditor({
  dataKey,
  elements,
  value,
  onChange,
}: {
  dataKey: string
  elements: LayoutElement[]
  /** The stored JSON, or empty before anything has been entered. */
  value: string
  /** Receives the serialised JSON to store back. */
  onChange: (json: string) => void
}) {
  const columns = useMemo(
    () => getTableColumnsForDataKey(elements, dataKey),
    [elements, dataKey]
  )
  const colKeys = useMemo(() => columns.map((c) => c.key), [columns])

  // `parseTableRowsFromJson` already returns a single blank row for empty or
  // malformed input, so the editor always has something to show rather than
  // presenting an empty box with no way in.
  const rows = useMemo(
    () => parseTableRowsFromJson(value?.trim() ? value : '[]', colKeys),
    [value, colKeys]
  )

  const commit = (next: Record<string, string>[]) => onChange(serializeTableRows(next))

  const setCell = (rowIndex: number, key: string, cell: string) =>
    commit(rows.map((r, i) => (i === rowIndex ? { ...r, [key]: cell } : r)))

  const addRow = () => commit([...rows, emptyTableRow(colKeys)])

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index)
    commit(next.length > 0 ? next : [emptyTableRow(colKeys)])
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">{dataKey}</span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/40"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Row {rowIndex + 1}
            </span>
            <button
              type="button"
              onClick={() => removeRow(rowIndex)}
              title={`Remove row ${rowIndex + 1}`}
              className="rounded px-1 text-[13px] leading-none text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
            >
              ×
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            {columns.map((col) => (
              <label key={col.key} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{col.header}</span>
                <input
                  type="text"
                  value={row[col.key] ?? ''}
                  onChange={(e) => setCell(rowIndex, col.key, e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 py-1.5 text-[11px] font-medium text-zinc-600 transition-colors hover:border-violet-400 hover:text-violet-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-violet-500 dark:hover:text-violet-300"
      >
        + Add row
      </button>
    </div>
  )
}
