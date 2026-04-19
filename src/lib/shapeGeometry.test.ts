/**
 * Covers the boolean geometry ops that back the LeftPalette Union + Divide
 * buttons. We assert on:
 *  - selection gating (canDivideSelection / canUnionSelection)
 *  - Divide fragment counts (overlap, disjoint, Venn 3-circle)
 *  - Divide style inheritance (topmost contributor wins)
 *  - Union output bounding box
 *
 * Geometry is driven through `polygon-clipping` under the hood, so we give
 * the tests a bit of slack on exact piece counts (curves are polygonalised,
 * which can collapse vanishingly thin regions).
 */
import { describe, expect, it } from 'vitest'
import type { LayoutElement } from '../types/layout'
import {
  canDivideSelection,
  canUnionSelection,
  divideLayoutShapeElements,
  mergeLayoutShapeElements,
  scaleMergedShape,
} from './shapeGeometry'

function box(id: string, x: number, y: number, w: number, h: number, extra: Partial<LayoutElement> = {}): LayoutElement {
  return {
    id,
    type: 'BOX',
    x,
    y,
    width: w,
    height: h,
    strokeWidth: 1,
    ...extra,
  } as LayoutElement
}

describe('canDivideSelection / canUnionSelection', () => {
  it('rejects fewer than two selected', () => {
    const a = box('a', 0, 0, 100, 100)
    expect(canDivideSelection({ selectedIds: ['a'], elements: [a] })).toBe(false)
    expect(canUnionSelection({ selectedIds: [], elements: [a] })).toBe(false)
  })

  it('rejects locked shapes', () => {
    const a = box('a', 0, 0, 100, 100, { locked: true })
    const b = box('b', 50, 50, 100, 100)
    expect(canDivideSelection({ selectedIds: ['a', 'b'], elements: [a, b] })).toBe(false)
  })

  it('rejects non-mergeable types', () => {
    const a = box('a', 0, 0, 100, 100)
    const txt: LayoutElement = { id: 'b', type: 'TEXT', x: 10, y: 10, width: 50, height: 30 } as LayoutElement
    expect(canDivideSelection({ selectedIds: ['a', 'b'], elements: [a, txt] })).toBe(false)
  })

  it('accepts two overlapping mergeable shapes', () => {
    const a = box('a', 0, 0, 100, 100)
    const b = box('b', 50, 50, 100, 100)
    expect(canDivideSelection({ selectedIds: ['a', 'b'], elements: [a, b] })).toBe(true)
    expect(canUnionSelection({ selectedIds: ['a', 'b'], elements: [a, b] })).toBe(true)
  })
})

describe('divideLayoutShapeElements', () => {
  it('returns null for fewer than two inputs', () => {
    const a = box('a', 0, 0, 100, 100)
    expect(divideLayoutShapeElements([a])).toBeNull()
  })

  it('two overlapping boxes → three regions (A-only, B-only, A∩B)', () => {
    const a = box('a', 0, 0, 100, 100)
    const b = box('b', 50, 50, 100, 100)
    const regions = divideLayoutShapeElements([a, b])
    expect(regions).not.toBeNull()
    expect(regions!.length).toBe(3)
  })

  it('two disjoint boxes → two regions (each untouched)', () => {
    const a = box('a', 0, 0, 50, 50)
    const b = box('b', 100, 100, 50, 50)
    const regions = divideLayoutShapeElements([a, b])
    expect(regions).not.toBeNull()
    expect(regions!.length).toBe(2)
  })

  it('three circles in a Venn arrangement → up to seven regions', () => {
    // Three ellipses overlapping pairwise around a common centre.
    const a: LayoutElement = { id: 'a', type: 'ELLIPSE', x: 0, y: 0, width: 120, height: 120, strokeWidth: 1 } as LayoutElement
    const b: LayoutElement = { id: 'b', type: 'ELLIPSE', x: 60, y: 0, width: 120, height: 120, strokeWidth: 1 } as LayoutElement
    const c: LayoutElement = { id: 'c', type: 'ELLIPSE', x: 30, y: 60, width: 120, height: 120, strokeWidth: 1 } as LayoutElement
    const regions = divideLayoutShapeElements([a, b, c])
    expect(regions).not.toBeNull()
    // Full Venn yields 7; we allow 6-7 because polygonalised ellipses can
    // make the tiniest corner region collapse below the positive-area
    // threshold. Anything less would indicate a bug.
    expect(regions!.length).toBeGreaterThanOrEqual(6)
    expect(regions!.length).toBeLessThanOrEqual(7)
  })

  it('assigns topmost (last-in-list) style to the shared overlap region', () => {
    const bottom = box('bottom', 0, 0, 100, 100, {
      style: { color: '#111111', backgroundColor: '#ffdd00' },
    } as Partial<LayoutElement>)
    const top = box('top', 50, 50, 100, 100, {
      style: { color: '#ff0000', backgroundColor: '#00ff00' },
    } as Partial<LayoutElement>)
    const regions = divideLayoutShapeElements([bottom, top])!
    // The overlap region is the smallest by area. Its style should come
    // from `top` since top is later in the list → topmost z-order.
    const overlap = regions.reduce((min, r) =>
      r.width * r.height < min.width * min.height ? r : min,
    )
    expect(overlap.sourceEl.id).toBe('top')
    expect(overlap.color).toBe('#ff0000')
    expect(overlap.backgroundColor).toBe('#00ff00')
  })

  it('rejects more than six inputs (runaway guard)', () => {
    const els = Array.from({ length: 7 }, (_, i) => box(`b${i}`, i * 10, 0, 100, 100))
    expect(divideLayoutShapeElements(els)).toBeNull()
  })
})

describe('mergeLayoutShapeElements (Union)', () => {
  it('returns null for fewer than two inputs', () => {
    const a = box('a', 0, 0, 100, 100)
    expect(mergeLayoutShapeElements([a])).toBeNull()
  })

  it('bounding box of union spans both inputs', () => {
    const a = box('a', 0, 0, 100, 100)
    const b = box('b', 50, 50, 100, 100)
    const merged = mergeLayoutShapeElements([a, b])!
    expect(merged.x).toBeCloseTo(0, 1)
    expect(merged.y).toBeCloseTo(0, 1)
    // Union extends to 150x150 (right + bottom corner of b).
    expect(merged.x + merged.width).toBeGreaterThanOrEqual(149)
    expect(merged.y + merged.height).toBeGreaterThanOrEqual(149)
  })

  it('disjoint inputs still yield a multi-polygon result', () => {
    const a = box('a', 0, 0, 50, 50)
    const b = box('b', 200, 200, 50, 50)
    const merged = mergeLayoutShapeElements([a, b])!
    // Two disconnected outlines in one MultiPolygon.
    expect(merged.shapePolys.length).toBe(2)
  })

  it('takes colour from the topmost contributor that declares one', () => {
    const bottom = box('bottom', 0, 0, 100, 100, {
      style: { color: '#222222' },
    } as Partial<LayoutElement>)
    const top = box('top', 50, 50, 100, 100, {
      style: { color: '#ff00ff' },
    } as Partial<LayoutElement>)
    const merged = mergeLayoutShapeElements([bottom, top])!
    expect(merged.color).toBe('#ff00ff')
  })

  it('falls back to a lower contributor when the top has no colour', () => {
    const bottom = box('bottom', 0, 0, 100, 100, {
      style: { color: '#abcdef' },
    } as Partial<LayoutElement>)
    const top = box('top', 50, 50, 100, 100)
    const merged = mergeLayoutShapeElements([bottom, top])!
    expect(merged.color).toBe('#abcdef')
  })

  it('scaleMergedShape stretches shapePolys + bezierPath vertices in lock-step with the bbox', () => {
    const el: LayoutElement = {
      id: 'm',
      type: 'MERGED_SHAPE',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      strokeWidth: 1,
      shapePolys: [[[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]]]],
      bezierPath: [
        [
          [
            { p: [0, 0], cpOut: [50, 0] },
            { p: [100, 0], cpIn: [-50, 0] },
          ],
        ],
      ],
    } as LayoutElement
    const scaled = scaleMergedShape(el, 200, 200) // 2× width, 4× height
    expect(scaled.width).toBe(200)
    expect(scaled.height).toBe(200)
    // Polygon: every point multiplied by (2, 4).
    expect(scaled.shapePolys![0]![0]![2]).toEqual([200, 200])
    // Bezier: anchors + handles both scaled.
    expect(scaled.bezierPath![0]![0]![0]!.cpOut).toEqual([100, 0])
    expect(scaled.bezierPath![0]![0]![1]!.p).toEqual([200, 0])
    expect(scaled.bezierPath![0]![0]![1]!.cpIn).toEqual([-100, 0])
    // x / y stay put — resize is anchor-from-top-left.
    expect(scaled.x).toBe(10)
    expect(scaled.y).toBe(10)
  })

  it('honours style.rotation — rotated inputs produce a rotated polygon, not axis-aligned', () => {
    // A 100×100 square at (0, 0) rotated 45° around its centre (50, 50)
    // has its top-left corner at world (50, 50 - 50*√2). If rotation were
    // dropped, the bbox would still be 100×100 starting at (0, 0). With
    // rotation honoured, the bbox grows to ~141×141 and the corners sit
    // at the cardinal directions of the original centre.
    const rotated = box('r', 0, 0, 100, 100, {
      style: { rotation: 45 },
    } as Partial<LayoutElement>)
    const nonRotated = box('n', 200, 0, 20, 20) // disjoint, so Divide is a no-op union
    const merged = mergeLayoutShapeElements([rotated, nonRotated])!
    // Disjoint inputs: two polygons in the multi-polygon.
    expect(merged.shapePolys.length).toBe(2)
    // The rotated square's bounding box is ≈141 × 141 (100 × √2 ≈ 141.42).
    // We look at the local polys — the first poly should span > 130 pt
    // in each axis, which is impossible for an axis-aligned 100×100.
    const firstPoly = merged.shapePolys[0]!
    const firstRing = firstPoly[0]!
    const xs = firstRing.map((p) => p[0])
    const ys = firstRing.map((p) => p[1])
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    expect(w).toBeGreaterThan(130)
    expect(h).toBeGreaterThan(130)
  })
})
