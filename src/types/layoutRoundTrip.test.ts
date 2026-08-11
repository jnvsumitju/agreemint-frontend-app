import { describe, expect, it } from 'vitest'
import {
  elementToJson,
  jsonToElement,
  type LayoutElement,
  type ShapeBezierMultiPath,
  type ShapeMultiPolygon,
} from './layout'

/**
 * Round-trip cover for `elementToJson` → `jsonToElement`.
 *
 * <p>Written because `bezierPath` was readable but not writable: the parser
 * accepted it, `elementToJson` never emitted it, and so every save quietly
 * replaced a curved shape with its flattened polygon. On reload the handles
 * were gone. Nothing failed, nothing logged — the shape just became slightly
 * wrong, permanently.
 *
 * <p>The general lesson is that a serializer and its parser have to be tested
 * as a pair. Either half in isolation looks correct here.
 */

/** A quarter-circle-ish closed ring: one curved corner, one square corner. */
const CURVE: ShapeBezierMultiPath = [
  [
    [
      { p: [0, 0], cpOut: [10, 0], smooth: true },
      { p: [40, 40], cpIn: [0, -10], cpOut: [0, 10], smooth: true },
      { p: [0, 80] },
    ],
  ],
]

/**
 * The same outline flattened to polygons: one polygon, one ring, three points.
 * Annotated because a bare literal widens to `number[][][]` — ShapeMultiPolygon
 * nests polygons → rings → `[number, number]` points.
 */
const POLYS: ShapeMultiPolygon = [[[[0, 0], [40, 40], [0, 80]]]]

function mergedShape(overrides: Partial<LayoutElement> = {}): LayoutElement {
  return {
    id: 'el-1',
    type: 'MERGED_SHAPE',
    x: 10,
    y: 20,
    width: 100,
    height: 200,
    ...overrides,
  } as LayoutElement
}

describe('elementToJson / jsonToElement round trip', () => {
  it('preserves bezierPath — the curve survives a save', () => {
    const el = mergedShape({ bezierPath: CURVE, shapePolys: POLYS })

    const round = jsonToElement(elementToJson(el) as Record<string, unknown>)

    expect(round.bezierPath).toEqual(CURVE)
  })

  it('keeps control handles and the smooth flag on every vertex', () => {
    // The bug degraded curves to corners; asserting only that bezierPath is
    // non-empty would pass on a path whose handles had been stripped.
    const round = jsonToElement(
      elementToJson(mergedShape({ bezierPath: CURVE })) as Record<string, unknown>,
    )
    const ring = round.bezierPath?.[0]?.[0]

    expect(ring).toHaveLength(3)
    expect(ring?.[0].cpOut).toEqual([10, 0])
    expect(ring?.[0].smooth).toBe(true)
    expect(ring?.[1].cpIn).toEqual([0, -10])
    expect(ring?.[1].cpOut).toEqual([0, 10])
    // A plain corner keeps no handles rather than gaining zero-length ones.
    expect(ring?.[2].cpIn).toBeUndefined()
    expect(ring?.[2].cpOut).toBeUndefined()
  })

  it('still emits shapePolys, which the PDF renderer reads', () => {
    // bezierPath is additive. The Java renderer only understands shapePolys, so
    // dropping it in favour of curves would blank the shape in generated PDFs.
    const json = elementToJson(mergedShape({ bezierPath: CURVE, shapePolys: POLYS })) as Record<
      string,
      unknown
    >

    expect(json.shapePolys).toEqual(POLYS)
    expect(json.bezierPath).toEqual(CURVE)
  })

  it('omits bezierPath entirely for a shape that has no curves', () => {
    // A plain polygon shape: no curves were ever drawn on it.
    const json = elementToJson(mergedShape({ shapePolys: POLYS })) as Record<string, unknown>

    expect('bezierPath' in json).toBe(false)
  })

  it('omits an empty bezierPath rather than writing []', () => {
    const json = elementToJson(mergedShape({ bezierPath: [] })) as Record<string, unknown>

    expect('bezierPath' in json).toBe(false)
  })

  it('survives two round trips unchanged — saves are idempotent', () => {
    // Reload-then-save is the common path; a lossy step would show up here as
    // drift between the first and second pass.
    const once = jsonToElement(
      elementToJson(mergedShape({ bezierPath: CURVE })) as Record<string, unknown>,
    )
    const twice = jsonToElement(elementToJson(once) as Record<string, unknown>)

    expect(twice.bezierPath).toEqual(once.bezierPath)
    expect(twice.bezierPath).toEqual(CURVE)
  })
})
