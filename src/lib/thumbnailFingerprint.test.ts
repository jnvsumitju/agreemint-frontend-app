import { describe, expect, it } from 'vitest'
import { thumbnailFingerprint } from '../lib/thumbnailFingerprint'

/**
 * What counts as "changed" for the sixty-second preview capture.
 *
 * <p>Each capture costs the server a full PDF render, a rasterise and an
 * upload, so the fingerprint is the only thing standing between an editor left
 * open all afternoon and a render every minute for as long as the tab lives.
 * That makes both directions load-bearing: too broad and it never stops
 * capturing, too narrow and the card in the templates list quietly stops
 * matching the template.
 *
 * <p>The variables half is here because the first version of this only
 * fingerprinted the layout. That reads fine and is wrong — the server renders
 * the draft's variable values into the page, and filling in sample data is
 * most of what editing actually is, so the thumbnail would have frozen on the
 * first minute's worth of work for the majority of sessions.
 */
describe('thumbnail capture fingerprint', () => {
  const base = {
    layout: { pages: [{ id: 'p1', elements: [{ id: 'e1', x: 10 }] }] },
    variableValues: { invoice_no: 'INV-001', total: '₹1,42,360.00' },
  }

  it('is stable when nothing moved', () => {
    expect(thumbnailFingerprint(base)).toBe(
      thumbnailFingerprint({
        layout: { pages: [{ id: 'p1', elements: [{ id: 'e1', x: 10 }] }] },
        variableValues: { invoice_no: 'INV-001', total: '₹1,42,360.00' },
      })
    )
  })

  it('changes when an element moves', () => {
    expect(
      thumbnailFingerprint({
        ...base,
        layout: { pages: [{ id: 'p1', elements: [{ id: 'e1', x: 11 }] }] },
      })
    ).not.toBe(thumbnailFingerprint(base))
  })

  it('changes when only a variable value is edited', () => {
    // The case the layout-only version missed.
    expect(
      thumbnailFingerprint({
        ...base,
        variableValues: { ...base.variableValues, total: '₹1,50,000.00' },
      })
    ).not.toBe(thumbnailFingerprint(base))
  })

  it('changes when a variable is cleared rather than retyped', () => {
    expect(
      thumbnailFingerprint({ ...base, variableValues: { ...base.variableValues, total: '' } })
    ).not.toBe(thumbnailFingerprint(base))
  })

  it('changes when a variable is removed entirely', () => {
    expect(
      thumbnailFingerprint({ ...base, variableValues: { invoice_no: 'INV-001' } })
    ).not.toBe(thumbnailFingerprint(base))
  })

  it('changes when an element is added', () => {
    expect(
      thumbnailFingerprint({
        ...base,
        layout: { pages: [{ id: 'p1', elements: [{ id: 'e1', x: 10 }, { id: 'e2', x: 20 }] }] },
      })
    ).not.toBe(thumbnailFingerprint(base))
  })

  it('does not confuse a layout value with a variable of the same content', () => {
    // Both halves are serialised, so they must not be able to trade places and
    // produce the same string — that would hide a real edit.
    const a = thumbnailFingerprint({ layout: { x: 'INV-001' }, variableValues: {} })
    const b = thumbnailFingerprint({ layout: {}, variableValues: { x: 'INV-001' } })
    expect(a).not.toBe(b)
  })
})
