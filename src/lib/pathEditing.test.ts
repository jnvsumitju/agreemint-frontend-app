/**
 * Covers the pure-function layer of the path-edit (vertex editor)
 * feature. UI/pointer integration is exercised in-browser; this file
 * pins down the algorithmic pieces so regressions show up quickly.
 */
import { describe, expect, it } from 'vitest'
import type { LayoutElement, ShapeMultiPolygon } from '../types/layout'
import {
  MIN_RING_POINTS,
  applySnap,
  collectSnapTargets,
  convertElementToMergedShape,
  insertPointInPolys,
  movePointInPolys,
  nearestPointOnRing,
  normalisePolysToLocal,
  removePointFromPolys,
  snapTo45,
  snapToGrid,
} from './pathEditing'

function box(id: string, x: number, y: number, w: number, h: number): LayoutElement {
  return {
    id,
    type: 'BOX',
    x,
    y,
    width: w,
    height: h,
    strokeWidth: 1,
  } as LayoutElement
}

describe('convertElementToMergedShape', () => {
  it('polygonalises a BOX into a MERGED_SHAPE with a local-coord outer ring', () => {
    const el = box('a', 100, 50, 40, 30)
    const out = convertElementToMergedShape(el)
    expect(out).not.toBeNull()
    expect(out!.type).toBe('MERGED_SHAPE')
    expect(out!.x).toBeCloseTo(100, 1)
    expect(out!.y).toBeCloseTo(50, 1)
    // 4-corner rect closed back on itself — the 5th point is a duplicate
    // of the first.
    const ring = out!.shapePolys![0]![0]!
    expect(ring.length).toBeGreaterThanOrEqual(4)
    // All points in local coords (min at 0,0).
    const xs = ring.map(([x]) => x)
    const ys = ring.map(([, y]) => y)
    expect(Math.min(...xs)).toBeCloseTo(0, 1)
    expect(Math.min(...ys)).toBeCloseTo(0, 1)
  })

  it('passes through an existing MERGED_SHAPE unchanged (by value)', () => {
    const polys: ShapeMultiPolygon = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]
    const el: LayoutElement = {
      id: 'm',
      type: 'MERGED_SHAPE',
      x: 5,
      y: 5,
      width: 10,
      height: 10,
      strokeWidth: 2,
      shapePolys: polys,
    } as LayoutElement
    const out = convertElementToMergedShape(el)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('m')
    // Different reference — the helper deep-clones so callers can mutate
    // freely without leaking into the store's frozen state.
    expect(out!.shapePolys).not.toBe(polys)
    expect(out!.shapePolys).toEqual(polys)
  })

  it('returns null for non-mergeable types (TEXT etc.)', () => {
    const txt: LayoutElement = { id: 't', type: 'TEXT', x: 0, y: 0, width: 10, height: 10 } as LayoutElement
    expect(convertElementToMergedShape(txt)).toBeNull()
  })
})

describe('normalisePolysToLocal', () => {
  it('returns zero-offset when already local-origin', () => {
    const polys: ShapeMultiPolygon = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]
    const r = normalisePolysToLocal(polys)
    expect(r.offsetX).toBe(0)
    expect(r.offsetY).toBe(0)
    expect(r.width).toBe(10)
    expect(r.height).toBe(10)
  })

  it('shifts negative / offset points back to origin and reports the delta', () => {
    const polys: ShapeMultiPolygon = [[[[-3, 5], [7, 5], [7, 25], [-3, 25], [-3, 5]]]]
    const r = normalisePolysToLocal(polys)
    expect(r.offsetX).toBe(-3)
    expect(r.offsetY).toBe(5)
    expect(r.width).toBe(10)
    expect(r.height).toBe(20)
    expect(r.polys[0]![0]![0]).toEqual([0, 0])
  })
})

describe('move / insert / remove', () => {
  const polys: ShapeMultiPolygon = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]

  it('movePointInPolys replaces one vertex, input untouched', () => {
    const out = movePointInPolys(polys, { polyIndex: 0, ringIndex: 0, pointIndex: 1 }, 5, 2)
    expect(out[0]![0]![1]).toEqual([5, 2])
    // Original left alone.
    expect(polys[0]![0]![1]).toEqual([10, 0])
  })

  it('insertPointInPolys splices a new vertex after the requested index and returns its ref', () => {
    const r = insertPointInPolys(polys, 0, 0, 0, 5, 0)
    expect(r).not.toBeNull()
    expect(r!.ref).toEqual({ polyIndex: 0, ringIndex: 0, pointIndex: 1 })
    const ring = r!.polys[0]![0]!
    expect(ring[0]).toEqual([0, 0])
    expect(ring[1]).toEqual([5, 0])
    expect(ring[2]).toEqual([10, 0])
  })

  it('removePointFromPolys refuses to drop the ring below MIN_RING_POINTS', () => {
    const small: ShapeMultiPolygon = [[[[0, 0], [10, 0], [10, 10]]]]
    expect(small[0]![0]!.length).toBe(MIN_RING_POINTS)
    const out = removePointFromPolys(small, { polyIndex: 0, ringIndex: 0, pointIndex: 0 })
    expect(out).toBeNull()
  })

  it('removePointFromPolys returns a new tree when the ring stays valid', () => {
    const out = removePointFromPolys(polys, { polyIndex: 0, ringIndex: 0, pointIndex: 1 })
    expect(out).not.toBeNull()
    expect(out![0]![0]!.length).toBe(polys[0]![0]!.length - 1)
  })
})

describe('nearestPointOnRing', () => {
  const ring: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]

  it('lands on the top edge when the cursor is inside the box just below it', () => {
    const hit = nearestPointOnRing(ring, 5, 0.5)
    expect(hit).not.toBeNull()
    expect(hit!.segmentIndex).toBe(0)
    expect(hit!.x).toBeCloseTo(5, 1)
    expect(hit!.y).toBeCloseTo(0, 1)
  })

  it('projects onto the closest edge when the cursor is outside the ring', () => {
    const hit = nearestPointOnRing(ring, -3, 5)
    expect(hit).not.toBeNull()
    // Left edge is the wrap-around segment: ring[3]→ring[0].
    expect(hit!.segmentIndex).toBe(3)
    expect(hit!.x).toBeCloseTo(0, 1)
    expect(hit!.y).toBeCloseTo(5, 1)
  })
})

describe('smart-guide snapping', () => {
  it('snapToGrid rounds to the nearest multiple; disabled when gridSize is 0', () => {
    expect(snapToGrid(17, 23, 10)).toEqual({ x: 20, y: 20 })
    expect(snapToGrid(17, 23, 0)).toEqual({ x: 17, y: 23 })
  })

  it('snapTo45 forces the vector from anchor to the nearest 45° direction', () => {
    const out = snapTo45(10, 2, { x: 0, y: 0 }) // nearly horizontal
    expect(out.y).toBeCloseTo(0, 1)
    expect(out.x).toBeGreaterThan(9)
  })

  it('collectSnapTargets includes sibling-path vertices in world coords', () => {
    const editingEl = { id: 'e', type: 'MERGED_SHAPE', x: 10, y: 20 } as unknown as LayoutElement
    const polys: ShapeMultiPolygon = [[[[0, 0], [4, 0], [4, 4]]]]
    const t = collectSnapTargets({
      editingElement: editingEl,
      editingPolys: polys,
      otherElements: [],
    })
    // world x = local + element.x  → 10, 14, 14
    expect(t.xs.sort()).toEqual([10, 14])
    // world y = local + element.y  → 20, 20, 24
    expect(t.ys.sort()).toEqual([20, 24])
  })

  it('collectSnapTargets excludes the dragging vertex', () => {
    const editingEl = { id: 'e', type: 'MERGED_SHAPE', x: 0, y: 0 } as unknown as LayoutElement
    const polys: ShapeMultiPolygon = [[[[7, 7], [20, 20]]]]
    const t = collectSnapTargets({
      editingElement: editingEl,
      editingPolys: polys,
      excludeRef: { polyIndex: 0, ringIndex: 0, pointIndex: 0 },
      otherElements: [],
    })
    expect(t.xs).not.toContain(7)
    expect(t.xs).toContain(20)
  })

  it('applySnap nudges within the threshold and reports a guide', () => {
    const result = applySnap(102, 53, { xs: [100], ys: [50] }, 3)
    expect(result.x).toBe(100)
    expect(result.y).toBe(50)
    expect(result.guides.length).toBe(2)
  })

  it('applySnap leaves coords alone when nothing is close enough', () => {
    const result = applySnap(102, 53, { xs: [50], ys: [10] }, 3)
    expect(result.x).toBe(102)
    expect(result.y).toBe(53)
    expect(result.guides.length).toBe(0)
  })
})
