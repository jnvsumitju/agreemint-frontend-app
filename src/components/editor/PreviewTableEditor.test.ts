import { describe, expect, it } from 'vitest'
import { serializeTableRows } from './PreviewTableEditor'
import { parseTableRowsFromJson, tableRowsToPayload } from '../../lib/previewFormData'

/**
 * The table editor writes what the render path reads.
 *
 * <p>This is the contract the raw JSON textarea got wrong. It advertised
 * `{"data":[["Name","Qty"],["Widget","2"]]}` — a shape nothing in the codebase
 * parses — so following the only hint on screen produced data the renderer
 * silently ignored, and the document came out with an empty table and no error
 * anywhere.
 *
 * <p>Asserted as a round trip through the real helpers rather than against a
 * hardcoded string, so it stays true if the storage shape is ever changed on
 * purpose.
 */
describe('table row serialisation', () => {
  const cols = ['description', 'qty', 'amount']

  it('round-trips through the parser the renderer uses', () => {
    const rows = [
      { description: 'Steel shelving unit', qty: '10', amount: '₹70,800.00' },
      { description: 'Workbench 1800mm', qty: '4', amount: '₹42,480.00' },
    ]

    const stored = serializeTableRows(rows)
    // `buildPreviewData` does exactly this before handing data to the renderer.
    const readBack = tableRowsToPayload(parseTableRowsFromJson(stored, cols))

    expect(readBack).toEqual(rows)
  })

  it('stores an array of row objects, not the shape the old placeholder taught', () => {
    const stored = JSON.parse(serializeTableRows([{ description: 'A', qty: '1', amount: '2' }]))
    expect(Array.isArray(stored)).toBe(true)
    expect(stored[0]).toEqual({ description: 'A', qty: '1', amount: '2' })
    // The discredited shape, kept explicit so nobody reintroduces it.
    expect(stored).not.toHaveProperty('data')
  })

  it('drops rows the author left entirely blank', () => {
    // A blank row is not "no data" to the renderer — it prints an empty line in
    // the middle of the table.
    const stored = serializeTableRows([
      { description: 'Real', qty: '1', amount: '2' },
      { description: '', qty: '', amount: '' },
      { description: '  ', qty: ' ', amount: '' },
    ])
    expect(JSON.parse(stored)).toHaveLength(1)
  })

  it('keeps a row that is only partly filled', () => {
    // Half-entered is still intent; silently discarding it would delete the
    // author's typing as they went.
    const stored = serializeTableRows([{ description: 'Just a name', qty: '', amount: '' }])
    expect(JSON.parse(stored)).toHaveLength(1)
  })

  it('an emptied table serialises to an empty array, not to a blank row', () => {
    expect(serializeTableRows([{ description: '', qty: '', amount: '' }])).toBe('[]')
    // And that survives the read-back as "no rows to draw".
    expect(JSON.parse(serializeTableRows([]))).toEqual([])
  })
})
