/**
 * Geometry + snapping helpers for the per-element path-edit mode (the
 * "node editor"). Everything here works on the MERGED_SHAPE-style polygon
 * data model — a {@link ShapeMultiPolygon} with outer rings and optional
 * holes. UI chrome lives in {@link PathEditOverlay}; interaction wiring
 * lives in {@code editorStore}; this file is pure functions so the logic
 * can be unit-tested end-to-end.
 *
 * Storage shape reminder:
 *   shapePolys: [
 *     [                           // polygon #0
 *       [[x,y], [x,y], ...],      // outer ring (CCW)
 *       [[x,y], [x,y], ...],      // hole (CW)
 *     ],
 *     ...
 *   ]
 *
 * Coordinates in `shapePolys` are *local* (relative to the element's
 * top-left (x, y)). After every topology-changing edit we re-normalise:
 * shift all points so min x/y = 0, and update the element's (x, y, w, h)
 * to match the new bbox. Keeps the world-coords invariant while letting
 * the bbox stay tight.
 */
import type { LayoutElement, ShapeMultiPolygon } from '../types/layout'
import {
  bboxMulti,
  elementToAbsoluteMultiPolygon,
  isMergeableShapeType,
  translateMulti,
} from './shapeGeometry'

/** A specific vertex inside a {@code shapePolys} tree. */
export interface PathVertexRef {
  polyIndex: number
  ringIndex: number
  pointIndex: number
}

/** Minimum points a closed ring needs to still be a polygon. */
export const MIN_RING_POINTS = 3

/**
 * Convert any mergeable element into a MERGED_SHAPE carrying polygon
 * data ready for vertex-level editing. If the input is already a
 * MERGED_SHAPE with populated {@code shapePolys}, it's returned as-is
 * (new reference) so caller can still treat it as "the replacement".
 *
 * Returns null when the element isn't mergeable or polygonalisation
 * fails. Style / id / locked / behaviour fields are preserved.
 */
export function convertElementToMergedShape(el: LayoutElement): LayoutElement | null {
  if (!isMergeableShapeType(el.type)) return null

  if (el.type === 'MERGED_SHAPE' && el.shapePolys && el.shapePolys.length > 0) {
    // Already polygon-backed — hand back a shallow clone so callers can
    // treat this and the "just-converted" branch the same way.
    return { ...el, shapePolys: clonePolys(el.shapePolys) }
  }

  const abs = elementToAbsoluteMultiPolygon(el)
  if (!abs || abs.length === 0) return null

  const bb = bboxMulti(abs)
  if (!Number.isFinite(bb.minX) || bb.maxX <= bb.minX || bb.maxY <= bb.minY) return null

  const local = translateMulti(abs, -bb.minX, -bb.minY) as ShapeMultiPolygon
  const width = Math.max(1, Math.ceil(bb.maxX - bb.minX))
  const height = Math.max(1, Math.ceil(bb.maxY - bb.minY))

  return {
    ...el,
    type: 'MERGED_SHAPE',
    x: bb.minX,
    y: bb.minY,
    width,
    height,
    shapePolys: local,
    strokeWidth: el.strokeWidth ?? 2,
    // Intentionally drop parametric-only fields — ringInnerRatio, etc. —
    // since the shape is now a free polygon. Keep `style` so colours
    // carry over. Drop `mergedFromElements` so Unmerge doesn't offer to
    // restore a parametric shape that has diverged.
    ringInnerRatio: undefined,
    mergedFromElements: undefined,
  } as LayoutElement
}

/**
 * Deep clone a polygon tree so mutations don't leak back into the
 * editor store's frozen state. We copy down to the point-pair level.
 */
export function clonePolys(polys: ShapeMultiPolygon): ShapeMultiPolygon {
  return polys.map((poly) =>
    poly.map((ring) => ring.map((pt) => [pt[0], pt[1]] as [number, number])),
  ) as ShapeMultiPolygon
}

/**
 * After a topology edit, the polygon's bbox may have grown (e.g. user
 * dragged a vertex past the current edge) or shrunk. Re-home all points
 * so the bbox starts at (0, 0), and report the world-space (x, y, w, h)
 * the caller should patch onto the element.
 */
export function normalisePolysToLocal(polys: ShapeMultiPolygon): {
  polys: ShapeMultiPolygon
  offsetX: number
  offsetY: number
  width: number
  height: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [px, py] of ring) {
        if (px < minX) minX = px
        if (py < minY) minY = py
        if (px > maxX) maxX = px
        if (py > maxY) maxY = py
      }
    }
  }
  if (!Number.isFinite(minX)) {
    return { polys, offsetX: 0, offsetY: 0, width: 1, height: 1 }
  }
  const shifted = polys.map((poly) =>
    poly.map((ring) => ring.map((pt) => [pt[0] - minX, pt[1] - minY] as [number, number])),
  ) as ShapeMultiPolygon
  const width = Math.max(1, Math.ceil(maxX - minX))
  const height = Math.max(1, Math.ceil(maxY - minY))
  return { polys: shifted, offsetX: minX, offsetY: minY, width, height }
}

/**
 * Replace a single vertex with a new local-coord position. `polys`
 * input is treated as immutable — a new tree is returned.
 */
export function movePointInPolys(
  polys: ShapeMultiPolygon,
  ref: PathVertexRef,
  x: number,
  y: number,
): ShapeMultiPolygon {
  const out = clonePolys(polys)
  const poly = out[ref.polyIndex]
  if (!poly) return out
  const ring = poly[ref.ringIndex]
  if (!ring) return out
  if (ref.pointIndex < 0 || ref.pointIndex >= ring.length) return out
  ring[ref.pointIndex] = [x, y]
  return out
}

/**
 * Insert a new vertex at local-coord `(x, y)` immediately after index
 * {@code afterPointIndex} in the targeted ring. Returns the new polygon
 * tree and a ref pointing at the freshly inserted vertex so the caller
 * can select it.
 */
export function insertPointInPolys(
  polys: ShapeMultiPolygon,
  polyIndex: number,
  ringIndex: number,
  afterPointIndex: number,
  x: number,
  y: number,
): { polys: ShapeMultiPolygon; ref: PathVertexRef } | null {
  const poly = polys[polyIndex]
  if (!poly) return null
  const ring = poly[ringIndex]
  if (!ring) return null
  const idx = Math.max(0, Math.min(afterPointIndex + 1, ring.length))
  const out = clonePolys(polys)
  out[polyIndex]![ringIndex]!.splice(idx, 0, [x, y])
  return {
    polys: out,
    ref: { polyIndex, ringIndex, pointIndex: idx },
  }
}

/**
 * Remove a vertex. Returns null when the ring would drop below
 * {@link MIN_RING_POINTS} (3 — the minimum for a closed polygon). UI
 * treats null as "no-op, beep."
 */
export function removePointFromPolys(
  polys: ShapeMultiPolygon,
  ref: PathVertexRef,
): ShapeMultiPolygon | null {
  const ring = polys[ref.polyIndex]?.[ref.ringIndex]
  if (!ring) return null
  // Last vertex is often a duplicate of the first (closed loop) — treat
  // it as part of the geometry, but don't let deletion collapse the
  // ring below the minimum.
  if (ring.length <= MIN_RING_POINTS) return null
  const out = clonePolys(polys)
  out[ref.polyIndex]![ref.ringIndex]!.splice(ref.pointIndex, 1)
  return out
}

/* ─── Smart guides / snapping ─────────────────────────────────────────── */

/** Magenta dashed line extending across the page — mirrors the editor's
 *  existing `dragGuides` pattern so the overlay feels native. */
export interface SnapGuide {
  /** "vertical" means the guide is a vertical line at x=value. */
  orientation: 'vertical' | 'horizontal'
  /** Document-space coordinate (in the relevant axis). */
  value: number
}

export interface SnapTargets {
  xs: number[]
  ys: number[]
}

/**
 * Gather candidate snap X and Y values. We snap a dragged vertex to:
 *  - its own siblings (other vertices on the path being edited)
 *  - every vertex of every other mergeable shape on the current page
 *  - the bbox edges (left, midX, right, top, midY, bottom) of each other
 *    shape on the page — so alignment with bare boxes still works
 *  - page-level horizontal / vertical midlines of the active page
 *
 * Caller passes `excludeRef` so the currently-dragged vertex doesn't
 * snap to itself.
 */
export function collectSnapTargets(args: {
  editingElement: LayoutElement
  editingPolys: ShapeMultiPolygon
  excludeRef?: PathVertexRef
  otherElements: LayoutElement[]
}): SnapTargets {
  const { editingElement, editingPolys, excludeRef, otherElements } = args
  const xs = new Set<number>()
  const ys = new Set<number>()

  // Sibling vertices on the path we're editing (world coords).
  editingPolys.forEach((poly, pi) => {
    poly.forEach((ring, ri) => {
      ring.forEach((pt, pti) => {
        if (
          excludeRef &&
          pi === excludeRef.polyIndex &&
          ri === excludeRef.ringIndex &&
          pti === excludeRef.pointIndex
        ) {
          return
        }
        xs.add(pt[0] + editingElement.x)
        ys.add(pt[1] + editingElement.y)
      })
    })
  })

  for (const other of otherElements) {
    if (other.id === editingElement.id) continue
    // bbox edges + midlines
    xs.add(other.x)
    xs.add(other.x + other.width / 2)
    xs.add(other.x + other.width)
    ys.add(other.y)
    ys.add(other.y + other.height / 2)
    ys.add(other.y + other.height)
    // MERGED_SHAPE — also contribute every vertex.
    if (other.type === 'MERGED_SHAPE' && other.shapePolys?.length) {
      for (const poly of other.shapePolys) {
        for (const ring of poly) {
          for (const pt of ring) {
            xs.add(pt[0] + other.x)
            ys.add(pt[1] + other.y)
          }
        }
      }
    }
  }

  return { xs: [...xs], ys: [...ys] }
}

/**
 * Snap a world-space position against a set of targets. Returns the
 * possibly-adjusted position plus any guide lines that should render.
 * Threshold is expressed in document units so callers divide CSS-pixel
 * distances by zoom before comparison; we accept document-space
 * directly for clarity.
 */
export function applySnap(
  rawX: number,
  rawY: number,
  targets: SnapTargets,
  thresholdDocUnits: number,
): { x: number; y: number; guides: SnapGuide[] } {
  const guides: SnapGuide[] = []
  let x = rawX
  let y = rawY
  let bestDx = thresholdDocUnits
  let bestX: number | undefined
  for (const t of targets.xs) {
    const d = Math.abs(t - rawX)
    if (d <= bestDx) {
      bestDx = d
      bestX = t
    }
  }
  if (bestX != null) {
    x = bestX
    guides.push({ orientation: 'vertical', value: bestX })
  }
  let bestDy = thresholdDocUnits
  let bestY: number | undefined
  for (const t of targets.ys) {
    const d = Math.abs(t - rawY)
    if (d <= bestDy) {
      bestDy = d
      bestY = t
    }
  }
  if (bestY != null) {
    y = bestY
    guides.push({ orientation: 'horizontal', value: bestY })
  }
  return { x, y, guides }
}

/** Round-to-grid snap, independent of axis alignment. */
export function snapToGrid(
  rawX: number,
  rawY: number,
  gridSize: number,
): { x: number; y: number } {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return { x: rawX, y: rawY }
  return {
    x: Math.round(rawX / gridSize) * gridSize,
    y: Math.round(rawY / gridSize) * gridSize,
  }
}

/**
 * Constrain a dragged vertex to a 45° multiple relative to a reference
 * point. Used when the user holds Shift during a drag — matches the
 * existing editor convention for angle-locked moves.
 */
export function snapTo45(
  rawX: number,
  rawY: number,
  anchor: { x: number; y: number },
): { x: number; y: number } {
  const dx = rawX - anchor.x
  const dy = rawY - anchor.y
  if (dx === 0 && dy === 0) return { x: rawX, y: rawY }
  const angle = Math.atan2(dy, dx)
  const quant = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
  const dist = Math.hypot(dx, dy)
  return {
    x: anchor.x + Math.cos(quant) * dist,
    y: anchor.y + Math.sin(quant) * dist,
  }
}

/**
 * Find the closest point on a polygon ring to `(px, py)` — returns the
 * world-space coord plus the segment index it landed on. Used by the
 * click-edge-to-insert interaction in the overlay: the cursor's nearest
 * projection onto any ring is the insertion candidate.
 *
 * The segment between {@code ring[idx]} and {@code ring[idx+1]} (or the
 * wrap-around pair) is what a new vertex is inserted after.
 */
export function nearestPointOnRing(
  ring: Array<[number, number]>,
  px: number,
  py: number,
): { x: number; y: number; segmentIndex: number; distance: number } | null {
  if (ring.length < 2) return null
  let best: { x: number; y: number; segmentIndex: number; distance: number } | null = null
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const proj = projectPointOnSegment(px, py, a[0], a[1], b[0], b[1])
    if (!best || proj.distance < best.distance) {
      best = { ...proj, segmentIndex: i }
    }
  }
  return best
}

function projectPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number; distance: number } {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const d = Math.hypot(px - ax, py - ay)
    return { x: ax, y: ay, distance: d }
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * dx
  const qy = ay + t * dy
  return { x: qx, y: qy, distance: Math.hypot(px - qx, py - qy) }
}
