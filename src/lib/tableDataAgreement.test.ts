import { describe, expect, it } from 'vitest'
import { detectTableDataFormatFromJson, parseTableVariableData, serializeTableVariableData } from './tableDataFormat'

/**
 * The two places that build render data must agree about a table.
 *
 * <p>`buildGenerationDataFromVariableValues` (previewFormData) feeds the real
 * generate call; `buildPreviewData` (previewStore) feeds the inline preview.
 * Both end at the same renderer, so a table that renders in one must render in
 * the other — that equivalence IS the product promise.
 *
 * <p>They disagreed. previewFormData detected the structured shape and
 * forwarded it; previewStore pushed everything through `parseTableRowsFromJson`,
 * which yields one blank row for a structured object, which the blank filter
 * then removed. The result was an empty table in the pane whose entire job is
 * to show what the PDF will look like.
 *
 * <p>These tests work on the format helpers rather than importing the two
 * builders, because both pull from the editor store; the branch condition is
 * the thing that was wrong and it is what is pinned here.
 */
describe('table data format agreement', () => {
  // Round-tripped through parse so the fixture is built from a value the
  // production code itself produced, rather than a hand-cast literal.
  const structured = serializeTableVariableData(
    parseTableVariableData(
      JSON.stringify({
        data: [
          ['date', 'reference', 'debit'],
          ['03 Jul 2026', 'INV-2201', '45000.00'],
        ],
        cellStyle: { fontSize: 9 },
      })
    )!
  )

  const legacy = JSON.stringify([{ date: '03 Jul 2026', reference: 'INV-2201', debit: '45000.00' }])

  it('the console writes a shape both builders must recognise as structured', () => {
    expect(detectTableDataFormatFromJson(structured)).toBe('structured')
    expect(parseTableVariableData(structured)).not.toBeNull()
  })

  it('a legacy array is not mistaken for structured', () => {
    expect(detectTableDataFormatFromJson(legacy)).toBe('legacy')
    expect(parseTableVariableData(legacy)).toBeNull()
  })

  it('structured survives a serialize/parse round trip with its styling', () => {
    const parsed = parseTableVariableData(structured)!
    expect(parsed.data).toHaveLength(2)
    expect(parsed.data[0]).toEqual(['date', 'reference', 'debit'])
    // The reason an array cannot replace this shape.
    expect(parsed.cellStyle).toEqual({ fontSize: 9 })
  })

  it('an empty or malformed value is neither format', () => {
    expect(parseTableVariableData('')).toBeNull()
    expect(parseTableVariableData('not json')).toBeNull()
    expect(parseTableVariableData('{"nope":1}')).toBeNull()
  })
})
