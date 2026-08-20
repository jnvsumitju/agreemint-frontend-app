import { describe, expect, it } from 'vitest'
import { parseTableRowsFromJson } from './previewFormData'

/**
 * The Developer modal's cURL is written for a human to read and edit.
 *
 * <p>It used to serialise `variableValues` straight out of the store. That map
 * is flat key-to-string, so a table's rows sat in it as a stringified array and
 * the snippet came out with every quote inside the rows escaped — and a
 * rich-text cell, whose value is itself JSON, escaped twice. Technically
 * correct; nobody would hand-write it, and the docs told people to write
 * something else.
 */
describe('developer snippet payload', () => {
  const columns = [
    { key: 'date', header: 'Date' },
    { key: 'reference', header: 'Ref' },
    { key: 'description', header: 'Description' },
  ]

  // Exactly what the store holds for the statement template's table.
  const stored = JSON.stringify([
    { date: '03 Jul 2026', reference: 'INV-2201', description: 'Cotton fabric supply' },
    { date: '08 Jul 2026', reference: 'PMT-0091', description: 'Payment received' },
  ])

  it('the stored form is what produced the backslashes', () => {
    // The old snippet embedded this string as a VALUE, so JSON.stringify
    // escaped every quote in it a second time.
    const oldSnippet = JSON.stringify({ data: { transactions: stored } }, null, 2)
    expect(oldSnippet).toContain('\\"date\\"')
  })

  it('parsing to a real array removes that layer entirely', () => {
    const rows = parseTableRowsFromJson(stored, columns.map((c) => c.key))
    const newSnippet = JSON.stringify({ data: { transactions: rows } }, null, 2)

    expect(newSnippet).not.toContain('\\"')
    expect(newSnippet).toContain('"date": "03 Jul 2026"')
  })

  it('the rows survive the round trip intact', () => {
    const rows = parseTableRowsFromJson(stored, columns.map((c) => c.key))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      date: '03 Jul 2026',
      reference: 'INV-2201',
      description: 'Cotton fabric supply',
    })
  })

  it('a table with only blank rows comes out as an empty array', () => {
    // What a freshly-bound table holds: the Loop toggle seeds a grid of blank
    // rows, so this is the state a new author actually sees.
    const blank = JSON.stringify([
      { date: '', reference: '', description: '' },
      { date: '', reference: '', description: '' },
    ])
    const rows = parseTableRowsFromJson(blank, columns.map((c) => c.key)).filter((r) =>
      Object.values(r).some((v) => String(v ?? '').trim() !== '')
    )
    expect(rows).toEqual([])
    expect(JSON.stringify({ data: { transactions: rows } })).toContain('"transactions":[]')
  })

  it('a partly-filled table keeps only the rows with content', () => {
    const partial = JSON.stringify([
      { date: '03 Jul 2026', reference: 'INV-2201', description: 'Supply' },
      { date: '', reference: '', description: '' },
    ])
    const rows = parseTableRowsFromJson(partial, columns.map((c) => c.key)).filter((r) =>
      Object.values(r).some((v) => String(v ?? '').trim() !== '')
    )
    expect(rows).toHaveLength(1)
  })

  it('an empty array never regresses to the escaped string', () => {
    // The bug this guards: falling through on a table with no usable rows left
    // the raw stored STRING in the payload — the escaped form, on exactly the
    // tables a new author is most likely to be looking at.
    const snippet = JSON.stringify({ data: { transactions: [] } }, null, 2)
    expect(snippet).not.toContain('\\"')
    expect(snippet).toContain('"transactions": []')
  })

  it('a rich-text cell keeps ONE level of escaping, not two', () => {
    // Its value genuinely is JSON, so one level is inherent. Two was ours.
    const withRich = JSON.stringify([
      { date: '20 Jul 2026', reference: 'PMT-0098', description: '{"rich":true,"runs":[]}' },
    ])
    const rows = parseTableRowsFromJson(withRich, columns.map((c) => c.key))
    const snippet = JSON.stringify({ data: { transactions: rows } }, null, 2)

    expect(snippet).toContain('\\"rich\\"')      // one level, unavoidable
    expect(snippet).not.toContain('\\\\\\"')      // not two
  })
})
