/**
 * Pure helpers for the cubic-bezier path data used by the Phase-2 path
 * editor. A bezier ring is a closed list of {@link BezierVertex} — each
 * vertex carries an anchor `p` and optional control-handle offsets
 * `cpIn` / `cpOut` pointing into the incoming / outgoing segments. When
 * both handles on the ends of a segment are absent, the segment is a
 * straight line, identical to the Phase-1 polygon output.
 *
 * Responsibilities split across this file:
 *  - {@link polyToBezier} — upgrade a flat polygon to a corner-only
 *    bezier (no handles) so path-edit state can safely start using the
 *    richer schema.
 *  - {@link flattenBezierPath} — sample the curves back into a plain
 *    {@link ShapeMultiPolygon}. Used (a) to keep `shapePolys` in sync
 *    for the PDF renderer, (b) to feed {@code polygon-clipping} during
 *    Union / Divide.
 *  - {@link bezierPathToSvgPathD} — build the `d` attribute used by the
 *    canvas SVG layer so curves actually render on screen.
 *  - {@link splitBezierAtT} — parametric insert (De Casteljau), so the
 *    "click an edge to insert a vertex" gesture works on curves too.
 *
 * Coordinates throughout are layout-local pt (same space as
 * `shapePolys`). Consumers converting to world space add the element's
 * (x, y) themselves.
 */
import type {
  BezierVertex,
  ShapeBezierMultiPath,
  ShapeBezierRing,
  ShapeMultiPolygon,
  ShapePolygon,
  ShapeRing,
} from '../types/layout'

/**
 * How many line segments to subdivide each cubic bezier into when
 * flattening to polygons. 16 is the visual sweet spot at typical editor
 * zoom levels — fine enough that curves look smooth, coarse enough that
 * boolean ops don't blow up. A lot of tools use between 8 and 32.
 */
export const DEFAULT_BEZIER_FLATTEN_SEGMENTS = 16

/* ────────────────────────────────────────────────────────────────────────
 *  Upgrade: polygon → bezier (all corners, no handles)
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Wrap a plain polygon in the bezier schema with every vertex as a
 * sharp corner. This is the transition point: once a shape has any
 * curves, it flips to `bezierPath` as the source of truth; the old
 * `shapePolys` is kept in sync as the flattened view.
 *
 * Drops the trailing duplicate point some polygon rings carry (a
 * closing "wrap" coordinate) so every bezier vertex is an authored
 * vertex rather than a synthetic closer.
 */
export function polyToBezier(polys: ShapeMultiPolygon): ShapeBezierMultiPath {
  return polys.map((poly) =>
    poly.map((ring) => ringPointsToBezier(ring)),
  )
}

function ringPointsToBezier(ring: ShapeRing): ShapeBezierRing {
  const pts = ring.length > 2 && pairsEqual(ring[0]!, ring[ring.length - 1]!)
    ? ring.slice(0, -1)
    : ring
  return pts.map((pt) => ({ p: [pt[0], pt[1]] }))
}

function pairsEqual(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
}

/* ────────────────────────────────────────────────────────────────────────
 *  Flatten: bezier → polygon (for PDF + boolean ops)
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Sample every curve in `path` into a straight-line polygon approximation.
 * Straight segments (both endpoints corner) pass through with zero
 * extra points. Curved segments get {@code segments} intermediate
 * samples (plus the endpoints themselves).
 */
export function flattenBezierPath(
  path: ShapeBezierMultiPath,
  segments: number = DEFAULT_BEZIER_FLATTEN_SEGMENTS,
): ShapeMultiPolygon {
  const out: ShapeMultiPolygon = []
  for (const bezPoly of path) {
    const poly: ShapePolygon = []
    for (const ring of bezPoly) {
      const flat = flattenBezierRing(ring, segments)
      if (flat.length >= 3) poly.push(flat)
    }
    if (poly.length > 0) out.push(poly)
  }
  return out
}

function flattenBezierRing(ring: ShapeBezierRing, segments: number): ShapeRing {
  if (ring.length < 2) return []
  const out: ShapeRing = []
  for (let i = 0; i < ring.length; i++) {
    const v0 = ring[i]!
    const v1 = ring[(i + 1) % ring.length]!
    // The first anchor is emitted by segment 0; subsequent segments
    // emit only the "inner" samples + the next anchor to avoid doubles.
    if (i === 0) out.push([v0.p[0], v0.p[1]])
    flattenSegmentInto(v0, v1, segments, out)
  }
  // Close the ring by echoing the first point — matches the existing
  // `shapePolys` convention.
  out.push([out[0]![0], out[0]![1]])
  return out
}

/**
 * Sample the cubic segment from `a` to `b` and push points `(1..segments]`
 * (the interior samples plus `b.p` itself) onto `out`. When both handles
 * on the segment endpoints are absent, emits just `b.p` — the straight-
 * line fast path — so non-curved geometry stays exactly as it was.
 */
function flattenSegmentInto(
  a: BezierVertex,
  b: BezierVertex,
  segments: number,
  out: ShapeRing,
): void {
  const aOut = a.cpOut
  const bIn = b.cpIn
  if (!aOut && !bIn) {
    // Straight line — no subdivision needed.
    out.push([b.p[0], b.p[1]])
    return
  }
  // Convert offsets to absolute control points for the cubic formula.
  const p0 = a.p
  const p3 = b.p
  const p1: [number, number] = aOut ? [p0[0] + aOut[0], p0[1] + aOut[1]] : [p0[0], p0[1]]
  const p2: [number, number] = bIn ? [p3[0] + bIn[0], p3[1] + bIn[1]] : [p3[0], p3[1]]
  for (let s = 1; s <= segments; s++) {
    const t = s / segments
    out.push(cubicPoint(p0, p1, p2, p3, t))
  }
}

/** Evaluate a cubic bezier at parameter `t ∈ [0, 1]`. */
export function cubicPoint(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const mt = 1 - t
  const b0 = mt * mt * mt
  const b1 = 3 * mt * mt * t
  const b2 = 3 * mt * t * t
  const b3 = t * t * t
  return [
    b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
    b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1],
  ]
}

/* ────────────────────────────────────────────────────────────────────────
 *  SVG `d` attribute: bezier → path string
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Build an SVG path `d` string for a whole bezier multi-path (one
 * subpath per ring, even-odd fill rule matching the existing MERGED_SHAPE
 * renderer).
 */
export function bezierPathToSvgPathD(path: ShapeBezierMultiPath): string {
  return path
    .flatMap((poly) => poly.map((ring) => bezierRingToSubpath(ring)))
    .filter(Boolean)
    .join(' ')
}

export function bezierRingToSubpath(ring: ShapeBezierRing): string {
  if (ring.length < 2) return ''
  let d = `M ${ring[0]!.p[0]} ${ring[0]!.p[1]}`
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    d += ' ' + segmentToSvg(a, b)
  }
  return `${d} Z`
}

function segmentToSvg(a: BezierVertex, b: BezierVertex): string {
  if (!a.cpOut && !b.cpIn) {
    return `L ${b.p[0]} ${b.p[1]}`
  }
  const c1x = a.p[0] + (a.cpOut?.[0] ?? 0)
  const c1y = a.p[1] + (a.cpOut?.[1] ?? 0)
  const c2x = b.p[0] + (b.cpIn?.[0] ?? 0)
  const c2y = b.p[1] + (b.cpIn?.[1] ?? 0)
  return `C ${c1x} ${c1y} ${c2x} ${c2y} ${b.p[0]} ${b.p[1]}`
}

/* ────────────────────────────────────────────────────────────────────────
 *  Parametric split — for "click a curve to insert a vertex"
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Split the segment between `a` and `b` at parameter `t ∈ (0, 1)` using
 * De Casteljau's algorithm. Returns three things:
 *  - an adjusted `a` (its `cpOut` shortens so the pre-split curve is
 *    unchanged up to the split point),
 *  - the new midpoint vertex (smooth; handles face both sides),
 *  - an adjusted `b` (its `cpIn` shortens likewise).
 *
 * Caller splices these three back into the ring so the on-canvas curve
 * stays visually identical while gaining one new authorial vertex.
 * Works for straight segments too — the new vertex comes out with no
 * handles and the neighbours are unchanged.
 */
export function splitBezierAtT(
  a: BezierVertex,
  b: BezierVertex,
  t: number,
): { a: BezierVertex; mid: BezierVertex; b: BezierVertex } {
  const aOut = a.cpOut
  const bIn = b.cpIn
  if (!aOut && !bIn) {
    // Straight segment — just linearly interpolate.
    const mx = a.p[0] + (b.p[0] - a.p[0]) * t
    const my = a.p[1] + (b.p[1] - a.p[1]) * t
    return {
      a: { ...a },
      mid: { p: [mx, my] },
      b: { ...b },
    }
  }
  // Absolute control points.
  const p0 = a.p
  const p3 = b.p
  const p1: [number, number] = aOut ? [p0[0] + aOut[0], p0[1] + aOut[1]] : [p0[0], p0[1]]
  const p2: [number, number] = bIn ? [p3[0] + bIn[0], p3[1] + bIn[1]] : [p3[0], p3[1]]

  // De Casteljau intermediates.
  const q0 = lerp(p0, p1, t)
  const q1 = lerp(p1, p2, t)
  const q2 = lerp(p2, p3, t)
  const r0 = lerp(q0, q1, t)
  const r1 = lerp(q1, q2, t)
  const m = lerp(r0, r1, t)

  // Shortened control points express the two sub-curves:
  //   a → q0 → r0 → m
  //   m → r1 → q2 → b
  const newA: BezierVertex = {
    ...a,
    cpOut: [q0[0] - p0[0], q0[1] - p0[1]],
  }
  const newB: BezierVertex = {
    ...b,
    cpIn: [q2[0] - p3[0], q2[1] - p3[1]],
  }
  const mid: BezierVertex = {
    p: [m[0], m[1]],
    cpIn: [r0[0] - m[0], r0[1] - m[1]],
    cpOut: [r1[0] - m[0], r1[1] - m[1]],
    smooth: true,
  }
  return { a: newA, mid, b: newB }
}

function lerp(
  a: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/* ────────────────────────────────────────────────────────────────────────
 *  Vertex ops — keep smooth invariants tidy
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Evaluate a single segment of a bezier ring at parameter `t`. Straight
 * segments (no handles) take the linear fast path; curved segments use
 * the cubic formula. Exported so the overlay can project cursors onto
 * curves for the click-to-insert gesture.
 */
export function evalBezierSegment(
  a: BezierVertex,
  b: BezierVertex,
  t: number,
): [number, number] {
  const aOut = a.cpOut
  const bIn = b.cpIn
  if (!aOut && !bIn) {
    return [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t]
  }
  const p0 = a.p
  const p3 = b.p
  const p1: [number, number] = aOut ? [p0[0] + aOut[0], p0[1] + aOut[1]] : p0
  const p2: [number, number] = bIn ? [p3[0] + bIn[0], p3[1] + bIn[1]] : p3
  return cubicPoint(p0, p1, p2, p3, t)
}

/**
 * Find the nearest point on a bezier ring to `(px, py)` by sampling each
 * segment at `samplesPerSegment + 1` parameter values. Returns the
 * world-space projection plus the segment index + the parameter
 * {@code t ∈ (0.01, 0.99)} — clamped away from the endpoints so the
 * {@link splitBezierAtT} caller always gets a non-degenerate split.
 */
export function nearestPointOnBezierRing(
  ring: ShapeBezierRing,
  px: number,
  py: number,
  samplesPerSegment: number = 16,
): { x: number; y: number; segmentIndex: number; t: number; distance: number } | null {
  if (ring.length < 2) return null
  let best: { x: number; y: number; segmentIndex: number; t: number; distance: number } | null = null
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    for (let s = 1; s < samplesPerSegment; s++) {
      // Skip the exact endpoints — those are already vertices, no need
      // to insert there.
      const t = s / samplesPerSegment
      const pt = evalBezierSegment(a, b, t)
      const d = Math.hypot(px - pt[0], py - pt[1])
      if (!best || d < best.distance) {
        best = { x: pt[0], y: pt[1], segmentIndex: i, t, distance: d }
      }
    }
  }
  if (!best) return null
  // Clamp t away from the endpoints for numerical safety when splitting.
  const clampedT = Math.max(0.02, Math.min(0.98, best.t))
  return { ...best, t: clampedT }
}

/**
 * Translate the anchor of a vertex. When the vertex is marked
 * `smooth`, its control handles slide with the anchor so the
 * surrounding curve tangent stays intact (handles are stored as offsets,
 * so they already follow the anchor — this helper is a no-op on the
 * offsets but preserved for API symmetry with {@link moveBezierHandle}).
 */
export function moveBezierAnchor(
  v: BezierVertex,
  x: number,
  y: number,
): BezierVertex {
  return { ...v, p: [x, y] }
}

/**
 * Update one of the vertex's control handles. When `side === 'out'`
 * and the vertex is smooth, the opposite handle mirrors through the
 * anchor so the segment stays tangent-continuous.
 */
export function setBezierHandle(
  v: BezierVertex,
  side: 'in' | 'out',
  offset: [number, number] | undefined,
  mirrorWhenSmooth: boolean = true,
): BezierVertex {
  const next: BezierVertex = { ...v }
  if (side === 'in') next.cpIn = offset ? [offset[0], offset[1]] : undefined
  else next.cpOut = offset ? [offset[0], offset[1]] : undefined

  if (mirrorWhenSmooth && next.smooth && offset) {
    // Mirror across anchor so |cpIn| == |cpOut| and they're collinear.
    const mirrored: [number, number] = [-offset[0], -offset[1]]
    if (side === 'in') next.cpOut = mirrored
    else next.cpIn = mirrored
  }
  return next
}

/**
 * Flip a vertex between corner (no handles) and smooth (mirrored
 * zero-length handles so the user has something to grab). Pulling the
 * handles out to a non-zero size happens separately via
 * {@link setBezierHandle} with {@code mirrorWhenSmooth=true}.
 */
export function toggleBezierSmooth(v: BezierVertex): BezierVertex {
  if (v.smooth) {
    // Smooth → corner: drop all handles + flag.
    return { p: [v.p[0], v.p[1]] }
  }
  return {
    p: [v.p[0], v.p[1]],
    smooth: true,
    cpIn: [0, 0],
    cpOut: [0, 0],
  }
}

/**
 * Deep-clone the bezier multi-path so store mutations never leak back
 * into the frozen tree held by Zustand.
 */
export function cloneBezierPath(path: ShapeBezierMultiPath): ShapeBezierMultiPath {
  return path.map((poly) =>
    poly.map((ring) =>
      ring.map((v) => ({
        p: [v.p[0], v.p[1]] as [number, number],
        ...(v.cpIn ? { cpIn: [v.cpIn[0], v.cpIn[1]] as [number, number] } : {}),
        ...(v.cpOut ? { cpOut: [v.cpOut[0], v.cpOut[1]] as [number, number] } : {}),
        ...(v.smooth ? { smooth: true } : {}),
      })),
    ),
  )
}

/** Re-home a bezier multi-path to the origin. Mirrors
 *  {@link normalisePolysToLocal} in shape — returns the bbox delta + the
 *  shifted path so the caller can reconcile the element's world x/y. */
export function normaliseBezierToLocal(path: ShapeBezierMultiPath): {
  path: ShapeBezierMultiPath
  offsetX: number
  offsetY: number
  width: number
  height: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  // For bounds we need to see both anchors and their absolute control
  // points — a curve can bulge outside its anchor bbox.
  for (const poly of path) {
    for (const ring of poly) {
      for (const v of ring) {
        minX = Math.min(minX, v.p[0])
        minY = Math.min(minY, v.p[1])
        maxX = Math.max(maxX, v.p[0])
        maxY = Math.max(maxY, v.p[1])
        if (v.cpIn) {
          const ax = v.p[0] + v.cpIn[0]
          const ay = v.p[1] + v.cpIn[1]
          minX = Math.min(minX, ax)
          minY = Math.min(minY, ay)
          maxX = Math.max(maxX, ax)
          maxY = Math.max(maxY, ay)
        }
        if (v.cpOut) {
          const ax = v.p[0] + v.cpOut[0]
          const ay = v.p[1] + v.cpOut[1]
          minX = Math.min(minX, ax)
          minY = Math.min(minY, ay)
          maxX = Math.max(maxX, ax)
          maxY = Math.max(maxY, ay)
        }
      }
    }
  }
  if (!Number.isFinite(minX)) {
    return { path, offsetX: 0, offsetY: 0, width: 1, height: 1 }
  }
  const shifted: ShapeBezierMultiPath = path.map((poly) =>
    poly.map((ring) =>
      ring.map((v) => ({
        p: [v.p[0] - minX, v.p[1] - minY] as [number, number],
        ...(v.cpIn ? { cpIn: [v.cpIn[0], v.cpIn[1]] as [number, number] } : {}),
        ...(v.cpOut ? { cpOut: [v.cpOut[0], v.cpOut[1]] as [number, number] } : {}),
        ...(v.smooth ? { smooth: true } : {}),
      })),
    ),
  )
  return {
    path: shifted,
    offsetX: minX,
    offsetY: minY,
    width: Math.max(1, Math.ceil(maxX - minX)),
    height: Math.max(1, Math.ceil(maxY - minY)),
  }
}

