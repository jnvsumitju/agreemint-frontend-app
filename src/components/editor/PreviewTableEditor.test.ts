import { describe, expect, it } from 'vitest'
import { serializeTableRows } from './PreviewTableEditor'
import { emptyTableRow, parseTableRowsFromJson, tableRowsToPayload } from '../../lib/previewFormData'

/**
 * The table editor writes what the render path reads, and preserves what the
 * author typed while they are typing it.
 *
 * <p>Two separate requirements that an earlier version conflated. Blank rows
 * must not print as empty lines in the finished document — true, but enforced
 * when SAVING it broke the editor outright: "Add row" appended a blank row,
 * serialisation dropped it, and nothing appeared; deleting the only row stored
 * an empty list which read back as one blank row, so it looked like the data
 * had been cleared rather than the row removed.
 *
 * <p>So these assert the editor keeps every row as typed, and the separate
 * render-path filter is what keeps blanks out of the PDF.
 */
describe('table row serialisation', () => {
  const cols = ['description', 'qty', 'amount']
  /** What `buildPreviewData` does on the way to the renderer. */
  const forRenderer = (stored: string) =>
    parseTableRowsFromJson(stored, cols).filter((r) =>
      Object.values(r).some((v) => String(v ?? '').trim() !== '')
    )

  it('round-trips through the parser the renderer uses', () => {
    const rows = [
      { description: 'Steel shelving unit', qty: '10', amount: '₹70,800.00' },
      { description: 'Workbench 1800mm', qty: '4', amount: '₹42,480.00' },
    ]
    expect(tableRowsToPayload(parseTableRowsFromJson(serializeTableRows(rows), cols))).toEqual(rows)
  })

  it('stores an array of row objects, not the shape the old placeholder taught', () => {
    const stored = JSON.parse(serializeTableRows([{ description: 'A', qty: '1', amount: '2' }]))
    expect(Array.isArray(stored)).toBe(true)
    expect(stored[0]).toEqual({ description: 'A', qty: '1', amount: '2' })
    expect(stored).not.toHaveProperty('data')
  })

  // ── the two reported bugs ──────────────────────────────────────────────────

  it('adding a row actually adds one', () => {
    // The reported symptom: "Add row" did nothing, because the appended row is
    // blank by definition and blank rows were being filtered out on save.
    const existing = [{ description: 'Steel shelving', qty: '10', amount: '2' }]
    const afterAdd = [...existing, emptyTableRow(cols)]

    const stored = serializeTableRows(afterAdd)

    expect(parseTableRowsFromJson(stored, cols)).toHaveLength(2)
    expect(parseTableRowsFromJson(stored, cols)[1]).toEqual(emptyTableRow(cols))
  })

  it('adding two rows in a row keeps both', () => {
    // Each add re-reads the stored value, so a filter would make the second add
    // silently overwrite the first.
    let stored = serializeTableRows([emptyTableRow(cols)])
    stored = serializeTableRows([...parseTableRowsFromJson(stored, cols), emptyTableRow(cols)])
    expect(parseTableRowsFromJson(stored, cols)).toHaveLength(2)
  })

  it('removing one of two rows leaves exactly the other one', () => {
    // The reported symptom on the delete side: with a filter, removing a row
    // could read back as the row still being there but emptied.
    const rows = [
      { description: 'Keep me', qty: '1', amount: '1' },
      { description: 'Remove me', qty: '2', amount: '2' },
    ]
    const stored = serializeTableRows(rows.filter((_, i) => i !== 1))
    const back = parseTableRowsFromJson(stored, cols)

    expect(back).toHaveLength(1)
    expect(back[0].description).toBe('Keep me')
  })

  it('removing the last row empties the table rather than clearing one row', () => {
    const stored = serializeTableRows([])
    expect(JSON.parse(stored)).toEqual([])
    // Nothing reaches the renderer, so the table draws no body rows.
    expect(forRenderer(stored)).toEqual([])
  })

  // ── and the requirement that caused the mistake, still honoured ────────────

  it('a blank row is kept in the editor but never reaches the renderer', () => {
    const stored = serializeTableRows([
      { description: 'Real', qty: '1', amount: '2' },
      emptyTableRow(cols),
    ])

    // The editor keeps it, so the author can type into the row they just added.
    expect(parseTableRowsFromJson(stored, cols)).toHaveLength(2)
    // The document does not, so it prints no empty line.
    expect(forRenderer(stored)).toHaveLength(1)
  })

  it('a partly-filled row does reach the renderer', () => {
    const stored = serializeTableRows([{ description: 'Just a name', qty: '', amount: '' }])
    expect(forRenderer(stored)).toHaveLength(1)
  })

  it('whitespace-only cells count as blank for the renderer', () => {
    const stored = serializeTableRows([{ description: '  ', qty: ' ', amount: '' }])
    expect(parseTableRowsFromJson(stored, cols)).toHaveLength(1)
    expect(forRenderer(stored)).toHaveLength(0)
  })
})
