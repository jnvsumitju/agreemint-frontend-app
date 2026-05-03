import polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Pair, Polygon, Ring } from 'polygon-clipping'
import type { LayoutElement, ShapeMultiPolygon, ShapePolygon, ShapeRing } from '../types/layout'
import { flattenBezierPath } from './bezierGeometry'
import { resolvePolygonPoints } from './polygonGeometry'

export const MERGEABLE_SHAPE_TYPES = new Set<string>([
  'LINE',
  // Unified polygon — covers rect / regular / triangle / diamond / star /
  // arrow / custom kinds. Path-edit mode treats any polygonal element as
  // mergeable so double-click → vertex edit works on the new POLYGON tile.
  'POLYGON',
  'BOX',
  'ELLIPSE',
  'TRIANGLE',
  'ARROW',
  'DIAMOND',
  'STAR',
  'RING',
  'MERGED_SHAPE',
])

export function isMergeableShapeType(t: LayoutElement['type']): boolean {
  return MERGEABLE_SHAPE_TYPES.has(t)
}

/**
 * Resize a MERGED_SHAPE by scaling every polygon / bezier vertex in
 * lock-step with the new bbox. Only called from {@code resizeElement}
 * — axis-aligned shapes use the regular `{ ...el, width, height }`
 * overwrite. A MERGED_SHAPE's geometry lives in `shapePolys` and
 * (optionally) `bezierPath`; plain width/height assignment would leave
 * the drawn outline detached from the handle. Clamps to a 1pt minimum
 * so we never collapse the shape to a zero-size invalid state.
 */
export function scaleMergedShape(
  el: LayoutElement,
  nextWidth: number,
  nextHeight: number,
): LayoutElement {
  if (el.type !== 'MERGED_SHAPE') return { ...el, width: nextWidth, height: nextHeight }
  const oldW = Math.max(1, el.width)
  const oldH = Math.max(1, el.height)
  const targetW = Math.max(1, nextWidth)
  const targetH = Math.max(1, nextHeight)
  const sx = targetW / oldW
  const sy = targetH / oldH
  const patch: Partial<LayoutElement> = { width: targetW, height: targetH }
  if (el.shapePolys?.length) {
    patch.shapePolys = el.shapePolys.map((poly) =>
      poly.map((ring) => ring.map((pt) => [pt[0] * sx, pt[1] * sy] as [number, number])),
    )
  }
  if (el.bezierPath?.length) {
    patch.bezierPath = el.bezierPath.map((poly) =>
      poly.map((ring) =>
        ring.map((v) => {
          const scaled: typeof v = { p: [v.p[0] * sx, v.p[1] * sy] }
          if (v.cpIn) scaled.cpIn = [v.cpIn[0] * sx, v.cpIn[1] * sy]
          if (v.cpOut) scaled.cpOut = [v.cpOut[0] * sx, v.cpOut[1] * sy]
          if (v.smooth) scaled.smooth = true
          return scaled
        }),
      ),
    )
  }
  return { ...el, ...patch }
}

/**
 * Two or more selected unlocked mergeable shapes — the precondition for
 * both {@link divideLayoutShapeElements Divide} and
 * {@link mergeLayoutShapeElements Union}. Selection order is preserved so
 * the store can reason about z-ordering (topmost = last in the list).
 *
 * We don't require the bounding boxes to actually overlap: a divide of
 * two disjoint shapes is simply a no-op that still produces the two
 * original regions as polygon MERGED_SHAPEs. A union of two disjoint
 * shapes produces a compound path. Both are well-defined results, so we
 * only gate on selection cardinality + type + lock state.
 */
export function canBooleanCombineSelection(args: {
  selectedIds: string[]
  elements: LayoutElement[]
}): boolean {
  const { selectedIds, elements } = args
  if (selectedIds.length < 2) return false
  const picked = selectedIds
    .map((id) => elements.find((e) => e.id === id))
    .filter((e): e is LayoutElement => e != null)
  if (picked.length < 2) return false
  return picked.every((e) => !e.locked && isMergeableShapeType(e.type))
}

/** Alias — keeps LeftPalette's "canDivide" naming explicit at call sites. */
export const canDivideSelection = canBooleanCombineSelection

/** Alias — keeps LeftPalette's "canUnion" naming explicit at call sites. */
export const canUnionSelection = canBooleanCombineSelection

function ellipseRing(x: number, y: number, w: number, h: number, segments: number): Ring {
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = Math.max(0.5, w / 2)
  const ry = Math.max(0.5, h / 2)
  const ring: Pair[] = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    ring.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)])
  }
  return ring
}

function triangleRing(x: number, y: number, w: number, h: number): Ring {
  return [
    [x + w / 2, y],
    [x + w, y + h],
    [x, y + h],
    [x + w / 2, y],
  ]
}

function diamondRing(x: number, y: number, w: number, h: number): Ring {
  return [
    [x + w / 2, y],
    [x + w, y + h / 2],
    [x + w / 2, y + h],
    [x, y + h / 2],
    [x + w / 2, y],
  ]
}

/** Horizontal arrow to the right, as a closed polygon (for union). */
function arrowRing(x: number, y: number, w: number, h: number): Ring {
  const t = Math.min(h * 0.35, w * 0.18)
  const mid = y + h / 2
  const x0 = x
  const xShaft = x + w * 0.68
  const xTip = x + w
  return [
    [x0, mid - t / 2],
    [xShaft, mid - t / 2],
    [xShaft, y],
    [xTip, mid],
    [xShaft, y + h],
    [xShaft, mid + t / 2],
    [x0, mid + t / 2],
    [x0, mid - t / 2],
  ]
}

function starRing(x: number, y: number, w: number, h: number): Ring {
  const cx = x + w / 2
  const cy = y + h / 2
  const ro = Math.min(w, h) / 2
  const ri = ro * 0.38
  const ring: Pair[] = []
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2
    const r = i % 2 === 0 ? ro : ri
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return ring
}

function lineThickRect(el: LayoutElement): Ring {
  const th = Math.max(el.strokeWidth ?? 1, el.height || 4)
  const ymid = el.y + (el.height || 4) / 2
  const y0 = ymid - th / 2
  const x = el.x
  const x2 = el.x + el.width
  return [
    [x, y0],
    [x2, y0],
    [x2, y0 + th],
    [x, y0 + th],
    [x, y0],
  ]
}

function clampRingRatio(r: number): number {
  if (!Number.isFinite(r)) return 0.55
  return Math.min(0.95, Math.max(0.05, r))
}

function elementToPolygon(el: LayoutElement): Polygon | null {
  const x = el.x
  const y = el.y
  const w = el.width
  const h = el.height
  switch (el.type) {
    case 'POLYGON': {
      // Unified polygon — pull the local-coord vertex list from the
      // central resolver so path-edit / boolean ops see the same
      // geometry as the canvas + PDF renderers, then translate into
      // absolute coords. Using resolvePolygonPoints means every
      // polygonKind (rect, regular, triangle, diamond, star, arrow,
      // custom) flows through one path.
      const local = resolvePolygonPoints(el)
      if (local.length < 3) return null
      const ring: Ring = local.map(([lx, ly]): Pair => [x + lx, y + ly])
      // Close the ring — polygon-clipping expects the first and last
      // points to coincide for proper boolean ops.
      const first = ring[0]!
      const last = ring[ring.length - 1]!
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]])
      }
      return [ring]
    }
    case 'BOX':
      return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]
    case 'LINE':
      return [lineThickRect(el)]
    case 'ELLIPSE':
      return [ellipseRing(x, y, w, h, 32)]
    case 'TRIANGLE':
      return [triangleRing(x, y, w, h)]
    case 'ARROW':
      return [arrowRing(x, y, w, h)]
    case 'DIAMOND':
      return [diamondRing(x, y, w, h)]
    case 'STAR':
      return [starRing(x, y, w, h)]
    case 'RING': {
      const ratio = clampRingRatio(el.ringInnerRatio ?? 0.55)
      const iw = w * ratio
      const ih = h * ratio
      const ox = x + (w - iw) / 2
      const oy = y + (h - ih) / 2
      const outer = ellipseRing(x, y, w, h, 32)
      const inner = ellipseRing(ox, oy, iw, ih, 32)
      return [outer, [...inner].reverse()]
    }
    default:
      return null
  }
}

/** Shift every vertex of every ring in `multi` by `(dx, dy)`. Exported so
 *  path-edit helpers can re-home polygons after a bbox normalisation. */
export function translateMulti(multi: MultiPolygon, dx: number, dy: number): MultiPolygon {
  return multi.map((poly) =>
    poly.map((ring) => ring.map((p): Pair => [p[0] + dx, p[1] + dy]))
  )
}

/**
 * Rotate every vertex of `multi` around `(cx, cy)` by `angleDeg`
 * (positive = clockwise, matching CSS `rotate()`). Used so the boolean
 * ops (Union / Divide) respect an element's `style.rotation` — without
 * this rotation would be silently stripped because polygon-clipping
 * sees only axis-aligned points.
 */
export function rotateMulti(multi: MultiPolygon, cx: number, cy: number, angleDeg: number): MultiPolygon {
  if (!Number.isFinite(angleDeg) || angleDeg === 0) return multi
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return multi.map((poly) =>
    poly.map((ring) =>
      ring.map((p): Pair => {
        const dx = p[0] - cx
        const dy = p[1] - cy
        return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
      }),
    ),
  )
}

/** Axis-aligned bounding box over every ring. Exported for path-edit use. */
export function bboxMulti(multi: MultiPolygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of multi) {
    for (const ring of poly) {
      for (const [px, py] of ring) {
        minX = Math.min(minX, px)
        minY = Math.min(minY, py)
        maxX = Math.max(maxX, px)
        maxY = Math.max(maxY, py)
      }
    }
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Polygonalise any mergeable element into an absolute-coordinate
 * MultiPolygon (outer ring + optional holes per component). Parametric
 * shapes (ellipse, ring, arrow…) are approximated to 32-sided polygons.
 * MERGED_SHAPE with a {@code bezierPath} is flattened to polygon first
 * so Union / Divide keep working on curved shapes. Exported so the
 * path-edit mode can convert a shape to MERGED_SHAPE-compatible geometry
 * on entry.
 *
 * Honours `style.rotation` by rotating the polygon around the element's
 * bbox centre before returning. Rotation is a CSS transform applied at
 * render time and doesn't affect the stored (x, y, width, height); if we
 * skipped this step the boolean ops would silently fall back to the
 * axis-aligned bbox and throw away the author's rotation.
 */
export function elementToAbsoluteMultiPolygon(el: LayoutElement): MultiPolygon | null {
  let absPoly: MultiPolygon | null = null
  if (el.type === 'MERGED_SHAPE') {
    // Bezier takes priority when present — `shapePolys` is meant to be
    // the flattened shadow copy, but flattening on the fly costs ~nothing
    // and guarantees we're in sync even if the shadow was stale.
    if (el.bezierPath?.length) {
      absPoly = translateMulti(flattenBezierPath(el.bezierPath) as MultiPolygon, el.x, el.y)
    } else if (el.shapePolys?.length) {
      absPoly = translateMulti(el.shapePolys, el.x, el.y)
    }
  } else {
    const poly = elementToPolygon(el)
    if (poly) absPoly = [poly]
  }
  if (!absPoly) return null

  const rotation = el.style?.rotation ?? 0
  if (rotation !== 0) {
    const cx = el.x + el.width / 2
    const cy = el.y + el.height / 2
    return rotateMulti(absPoly, cx, cy, rotation)
  }
  return absPoly
}

/** One SVG path `d` for a polygon with optional holes (even-odd fill). */
export function shapePolygonToSvgPathD(poly: ShapePolygon): string {
  return poly
    .map((ring) => ringToSvgSubpath(ring))
    .filter(Boolean)
    .join(' ')
}

function ringToSvgSubpath(ring: ShapeRing): string {
  if (ring.length < 2) return ''
  const pts = ring.length > 2 && pointsEqual(ring[0]!, ring[ring.length - 1]!) ? ring.slice(0, -1) : ring
  if (pts.length < 2) return ''
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i]![0]} ${pts[i]![1]}`
  }
  return `${d} Z`
}

function pointsEqual(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
}

/**
 * One resulting region from {@link divideLayoutShapeElements}. Caller is
 * expected to spin each of these up as a new MERGED_SHAPE.
 */
export interface DivideRegionResult {
  x: number
  y: number
  width: number
  height: number
  shapePolys: ShapeMultiPolygon
  strokeWidth: number
  color?: string
  backgroundColor?: string
  /** The source element whose style/stroke this region inherited — always
   *  the topmost (last-in-order-in-the-input-array) contributor among the
   *  shapes that cover this region. */
  sourceEl: LayoutElement
}

/**
 * Fragment N overlapping shapes into their distinct boolean regions. For
 * three overlapping circles (Venn diagram), this returns seven pieces —
 * one per non-empty subset of {A, B, C}. Non-overlapping inputs yield
 * just the originals (each as its own polygon result).
 *
 * Algorithm: for each non-empty subset S of the inputs,
 *   regionS = intersection(shapes in S)  minus  union(shapes not in S)
 * which captures the points covered by exactly the shapes in S. Empty
 * regions (the usual case for most subsets) are skipped, so the result
 * length is ≤ 2^N − 1.
 *
 * Complexity is O(2^N × N) boolean ops. Fine for N ≤ ~6 (= 63 subsets);
 * users rarely combine more than that interactively, so we just guard
 * with a hard cap rather than a smarter sweep-line.
 *
 * Each resulting region inherits its styling from the **topmost** source
 * shape in S (the one latest in the input list by z-order). Caller is
 * responsible for handing inputs in bottom→top order.
 */
export function divideLayoutShapeElements(els: LayoutElement[]): DivideRegionResult[] | null {
  if (els.length < 2) return null
  if (els.length > 6) return null // runaway guard — 63 subsets is already a lot
  const geoms: { el: LayoutElement; multi: MultiPolygon }[] = []
  for (const el of els) {
    const g = elementToAbsoluteMultiPolygon(el)
    if (g && g.length > 0) geoms.push({ el, multi: g })
  }
  const n = geoms.length
  if (n < 2) return null

  const out: DivideRegionResult[] = []
  const total = 1 << n

  for (let mask = 1; mask < total; mask++) {
    // Partition geoms into "members" of subset S and "others".
    const members: { el: LayoutElement; multi: MultiPolygon }[] = []
    const others: { el: LayoutElement; multi: MultiPolygon }[] = []
    for (let i = 0; i < n; i++) {
      if ((mask >> i) & 1) members.push(geoms[i]!)
      else others.push(geoms[i]!)
    }

    // intersection(members)
    let acc: MultiPolygon = members[0]!.multi
    for (let i = 1; i < members.length; i++) {
      acc = polygonClipping.intersection(acc, members[i]!.multi)
      if (!acc.length) break
    }
    if (!acc.length) continue

    // difference with union(others)
    if (others.length > 0) {
      let otherUnion: MultiPolygon = others[0]!.multi
      for (let i = 1; i < others.length; i++) {
        otherUnion = polygonClipping.union(otherUnion, others[i]!.multi)
      }
      acc = polygonClipping.difference(acc, otherUnion)
      if (!acc.length) continue
    }

    const bb = bboxMulti(acc)
    if (!Number.isFinite(bb.minX) || bb.maxX <= bb.minX || bb.maxY <= bb.minY) continue

    // Style inheritance: topmost contributor (last in `members`, which
    // preserves original input order).
    const topmost = members[members.length - 1]!
    const minX = bb.minX
    const minY = bb.minY
    const width = Math.max(1, Math.ceil(bb.maxX - minX))
    const height = Math.max(1, Math.ceil(bb.maxY - minY))
    const local = translateMulti(acc, -minX, -minY) as ShapeMultiPolygon

    const color = topmost.el.style?.color?.trim() || undefined
    const backgroundColor = topmost.el.style?.backgroundColor?.trim() || undefined
    const strokeWidth = Math.max(1, topmost.el.strokeWidth ?? 2)

    out.push({
      x: minX,
      y: minY,
      width,
      height,
      shapePolys: local,
      strokeWidth,
      color,
      backgroundColor,
      sourceEl: topmost.el,
    })
  }

  if (out.length === 0) return null
  return out
}

/**
 * Boolean union of N overlapping shapes into a single MERGED_SHAPE. The
 * output's stroke width is the max across inputs; colour is taken from
 * the topmost contributor that declares one.
 */
export function mergeLayoutShapeElements(els: LayoutElement[]): {
  x: number
  y: number
  width: number
  height: number
  shapePolys: ShapeMultiPolygon
  strokeWidth: number
  color?: string
  backgroundColor?: string
} | null {
  if (els.length < 2) return null
  const geoms: MultiPolygon[] = []
  for (const el of els) {
    const g = elementToAbsoluteMultiPolygon(el)
    if (g) geoms.push(g)
  }
  if (geoms.length < 2) return null
  let acc = geoms[0]!
  for (let i = 1; i < geoms.length; i++) {
    acc = polygonClipping.union(acc, geoms[i]!)
  }
  if (!acc.length) return null
  const bb = bboxMulti(acc)
  if (!Number.isFinite(bb.minX) || bb.maxX <= bb.minX || bb.maxY <= bb.minY) return null
  const minX = bb.minX
  const minY = bb.minY
  const width = Math.max(1, Math.ceil(bb.maxX - minX))
  const height = Math.max(1, Math.ceil(bb.maxY - minY))
  const local = translateMulti(acc, -minX, -minY) as ShapeMultiPolygon

  let strokeWidth = 2
  for (const e of els) {
    const sw = e.strokeWidth
    if (sw != null && Number.isFinite(sw)) strokeWidth = Math.max(strokeWidth, sw)
  }
  // Style inheritance: topmost contributor with a declared colour wins.
  // els is assumed bottom→top; walk from the end.
  let color: string | undefined
  let backgroundColor: string | undefined
  for (let i = els.length - 1; i >= 0; i--) {
    const s = els[i]!.style
    if (color == null && s?.color?.trim()) color = s.color.trim()
    if (backgroundColor == null && s?.backgroundColor?.trim()) backgroundColor = s.backgroundColor.trim()
    if (color != null && backgroundColor != null) break
  }

  return {
    x: minX,
    y: minY,
    width,
    height,
    shapePolys: local,
    strokeWidth,
    color,
    backgroundColor,
  }
}
