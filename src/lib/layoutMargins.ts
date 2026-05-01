import type { LayoutElement, PageSpec } from '../types/layout'
import { pageDimensionsPt, snap } from '../types/layout'

export function isHeaderOrFooterType(t: LayoutElement['type']): boolean {
  return t === 'HEADER' || t === 'FOOTER'
}

/**
 * Visual axis-aligned bounding box for an element, accounting for the
 * `style.rotation` transform. Rotation pivots around the box centre (matches
 * the editor's CSS `transform-origin: center`), so a 400×20 bar tilted 80°
 * occupies far less horizontal space and far more vertical space than the
 * stored width/height suggest. Margin clamping and the red overflow ring
 * use this so a rotated element can be dragged into the visually-empty
 * region the rotation reveals.
 *
 * Returns the logical top-left bounds: callers translate between visual
 * top-left and stored {@code el.x, el.y} via the offsets `(w - aabbW)/2`
 * and `(h - aabbH)/2`.
 */
export function rotatedAABBSize(
  width: number,
  height: number,
  rotationDeg?: number
): { aabbW: number; aabbH: number } {
  const r = rotationDeg ?? 0
  if (!r) return { aabbW: width, aabbH: height }
  const rad = (r * Math.PI) / 180
  const cosA = Math.abs(Math.cos(rad))
  const sinA = Math.abs(Math.sin(rad))
  return {
    aabbW: width * cosA + height * sinA,
    aabbH: width * sinA + height * cosA,
  }
}

/**
 * Element types whose geometry is clamped to page bounds rather than print
 * margins — they may sit anywhere on the page, including the margin band.
 * HEADER/FOOTER do this because they're document-level bands; FLOATING
 * does it because authors place it freely (signatures, stamps, overlays).
 */
export function isMarginExemptType(t: LayoutElement['type']): boolean {
  return t === 'HEADER' || t === 'FOOTER' || t === 'FLOATING'
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
 * Clamp a margin-exempt element (HEADER / FOOTER / FLOATING) so the entire
 * box stays inside the page (0…pageW × 0…pageH). Width/height are capped at
 * page size (not only pw−x), then position is adjusted.
 */
export function clampHeaderFooterLayoutToPage(el: LayoutElement, page: PageSpec, gridSize?: number): LayoutElement {
  if (!isMarginExemptType(el.type)) return el
  const { width: pw, height: ph } = pageDimensionsPt(page)
  const minW = 20
  const minH = 16
  const width = snap(Math.max(minW, Math.min(pw, el.width)), gridSize)
  const height = snap(Math.max(minH, Math.min(ph, el.height)), gridSize)
  const x = snap(Math.max(0, Math.min(Math.max(0, pw - width), el.x)), gridSize)
  const y = snap(Math.max(0, Math.min(Math.max(0, ph - height), el.y)), gridSize)
  return { ...el, x, y, width, height }
}

/** Clamp top-left so the element bbox stays inside printable margins (or full page for HEADER/FOOTER). */
export function clampElementTopLeftToPrintMargins(
  el: Pick<LayoutElement, 'type' | 'width' | 'height' | 'style'>,
  x: number,
  y: number,
  page: PageSpec,
  gridSize?: number
): { x: number; y: number } {
  if (isMarginExemptType(el.type)) {
    const c = clampHeaderFooterLayoutToPage({ ...(el as LayoutElement), x, y } as LayoutElement, page, gridSize)
    return { x: c.x, y: c.y }
  }
  const { minX, maxX, minY, maxY } = printMarginInnerBounds(page)
  // Rotated AABB: the screen-aligned rectangle the visible element occupies
  // after CSS rotate(). Margin clamping operates on this AABB so a tilted
  // element isn't blocked by the margin line at the position of its
  // (now-irrelevant) unrotated edges.
  const { aabbW, aabbH } = rotatedAABBSize(el.width, el.height, el.style?.rotation)
  // Offset from unrotated top-left to visual AABB top-left. Rotation pivots
  // around the centre, so a 400×20 bar tilted ~70° has a *narrower* visual
  // box (aabbW≈175) sitting in the middle of its 400-wide row — meaning
  // visualX = x + 112.5. dxAABB is positive when the AABB shrinks (typical
  // rotation), zero when un-rotated.
  const dxAABB = (el.width - aabbW) / 2
  const dyAABB = (el.height - aabbH) / 2
  // Solve for the logical x bounds from the visual constraints
  // visualX ≥ minX  ⇔  x ≥ minX − dxAABB
  // visualX + aabbW ≤ maxX  ⇔  x ≤ maxX − aabbW − dxAABB
  const minLogicalX = minX - dxAABB
  const minLogicalY = minY - dyAABB
  const maxLeftX = maxX - aabbW - dxAABB
  const maxLeftY = maxY - aabbH - dyAABB
  const cx =
    maxLeftX >= minLogicalX ? Math.max(minLogicalX, Math.min(maxLeftX, x)) : minLogicalX
  const cy =
    maxLeftY >= minLogicalY ? Math.max(minLogicalY, Math.min(maxLeftY, y)) : minLogicalY
  return { x: snap(cx, gridSize), y: snap(cy, gridSize) }
}

/** Clamp size from current top-left; keeps right/bottom inside margins (or page for HEADER/FOOTER). */
export function clampElementSizeToPrintMargins(
  el: Pick<LayoutElement, 'type' | 'x' | 'y' | 'width' | 'height'>,
  width: number,
  height: number,
  page: PageSpec,
  gridSize?: number
): { width: number; height: number } {
  const minW = 20
  const minH = 16
  if (isMarginExemptType(el.type)) {
    const c = clampHeaderFooterLayoutToPage(
      { ...(el as LayoutElement), width, height } as LayoutElement,
      page,
      gridSize
    )
    return { width: c.width, height: c.height }
  }
  const { maxX, maxY } = printMarginInnerBounds(page)
  const maxW = Math.max(minW, maxX - el.x)
  const maxH = Math.max(minH, maxY - el.y)
  return {
    width: snap(Math.max(minW, Math.min(maxW, width)), gridSize),
    height: snap(Math.max(minH, Math.min(maxH, height)), gridSize),
  }
}

/** After arbitrary edits, clamp geometry (print margins, or full page for HEADER/FOOTER). */
export function clampElementLayoutToPrintMargins(el: LayoutElement, page: PageSpec, gridSize?: number): LayoutElement {
  if (isMarginExemptType(el.type)) {
    return clampHeaderFooterLayoutToPage(el, page, gridSize)
  }
  const xy = clampElementTopLeftToPrintMargins(el, el.x, el.y, page, gridSize)
  // Size clamp uses unrotated `x + width ≤ maxX` bounds, which is wrong for
  // a rotated element — its unrotated rectangle can legitimately extend
  // past the right/bottom margins so long as the rotated *visible* AABB
  // stays inside (and the position clamp above already enforces that).
  // Without this skip, dragging a rotated element to the right kicks in
  // the size clamp on commit and visibly shrinks the box to fit the
  // unrotated dimensions inside the page.
  if (el.style?.rotation) {
    return { ...el, ...xy }
  }
  const wh = clampElementSizeToPrintMargins({ ...el, ...xy }, el.width, el.height, page, gridSize)
  return { ...el, ...xy, ...wh }
}

/**
 * Rigid translation for a set of elements: clamp (ddx, ddy) so every non–header/footer member
 * stays inside print margins. Header/footer members do not shrink the allowed interval.
 */
const MARGIN_EPS = 0.5

/** True if the element box (top-left + size) extends outside the printable margin box. */
export function isOutsidePrintMargins(
  el: Pick<LayoutElement, 'type' | 'width' | 'height' | 'style'>,
  x: number,
  y: number,
  page: PageSpec
): boolean {
  if (isMarginExemptType(el.type)) return false
  const { minX, maxX, minY, maxY } = printMarginInnerBounds(page)
  // Use the rotated AABB so a tilted element isn't flagged as overflowing
  // at the position of its (visually-irrelevant) unrotated corners.
  const { aabbW, aabbH } = rotatedAABBSize(el.width, el.height, el.style?.rotation)
  const visualX = x + (el.width - aabbW) / 2
  const visualY = y + (el.height - aabbH) / 2
  const r = visualX + aabbW
  const b = visualY + aabbH
  return (
    visualX < minX - MARGIN_EPS ||
    visualY < minY - MARGIN_EPS ||
    r > maxX + MARGIN_EPS ||
    b > maxY + MARGIN_EPS
  )
}

export function isResizeOutsidePrintMargins(
  el: Pick<LayoutElement, 'type' | 'x' | 'y' | 'style'>,
  width: number,
  height: number,
  page: PageSpec
): boolean {
  if (isMarginExemptType(el.type)) return false
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
    if (isMarginExemptType(e.type)) continue
    hasConstrained = true
    // Per-element rotated AABB: the visible footprint after CSS rotate().
    // Group translation must keep each member's *visual* box inside the
    // margins, otherwise dragging a multi-selection containing a rotated
    // element gets blocked at the wrong position.
    const { aabbW, aabbH } = rotatedAABBSize(e.width, e.height, e.style?.rotation)
    const visualX = e.x + (e.width - aabbW) / 2
    const visualY = e.y + (e.height - aabbH) / 2
    minDdx = Math.max(minDdx, margins.left - visualX)
    maxDdx = Math.min(maxDdx, pw - margins.right - aabbW - visualX)
    minDdy = Math.max(minDdy, margins.top - visualY)
    maxDdy = Math.min(maxDdy, ph - margins.bottom - aabbH - visualY)
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
  snapToGrid: boolean,
  gridSize?: number
): { x: number; y: number } {
  // When grid-snap is off we still want the margin clamp to run, but it
  // must not silently re-snap the coordinates. Passing 0 turns the
  // clamp's internal {@link snap} call into a no-op.
  const clampGrid = snapToGrid ? gridSize : 0
  let x = nx
  let y = ny
  for (let i = 0; i < 4; i++) {
    const c = clampElementTopLeftToPrintMargins(el, x, y, page, clampGrid)
    x = c.x
    y = c.y
    if (!snapToGrid || isMarginExemptType(el.type)) break
    const sx = snap(x, gridSize)
    const sy = snap(y, gridSize)
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
  snapToGrid: boolean,
  gridSize?: number
): { width: number; height: number } {
  // Same rationale as in finalizeDragPosition — keep the clamp, lose
  // the unwanted snap when the user isn't holding Shift.
  const clampGrid = snapToGrid ? gridSize : 0
  let w = width
  let h = height
  for (let i = 0; i < 4; i++) {
    const c = clampElementSizeToPrintMargins(el, w, h, page, clampGrid)
    w = c.width
    h = c.height
    if (!snapToGrid || isMarginExemptType(el.type)) break
    const sw = snap(w, gridSize)
    const sh = snap(h, gridSize)
    if (sw === w && sh === h) break
    w = sw
    h = sh
  }
  return { width: w, height: h }
}
