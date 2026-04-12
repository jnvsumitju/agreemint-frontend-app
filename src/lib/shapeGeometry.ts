import polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Pair, Polygon, Ring } from 'polygon-clipping'
import type { LayoutElement, ShapeMultiPolygon, ShapePolygon, ShapeRing } from '../types/layout'

export const MERGEABLE_SHAPE_TYPES = new Set<string>([
  'LINE',
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

/** Two mergeable shapes selected, or one selected element in a two-member unlocked mergeable group. */
export function canSubtractPunchHoleSelection(args: {
  selectedIds: string[]
  elements: LayoutElement[]
}): boolean {
  const { selectedIds, elements } = args
  if (selectedIds.length === 2) {
    const a = elements.find((e) => e.id === selectedIds[0])
    const b = elements.find((e) => e.id === selectedIds[1])
    return !!(
      a &&
      b &&
      !a.locked &&
      !b.locked &&
      isMergeableShapeType(a.type) &&
      isMergeableShapeType(b.type)
    )
  }
  if (selectedIds.length === 1) {
    const el = elements.find((e) => e.id === selectedIds[0])
    if (!el?.groupId) return false
    const grp = elements.filter((e) => e.groupId === el.groupId && !e.locked)
    return grp.length === 2 && grp.every((e) => isMergeableShapeType(e.type))
  }
  return false
}

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

function translateMulti(multi: MultiPolygon, dx: number, dy: number): MultiPolygon {
  return multi.map((poly) =>
    poly.map((ring) => ring.map((p): Pair => [p[0] + dx, p[1] + dy]))
  )
}

function bboxMulti(multi: MultiPolygon): { minX: number; minY: number; maxX: number; maxY: number } {
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

function elementToAbsoluteMultiPolygon(el: LayoutElement): MultiPolygon | null {
  if (el.type === 'MERGED_SHAPE' && el.shapePolys?.length) {
    return translateMulti(el.shapePolys, el.x, el.y)
  }
  const poly = elementToPolygon(el)
  return poly ? [poly] : null
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

/** Subtract clip geometry from subject (boolean difference). Use for “punch hole” / inverted fill between outlines. */
export function subtractLayoutShapeElements(
  subjectEl: LayoutElement,
  clipEl: LayoutElement
): {
  x: number
  y: number
  width: number
  height: number
  shapePolys: ShapeMultiPolygon
  strokeWidth: number
  color?: string
  backgroundColor?: string
} | null {
  const subj = elementToAbsoluteMultiPolygon(subjectEl)
  const clip = elementToAbsoluteMultiPolygon(clipEl)
  if (!subj || !clip) return null
  const diff = polygonClipping.difference(subj, clip)
  if (!diff.length) return null
  const bb = bboxMulti(diff)
  if (!Number.isFinite(bb.minX) || bb.maxX <= bb.minX || bb.maxY <= bb.minY) return null
  const minX = bb.minX
  const minY = bb.minY
  const width = Math.max(1, Math.ceil(bb.maxX - minX))
  const height = Math.max(1, Math.ceil(bb.maxY - minY))
  const local = translateMulti(diff, -minX, -minY) as ShapeMultiPolygon
  const strokeWidth = Math.max(
    1,
    Math.max(subjectEl.strokeWidth ?? 2, clipEl.strokeWidth ?? 2)
  )
  const color = subjectEl.style?.color?.trim()
  const backgroundColor = subjectEl.style?.backgroundColor?.trim()
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

export function mergeLayoutShapeElements(els: LayoutElement[]): {
  x: number
  y: number
  width: number
  height: number
  shapePolys: ShapeMultiPolygon
  strokeWidth: number
  color?: string
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
  const color = els.find((e) => e.style?.color?.trim())?.style?.color?.trim()

  return {
    x: minX,
    y: minY,
    width,
    height,
    shapePolys: local,
    strokeWidth,
    color,
  }
}
