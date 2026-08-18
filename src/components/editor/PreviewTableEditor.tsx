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
 * <p>Stores every row as typed, INCLUDING blank ones. An earlier version
 * dropped blank rows here, to keep empty lines out of the finished document —
 * a real requirement enforced in the wrong place. Storage is the editor's
 * state, and a row you have just added is blank by definition, so filtering
 * here made "Add row" a no-op (append a blank, serialise, blank is gone) and
 * made deleting the last row look like clearing it (store [], read back one
 * blank row). Blank rows are dropped where they actually matter, in
 * {@code buildPreviewData}, on the way to the renderer.
 */
export function serializeTableRows(rows: Record<string, string>[]): string {
  return JSON.stringify(tableRowsToPayload(rows))
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
 * <p>Laid out as a grid: column names once in a header, then one line per row.
 * The first attempt stacked each row's fields vertically to keep every label
 * visible, which made a four-row invoice twenty-eight labelled inputs tall —
 * unusable for a different reason. The panel is too narrow for seven columns,
 * so the grid scrolls horizontally rather than crushing each cell to forty
 * pixels; the header scrolls with it, so a column is always identifiable.
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

      {/* One horizontal scroller wraps header and body together, so the columns
          stay aligned and the header travels with them. */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <div className="min-w-max">
          <div
            className="flex items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-800/60"
          >
            {columns.map((col) => (
              <span
                key={col.key}
                className="w-[104px] shrink-0 truncate text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                title={col.header}
              >
                {col.header}
              </span>
            ))}
            {/* Spacer matching the remove button, so headers line up with cells. */}
            <span className="w-5 shrink-0" aria-hidden />
          </div>

          {rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className="flex items-center gap-1 border-b border-zinc-100 px-2 py-1 last:border-b-0 dark:border-zinc-800"
            >
              {columns.map((col) => (
                <input
                  key={col.key}
                  type="text"
                  value={row[col.key] ?? ''}
                  onChange={(e) => setCell(rowIndex, col.key, e.target.value)}
                  aria-label={`${col.header}, row ${rowIndex + 1}`}
                  className="w-[104px] shrink-0 rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              ))}
              <button
                type="button"
                onClick={() => removeRow(rowIndex)}
                title={`Remove row ${rowIndex + 1}`}
                aria-label={`Remove row ${rowIndex + 1}`}
                className="w-5 shrink-0 rounded text-[13px] leading-none text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

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
