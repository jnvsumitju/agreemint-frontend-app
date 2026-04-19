/**
 * Covers the cubic-bezier helpers that underpin Phase-2 path editing:
 * flatten, split-on-t, polyToBezier, smooth toggles, handle mirroring,
 * bbox normalisation, nearest-point projection, SVG path generation.
 */
import { describe, expect, it } from 'vitest'
import type { BezierVertex, ShapeBezierMultiPath, ShapeMultiPolygon } from '../types/layout'
import {
  bezierPathToSvgPathD,
  cloneBezierPath,
  cubicPoint,
  evalBezierSegment,
  flattenBezierPath,
  nearestPointOnBezierRing,
  normaliseBezierToLocal,
  polyToBezier,
  setBezierHandle,
  splitBezierAtT,
  toggleBezierSmooth,
} from './bezierGeometry'

describe('polyToBezier', () => {
  it('produces one corner-only vertex per polygon point', () => {
    const polys: ShapeMultiPolygon = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]
    const bez = polyToBezier(polys)
    expect(bez.length).toBe(1)
    expect(bez[0]!.length).toBe(1) // one ring
    expect(bez[0]![0]!.length).toBe(4) // trailing wrap-around dropped
    // All corners — no handles, no smooth flag.
    for (const v of bez[0]![0]!) {
      expect(v.cpIn).toBeUndefined()
      expect(v.cpOut).toBeUndefined()
      expect(v.smooth).toBeUndefined()
    }
  })
})

describe('flattenBezierPath', () => {
  it('passes straight segments through unchanged', () => {
    const bez: ShapeBezierMultiPath = [
      [[
        { p: [0, 0] },
        { p: [10, 0] },
        { p: [10, 10] },
      ]],
    ]
    const flat = flattenBezierPath(bez)
    // Three segments (0→1, 1→2, 2→0 wrap) each contribute their "next"
    // anchor once — three anchors total plus the closing dup = 5.
    expect(flat[0]![0]!.length).toBe(5)
    expect(flat[0]![0]![0]).toEqual([0, 0])
    expect(flat[0]![0]![1]).toEqual([10, 0])
    expect(flat[0]![0]![2]).toEqual([10, 10])
    // Last two points: wrap-around back to the first anchor + closing dup.
    expect(flat[0]![0]![3]).toEqual([0, 0])
    expect(flat[0]![0]![4]).toEqual([0, 0])
  })

  it('subdivides curved segments into samples', () => {
    const bez: ShapeBezierMultiPath = [
      [[
        { p: [0, 0], cpOut: [5, 10] },
        { p: [10, 0], cpIn: [-5, 10] },
      ]],
    ]
    // Two-vertex ring with a curved segment 0→1 and a straight segment 1→0.
    const flat = flattenBezierPath(bez, 4)
    // 1 (anchor 0) + 4 (samples on curve 0→1 incl. anchor 1) +
    // 1 (straight 1→0 target = anchor 0 again) + 1 (closing).
    // Our ring is { 0, 1 }; we flatten seg 0→1 in 4 steps (4 samples)
    // and seg 1→0 straight (1 sample). So total = 1 + 4 + 1 + 1 = 7.
    expect(flat[0]![0]!.length).toBe(7)
    const mid = flat[0]![0]![2]!
    // Symmetric curve — midpoint x is halfway between anchors.
    expect(mid[0]).toBeCloseTo(5, 1)
    expect(mid[1]).toBeGreaterThan(1)
  })
})

describe('bezierPathToSvgPathD', () => {
  it('emits L for straight segments and C for curved', () => {
    // Three vertices: v0 corner, v1 with cpIn only, v2 with cpOut only.
    //   seg 0→1: curve (v1.cpIn applies)
    //   seg 1→2: straight (neither endpoint has a handle facing that segment)
    //   seg 2→0: curve (v2.cpOut applies)
    const bez: ShapeBezierMultiPath = [
      [[
        { p: [0, 0] },
        { p: [10, 0], cpIn: [-2, 0] },
        { p: [10, 10], cpOut: [0, 2] },
      ]],
    ]
    const d = bezierPathToSvgPathD(bez)
    expect(d.startsWith('M 0 0')).toBe(true)
    // Both curved segments show up as cubic-bezier `C` commands.
    expect(d.match(/C /g)?.length).toBe(2)
    // The middle segment is the only straight one.
    expect(d).toMatch(/L 10 10/)
    // Path closes back to origin.
    expect(d).toMatch(/Z$/)
  })
})

describe('splitBezierAtT', () => {
  it('straight midpoint', () => {
    const a: BezierVertex = { p: [0, 0] }
    const b: BezierVertex = { p: [10, 0] }
    const split = splitBezierAtT(a, b, 0.5)
    expect(split.mid.p).toEqual([5, 0])
    expect(split.a).toEqual(a)
    expect(split.b).toEqual(b)
    expect(split.mid.cpIn).toBeUndefined()
    expect(split.mid.cpOut).toBeUndefined()
  })

  it('curved split preserves shape (sample on either side lands on original)', () => {
    const a: BezierVertex = { p: [0, 0], cpOut: [5, 0] }
    const b: BezierVertex = { p: [10, 10], cpIn: [0, -5] }
    const original = evalBezierSegment(a, b, 0.25)
    const split = splitBezierAtT(a, b, 0.5)
    // Sample the first half of the split at t=0.5 → maps to original t=0.25.
    const firstHalf = evalBezierSegment(split.a, split.mid, 0.5)
    expect(firstHalf[0]).toBeCloseTo(original[0], 1)
    expect(firstHalf[1]).toBeCloseTo(original[1], 1)
    // New mid vertex gets handles on both sides + smooth flag.
    expect(split.mid.cpIn).toBeDefined()
    expect(split.mid.cpOut).toBeDefined()
    expect(split.mid.smooth).toBe(true)
  })
})

describe('toggleBezierSmooth', () => {
  it('corner → smooth adds zero-length handles + flag', () => {
    const corner: BezierVertex = { p: [5, 5] }
    const smooth = toggleBezierSmooth(corner)
    expect(smooth.smooth).toBe(true)
    expect(smooth.cpIn).toEqual([0, 0])
    expect(smooth.cpOut).toEqual([0, 0])
  })

  it('smooth → corner drops all handles', () => {
    const smooth: BezierVertex = {
      p: [5, 5],
      cpIn: [-2, 0],
      cpOut: [2, 0],
      smooth: true,
    }
    const corner = toggleBezierSmooth(smooth)
    expect(corner.smooth).toBeUndefined()
    expect(corner.cpIn).toBeUndefined()
    expect(corner.cpOut).toBeUndefined()
  })
})

describe('setBezierHandle', () => {
  it('mirrors the opposite handle when vertex is smooth', () => {
    const v: BezierVertex = { p: [0, 0], smooth: true, cpIn: [0, 0], cpOut: [0, 0] }
    const updated = setBezierHandle(v, 'out', [3, 4], true)
    expect(updated.cpOut).toEqual([3, 4])
    expect(updated.cpIn).toEqual([-3, -4])
  })

  it('leaves the opposite handle alone when smooth is false', () => {
    const v: BezierVertex = { p: [0, 0], cpIn: [-1, -1], cpOut: [1, 1] }
    const updated = setBezierHandle(v, 'out', [5, 0], true)
    expect(updated.cpOut).toEqual([5, 0])
    expect(updated.cpIn).toEqual([-1, -1])
  })

  it('clearing a handle (undefined offset) deletes it', () => {
    const v: BezierVertex = { p: [0, 0], cpIn: [-1, 0], cpOut: [1, 0] }
    const updated = setBezierHandle(v, 'in', undefined, false)
    expect(updated.cpIn).toBeUndefined()
    expect(updated.cpOut).toEqual([1, 0])
  })
})

describe('normaliseBezierToLocal', () => {
  it('re-homes the path so min anchor + min handle endpoint lands at (0, 0)', () => {
    const bez: ShapeBezierMultiPath = [
      [[
        { p: [10, 20], cpOut: [-15, 0] }, // extends left of the anchor
        { p: [40, 20] },
      ]],
    ]
    const r = normaliseBezierToLocal(bez)
    // The leftmost point is anchor 0 + cpOut = (10 + -15, 20) = (-5, 20).
    expect(r.offsetX).toBe(-5)
    expect(r.offsetY).toBe(20)
    expect(r.width).toBeGreaterThanOrEqual(45)
  })
})

describe('nearestPointOnBezierRing', () => {
  it('returns a segment + t clamped into (0.02, 0.98)', () => {
    const ring: BezierVertex[] = [
      { p: [0, 0] },
      { p: [100, 0], cpIn: [-30, 50] },
      { p: [100, 100] },
      { p: [0, 100] },
    ]
    const hit = nearestPointOnBezierRing(ring, 50, -5)!
    expect(hit).not.toBeNull()
    expect(hit.segmentIndex).toBe(0)
    expect(hit.t).toBeGreaterThanOrEqual(0.02)
    expect(hit.t).toBeLessThanOrEqual(0.98)
  })
})

describe('cloneBezierPath', () => {
  it('deep copies — mutating the clone leaves the original untouched', () => {
    const bez: ShapeBezierMultiPath = [
      [[
        { p: [0, 0], cpOut: [5, 5] },
        { p: [10, 0] },
      ]],
    ]
    const cloned = cloneBezierPath(bez)
    cloned[0]![0]![0]!.p[0] = 99
    cloned[0]![0]![0]!.cpOut![0] = 88
    expect(bez[0]![0]![0]!.p[0]).toBe(0)
    expect(bez[0]![0]![0]!.cpOut![0]).toBe(5)
  })
})

describe('cubicPoint', () => {
  it('at t=0 returns p0, at t=1 returns p3', () => {
    expect(cubicPoint([0, 0], [3, 3], [7, 7], [10, 10], 0)).toEqual([0, 0])
    expect(cubicPoint([0, 0], [3, 3], [7, 7], [10, 10], 1)).toEqual([10, 10])
  })
})
