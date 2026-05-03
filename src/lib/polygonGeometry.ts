import type { LayoutElement, PolygonKind } from '../types/layout'

/**
 * Compute a polygon's vertex points in the element's local coords
 * (origin at the bbox top-left, x/y in pt). Used by the canvas SVG
 * render, the selection-silhouette overlay, and the backend's PDF
 * shape renderer (mirrored in {@code PdfRendererService.java}).
 *
 * Pre-set kinds (rect / triangle / diamond / star / arrow) compute
 * their points from the bbox dimensions — and, for {@code 'arrow'},
 * the {@code style.arrowStart} / {@code style.arrowEnd} flags. The
 * {@code 'custom'} kind reads from {@link LayoutElement.points} where
 * each entry is {@code [u, v]} in {@code [0, 1]} relative to the
 * bbox; falls back to a rectangle if {@code points} is missing or
 * malformed so a corrupted polygon never renders as nothing.
 */
export function resolvePolygonPoints(el: LayoutElement): [number, number][] {
  const w = el.width
  const h = el.height
  const kind = el.polygonKind ?? 'rect'
  switch (kind) {
    case 'rect':
      return [[0, 0], [w, 0], [w, h], [0, h]]
    case 'regular': {
      // Regular n-gon centred in the bbox with the first vertex pointing
      // up. Inscribed in the bbox so it always fills the available space
      // (rx = w/2, ry = h/2). Sides clamped to [3, 20] — three covers
      // triangle, twenty avoids the geometry collapsing into a circle.
      const sides = Math.max(3, Math.min(20, Math.round(el.sides ?? 5)))
      const cx = w / 2
      const cy = h / 2
      const rx = w / 2
      const ry = h / 2
      const out: [number, number][] = []
      for (let i = 0; i < sides; i++) {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides
        out.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)])
      }
      return out
    }
    case 'triangle':
      return [[w / 2, 0], [w, h], [0, h]]
    case 'diamond':
      return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]
    case 'star': {
      const cx = w / 2
      const cy = h / 2
      const ro = Math.min(w, h) / 2
      const ri = ro * 0.38
      const out: [number, number][] = []
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2
        const r = i % 2 === 0 ? ro : ri
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
      }
      return out
    }
    case 'arrow':
      return resolveArrowPoints(el)
    case 'custom': {
      const pts = el.points
      if (!Array.isArray(pts) || pts.length < 3) {
        return [[0, 0], [w, 0], [w, h], [0, h]]
      }
      return pts
        .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map(([u, v]) => [u * w, v * h] as [number, number])
    }
  }
}

/**
 * Arrow geometry — separate so the canvas and PDF renderers can share
 * the exact branching logic that picks single vs bidirectional based on
 * {@code style.arrowStart} / {@code style.arrowEnd}. Defaults to a
 * right-pointing arrow when neither flag is set, matching the legacy
 * {@code ARROW} element type's look.
 */
function resolveArrowPoints(el: LayoutElement): [number, number][] {
  const w = el.width
  const h = el.height
  const t = Math.min(h * 0.35, w * 0.18)
  const mid = h / 2
  const arrowStart = el.style?.arrowStart === true
  const arrowEnd = el.style?.arrowEnd === true || (!arrowStart && el.style?.arrowEnd !== false)
  const headLen = w * 0.32
  const xLeftHead = arrowStart ? headLen : 0
  const xRightHead = arrowEnd ? w - headLen : w
  if (arrowStart && arrowEnd) {
    return [
      [xLeftHead, mid - t / 2],
      [xRightHead, mid - t / 2],
      [xRightHead, 0],
      [w, mid],
      [xRightHead, h],
      [xRightHead, mid + t / 2],
      [xLeftHead, mid + t / 2],
      [xLeftHead, h],
      [0, mid],
      [xLeftHead, 0],
    ]
  }
  if (arrowStart) {
    return [
      [w, mid - t / 2],
      [xLeftHead, mid - t / 2],
      [xLeftHead, 0],
      [0, mid],
      [xLeftHead, h],
      [xLeftHead, mid + t / 2],
      [w, mid + t / 2],
    ]
  }
  return [
    [0, mid - t / 2],
    [xRightHead, mid - t / 2],
    [xRightHead, 0],
    [w, mid],
    [xRightHead, h],
    [xRightHead, mid + t / 2],
    [0, mid + t / 2],
  ]
}

/**
 * Map a legacy element type to its POLYGON {@link PolygonKind}, or null
 * for types that aren't polygonal (TEXT/IMAGE/ELLIPSE/RING/LINE/etc.).
 * Used by {@code parseLayoutJson} to migrate persisted layouts on load.
 */
export function legacyTypeToPolygonKind(type: string): PolygonKind | null {
  switch (type) {
    case 'BOX': return 'rect'
    case 'TRIANGLE': return 'triangle'
    case 'DIAMOND': return 'diamond'
    case 'STAR': return 'star'
    case 'ARROW': return 'arrow'
    default: return null
  }
}

/** Convert a points array into the SVG `points` attribute format. */
export function polygonPointsToSvgString(points: readonly [number, number][]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ')
}
