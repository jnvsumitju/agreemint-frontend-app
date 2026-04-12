import type { LayoutElement, PageSpec } from '../types/layout'
import { pageDimensionsPt, snap } from '../types/layout'

export function isHeaderOrFooterType(t: LayoutElement['type']): boolean {
  return t === 'HEADER' || t === 'FOOTER'
}

export function printMarginInnerBounds(page: PageSpec): {
  minX: number
  maxX: number
  minY: number
  maxY: number
  pw: number
  ph: number
} {
  const { width: pw, height: ph } = pageDimensionsPt(page)
  const m = page.margins
  return {
    minX: m.left,
    maxX: pw - m.right,
    minY: m.top,
    maxY: ph - m.bottom,
    pw,
    ph,
  }
}

/**
 * Clamp HEADER/FOOTER so the entire box stays inside the page (0…pageW × 0…pageH).
 * Width/height are capped at page size (not only pw−x), then position is adjusted.
 */
export function clampHeaderFooterLayoutToPage(el: LayoutElement, page: PageSpec): LayoutElement {
  if (!isHeaderOrFooterType(el.type)) return el
  const { width: pw, height: ph } = pageDimensionsPt(page)
  const minW = 20
  const minH = 16
  const width = snap(Math.max(minW, Math.min(pw, el.width)))
  const height = snap(Math.max(minH, Math.min(ph, el.height)))
  const x = snap(Math.max(0, Math.min(Math.max(0, pw - width), el.x)))
  const y = snap(Math.max(0, Math.min(Math.max(0, ph - height), el.y)))
  return { ...el, x, y, width, height }
}

/** Clamp top-left so the element bbox stays inside printable margins (or full page for HEADER/FOOTER). */
export function clampElementTopLeftToPrintMargins(
  el: Pick<LayoutElement, 'type' | 'width' | 'height'>,
  x: number,
  y: number,
  page: PageSpec
): { x: number; y: number } {
  if (isHeaderOrFooterType(el.type)) {
    const c = clampHeaderFooterLayoutToPage({ ...(el as LayoutElement), x, y } as LayoutElement, page)
    return { x: c.x, y: c.y }
  }
  const { minX, maxX, minY, maxY } = printMarginInnerBounds(page)
  const maxLeftX = maxX - el.width
  const maxLeftY = maxY - el.height
  const cx =
    maxLeftX >= minX ? Math.max(minX, Math.min(maxLeftX, x)) : minX
  const cy =
    maxLeftY >= minY ? Math.max(minY, Math.min(maxLeftY, y)) : minY
  return { x: snap(cx), y: snap(cy) }
}

/** Clamp size from current top-left; keeps right/bottom inside margins (or page for HEADER/FOOTER). */
export function clampElementSizeToPrintMargins(
  el: Pick<LayoutElement, 'type' | 'x' | 'y' | 'width' | 'height'>,
  width: number,
  height: number,
  page: PageSpec
): { width: number; height: number } {
  const { width: pw, height: ph } = pageDimensionsPt(page)
  const minW = 20
  const minH = 16
  if (isHeaderOrFooterType(el.type)) {
    const c = clampHeaderFooterLayoutToPage(
      { ...(el as LayoutElement), width, height } as LayoutElement,
      page
    )
    return { width: c.width, height: c.height }
  }
  const { maxX, maxY } = printMarginInnerBounds(page)
  const maxW = Math.max(minW, maxX - el.x)
  const maxH = Math.max(minH, maxY - el.y)
  return {
    width: snap(Math.max(minW, Math.min(maxW, width))),
    height: snap(Math.max(minH, Math.min(maxH, height))),
  }
}

/** After arbitrary edits, clamp geometry (print margins, or full page for HEADER/FOOTER). */
export function clampElementLayoutToPrintMargins(el: LayoutElement, page: PageSpec): LayoutElement {
  if (isHeaderOrFooterType(el.type)) {
    return clampHeaderFooterLayoutToPage(el, page)
  }
  const xy = clampElementTopLeftToPrintMargins(el, el.x, el.y, page)
  const wh = clampElementSizeToPrintMargins({ ...el, ...xy }, el.width, el.height, page)
  return { ...el, ...xy, ...wh }
}

/**
 * Rigid translation for a set of elements: clamp (ddx, ddy) so every non–header/footer member
 * stays inside print margins. Header/footer members do not shrink the allowed interval.
 */
const MARGIN_EPS = 0.5

/** True if the element box (top-left + size) extends outside the printable margin box. */
export function isOutsidePrintMargins(
  el: Pick<LayoutElement, 'type' | 'width' | 'height'>,
  x: number,
  y: number,
  page: PageSpec
): boolean {
  if (isHeaderOrFooterType(el.type)) return false
  const { minX, maxX, minY, maxY } = printMarginInnerBounds(page)
  const r = x + el.width
  const b = y + el.height
  return (
    x < minX - MARGIN_EPS ||
    y < minY - MARGIN_EPS ||
    r > maxX + MARGIN_EPS ||
    b > maxY + MARGIN_EPS
  )
}

export function isResizeOutsidePrintMargins(
  el: Pick<LayoutElement, 'type' | 'x' | 'y'>,
  width: number,
  height: number,
  page: PageSpec
): boolean {
  if (isHeaderOrFooterType(el.type)) return false
  return isOutsidePrintMargins({ ...el, width, height }, el.x, el.y, page)
}

export function clampGroupTranslationDelta(
  elements: LayoutElement[],
  moveIds: Set<string>,
  ddx: number,
  ddy: number,
  page: PageSpec
): { dx: number; dy: number } {
  const { width: pw, height: ph } = pageDimensionsPt(page)
  const margins = page.margins
  let minDdx = -Infinity
  let maxDdx = Infinity
  let minDdy = -Infinity
  let maxDdy = Infinity
  let hasConstrained = false
  for (const e of elements) {
    if (!moveIds.has(e.id)) continue
    if (isHeaderOrFooterType(e.type)) continue
    hasConstrained = true
    minDdx = Math.max(minDdx, margins.left - e.x)
    maxDdx = Math.min(maxDdx, pw - margins.right - e.width - e.x)
    minDdy = Math.max(minDdy, margins.top - e.y)
    maxDdy = Math.min(maxDdy, ph - margins.bottom - e.height - e.y)
  }
  if (!hasConstrained) return { dx: ddx, dy: ddy }
  const cdx = Math.max(minDdx, Math.min(maxDdx, ddx))
  const cdy = Math.max(minDdy, Math.min(maxDdy, ddy))
  return { dx: cdx, dy: cdy }
}

/**
 * Apply print-margin (or full page for HEADER/FOOTER) clamp, then optional grid snap with re-clamp.
 */
export function finalizeDragPosition(
  el: LayoutElement,
  nx: number,
  ny: number,
  page: PageSpec,
  snapToGrid: boolean
): { x: number; y: number } {
  let x = nx
  let y = ny
  for (let i = 0; i < 4; i++) {
    const c = clampElementTopLeftToPrintMargins(el, x, y, page)
    x = c.x
    y = c.y
    if (!snapToGrid || isHeaderOrFooterType(el.type)) break
    const sx = snap(x)
    const sy = snap(y)
    if (sx === x && sy === y) break
    x = sx
    y = sy
  }
  return { x, y }
}

export function finalizeResizeSize(
  el: LayoutElement,
  width: number,
  height: number,
  page: PageSpec,
  snapToGrid: boolean
): { width: number; height: number } {
  let w = width
  let h = height
  for (let i = 0; i < 4; i++) {
    const c = clampElementSizeToPrintMargins(el, w, h, page)
    w = c.width
    h = c.height
    if (!snapToGrid || isHeaderOrFooterType(el.type)) break
    const sw = snap(w)
    const sh = snap(h)
    if (sw === w && sh === h) break
    w = sw
    h = sh
  }
  return { width: w, height: h }
}
