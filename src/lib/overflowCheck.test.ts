import { describe, it, expect } from 'vitest'

import { findOverflowingElements, growOverflowingElementHeights } from './overflowCheck'
import type { LayoutJson } from '../types/layout'
import type { MeasureLayoutResponse } from './api'

function textEl(id: string, height: number, extra: Record<string, unknown> = {}) {
  return { id, type: 'TEXT', x: 0, y: 0, width: 200, height, content: 'x', ...extra }
}

function measurements(map: Record<string, number>): MeasureLayoutResponse['measurements'] {
  const out: MeasureLayoutResponse['measurements'] = {}
  for (const [id, h] of Object.entries(map)) {
    out[id] = { measuredHeight: h, textLines: [], rowHeights: [] }
  }
  return out
}

describe('findOverflowingElements', () => {
  // These four cases are the ones rendered and inspected pixel by pixel: a
  // 16pt heading at lineHeight 1.45 measures 23.2pt, and the descenders of
  // "gypj" survive intact in a 20pt box but are visibly cut in a 16pt one.
  // The badge has to draw its line in the same place the renderer does.
  it('does not flag a box that clips only the bottom half-leading', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [textEl('a', 20, { style: { fontSize: 16, lineHeight: 1.45 } })],
    }
    // 23.2 measured vs a 20pt box: 3.2pt of "overflow", all of it whitespace.
    const overflows = findOverflowingElements(layout, measurements({ a: 23.2 }))
    expect(overflows, 'renders clean, so it must not warn').toEqual([])
  })

  it('flags the same content once the glyphs are actually cut', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [textEl('a', 16, { style: { fontSize: 16, lineHeight: 1.45 } })],
    }
    const overflows = findOverflowingElements(layout, measurements({ a: 23.2 }))
    expect(overflows).toHaveLength(1)
    // Ink bottom is 23.2 - 3.6 = 19.6, so 3.6pt of glyph is lost.
    expect(overflows[0]?.delta).toBeCloseTo(3.6, 1)
  })

  it('reports the ink lost, not the line-box difference', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [textEl('a', 12, { style: { fontSize: 16, lineHeight: 1.45 } })],
    }
    const overflows = findOverflowingElements(layout, measurements({ a: 23.2 }))
    // Line-box difference would be 11.2; the glyphs only lose 7.6.
    expect(overflows[0]?.delta).toBeCloseTo(7.6, 1)
    expect(overflows[0]?.measuredHeight, 'grow-to-fit still uses the full line box').toBe(23.2)
  })

  it('treats a missing lineHeight as the 1.4 canvas default', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [textEl('a', 14, { style: { fontSize: 10 } })],
    }
    // 10 x 1.4 = 14 measured, half-leading 2 -> ink bottom 12, inside a 14pt box.
    expect(findOverflowingElements(layout, measurements({ a: 14 }))).toEqual([])
  })

  it('flags text elements whose measured height exceeds the box', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [textEl('a', 20), textEl('b', 50)],
    }
    const ms = measurements({ a: 30, b: 40 })  // a overflows; b fits
    const overflows = findOverflowingElements(layout, ms)
    expect(overflows).toHaveLength(1)
    expect(overflows[0]?.elementId).toBe('a')
    // 30 measured - 2.4 half-leading (the 12pt/1.4 default) - 20 box = 7.6pt of
    // glyph actually lost. The raw line-box difference would read 10.
    expect(overflows[0]?.delta).toBeCloseTo(7.6, 1)
    expect(overflows[0]?.boxHeight).toBe(20)
    expect(overflows[0]?.measuredHeight).toBe(30)
  })

  it('ignores sub-point drift (ascender/descender rounding)', () => {
    // measured > box by only 0.3pt — below the 0.5pt noise floor.
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [textEl('a', 20)],
    }
    const ms = measurements({ a: 20.3 })
    expect(findOverflowingElements(layout, ms)).toHaveLength(0)
  })

  it('skips non-text elements', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [
        { id: 'img', type: 'IMAGE', x: 0, y: 0, width: 100, height: 100 },
        { id: 'shape', type: 'ELLIPSE', x: 0, y: 0, width: 100, height: 100 },
      ],
    }
    const ms = measurements({ img: 500, shape: 500 })
    expect(findOverflowingElements(layout, ms)).toHaveLength(0)
  })

  it('treats missing type as TEXT (backend default dispatch)', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [{ id: 'untyped', x: 0, y: 0, width: 100, height: 10 }],
    }
    const ms = measurements({ untyped: 40 })
    const overflows = findOverflowingElements(layout, ms)
    expect(overflows).toHaveLength(1)
    expect(overflows[0]?.elementId).toBe('untyped')
  })

  it('walks multi-page layouts', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      pages: [
        { id: 'p1', elements: [textEl('p1-a', 10)] },
        { id: 'p2', elements: [textEl('p2-a', 10), textEl('p2-b', 50)] },
      ],
    }
    // All three clip for real: with the 12pt/1.4 default the half-leading is
    // 2.4pt, so `p2-a` needs to measure past 12.4 to lose any glyph. Picking a
    // number that only overflowed the line box would have made this test pass
    // for the wrong reason once the check moved to measuring ink.
    const ms = measurements({ 'p1-a': 30, 'p2-a': 20, 'p2-b': 80 })
    const overflows = findOverflowingElements(layout, ms).map((o) => o.elementId).sort()
    expect(overflows).toEqual(['p1-a', 'p2-a', 'p2-b'])
  })
})

describe('growOverflowingElementHeights', () => {
  it('returns the original layout when nothing overflows', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [textEl('a', 100)],
    }
    expect(growOverflowingElementHeights(layout, [])).toBe(layout)
  })

  it('patches single-page layouts', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [textEl('a', 20), textEl('b', 50)],
    }
    const grown = growOverflowingElementHeights(
      layout,
      [{ elementId: 'a', boxHeight: 20, measuredHeight: 30, delta: 10, elementType: 'TEXT' }],
    )
    expect((grown.elements?.[0] as { height?: number }).height).toBe(32) // 30 + 2pt buffer
    expect((grown.elements?.[1] as { height?: number }).height).toBe(50) // untouched
  })

  it('patches multi-page layouts without mutating input', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      pages: [{ id: 'p1', elements: [textEl('a', 20)] }],
    }
    const original = JSON.stringify(layout)
    const grown = growOverflowingElementHeights(
      layout,
      [{ elementId: 'a', boxHeight: 20, measuredHeight: 30.4, delta: 10.4, elementType: 'TEXT' }],
      /* bufferPt */ 5,
    )
    expect(JSON.stringify(layout)).toBe(original)
    const el = grown.pages?.[0]?.elements?.[0] as { height?: number }
    // Math.ceil(30.4 + 5) = 36
    expect(el.height).toBe(36)
  })
})
