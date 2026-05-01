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
  it('flags text elements whose measured height exceeds the box', () => {
    const layout: LayoutJson = {
      page: { size: 'A4', margin: 36 },
      elements: [textEl('a', 20), textEl('b', 50)],
    }
    const ms = measurements({ a: 30, b: 40 })  // a overflows by 10pt; b fits
    const overflows = findOverflowingElements(layout, ms)
    expect(overflows).toHaveLength(1)
    expect(overflows[0]?.elementId).toBe('a')
    expect(overflows[0]?.delta).toBeCloseTo(10)
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
    const ms = measurements({ 'p1-a': 30, 'p2-a': 12, 'p2-b': 80 })
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
