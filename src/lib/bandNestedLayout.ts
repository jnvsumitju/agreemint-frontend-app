import type { LayoutDocumentPage, LayoutElement, PageSpec } from '../types/layout'
import { coerceLayoutScalar, newElementId, pageDimensionsPt, snap } from '../types/layout'
import { findElementByIdInDocument } from './documentPageMerge'

export function isHeaderFooterBandType(t: LayoutElement['type']): boolean {
  return t === 'HEADER' || t === 'FOOTER'
}

export function findBandNestedChild(
  pages: LayoutDocumentPage[],
  childId: string
): {
  pageIndex: number
  container: LayoutElement
  containerElementIndex: number
  childIndex: number
  child: LayoutElement
} | null {
  for (let pi = 0; pi < pages.length; pi++) {
    const els = pages[pi]?.elements ?? []
    for (let ei = 0; ei < els.length; ei++) {
      const c = els[ei]!
      if (!isHeaderFooterBandType(c.type) || !c.bandElements?.length) continue
      const hi = c.bandElements.findIndex((x) => x.id === childId)
      if (hi >= 0) {
        return {
          pageIndex: pi,
          container: c,
          containerElementIndex: ei,
          childIndex: hi,
          child: c.bandElements[hi]!,
        }
      }
    }
  }
  return null
}

/** True if `childId` is a direct child of `containerId` on any page. */
export function isBandChildOf(pages: LayoutDocumentPage[], containerId: string, childId: string): boolean {
  const loc = findBandNestedChild(pages, childId)
  return loc != null && loc.container.id === containerId
}

export function clampBandNestedElement(
  el: LayoutElement,
  bandWidth: number,
  bandHeight: number
): LayoutElement {
  const minW = 20
  const minH = 16
  const ex = coerceLayoutScalar(el.x, 0)
  const ey = coerceLayoutScalar(el.y, 0)
  const ew = coerceLayoutScalar(el.width, minW)
  const eh = coerceLayoutScalar(el.height, minH)
  const x = snap(Math.max(0, Math.min(Math.max(0, bandWidth - minW), ex)))
  const y = snap(Math.max(0, Math.min(Math.max(0, bandHeight - minH), ey)))
  const w = snap(Math.max(minW, Math.min(bandWidth - x, ew)))
  const h = snap(Math.max(minH, Math.min(bandHeight - y, eh)))
  return { ...el, x, y, width: w, height: h }
}

/**
 * Drop into a header/footer band: if the element is larger than the band, pin to (0,0) and
 * shrink to fit so it stays fully inside the band (same as clamp, but clearer UX for palette drops).
 */
export function placeBandElementOnDrop(el: LayoutElement, bandWidth: number, bandHeight: number): LayoutElement {
  if (el.width > bandWidth || el.height > bandHeight) {
    return clampBandNestedElement(
      {
        ...el,
        x: 0,
        y: 0,
        width: Math.min(el.width, bandWidth),
        height: Math.min(el.height, bandHeight),
      },
      bandWidth,
      bandHeight
    )
  }
  return clampBandNestedElement(el, bandWidth, bandHeight)
}

/**
 * When a band has no `bandElements` yet, synthesize one TEXT from legacy `content` / `style`
 * so the band editor is always a mini-canvas.
 */
export function ensureBandElementsFromLegacy(container: LayoutElement, pageSpec: PageSpec): LayoutElement {
  if (!isHeaderFooterBandType(container.type)) return container
  if (container.bandElements && container.bandElements.length > 0) return container
  const { width: pw } = pageDimensionsPt(pageSpec)
  const w = snap(Math.max(20, Math.min(container.width || pw, pw)))
  const h = snap(Math.max(16, container.height || 32))
  const textEl: LayoutElement = {
    id: newElementId(),
    type: 'TEXT',
    x: 0,
    y: 0,
    width: w,
    height: h,
    content: container.content,
    style: container.style
      ? { ...container.style }
      : { fontSize: 12, bold: false, align: 'left' },
  }
  return {
    ...container,
    bandElements: [textEl],
    content: undefined,
  }
}

export function findElementByIdInDocumentDeep(
  pages: LayoutDocumentPage[],
  id: string
): LayoutElement | undefined {
  const top = findElementByIdInDocument(pages, id)
  if (top) return top
  return findBandNestedChild(pages, id)?.child
}

/** Clamp a group translation so every member stays inside the band viewport. */
export function clampBandGroupTranslationDelta(
  elements: LayoutElement[],
  moveIds: Set<string>,
  ddx: number,
  ddy: number,
  bandW: number,
  bandH: number
): { dx: number; dy: number } {
  let minDdx = -Infinity
  let maxDdx = Infinity
  let minDdy = -Infinity
  let maxDdy = Infinity
  let has = false
  for (const e of elements) {
    if (!moveIds.has(e.id)) continue
    has = true
    minDdx = Math.max(minDdx, -e.x)
    maxDdx = Math.min(maxDdx, bandW - e.width - e.x)
    minDdy = Math.max(minDdy, -e.y)
    maxDdy = Math.min(maxDdy, bandH - e.height - e.y)
  }
  if (!has) return { dx: ddx, dy: ddy }
  return {
    dx: Math.max(minDdx, Math.min(maxDdx, ddx)),
    dy: Math.max(minDdy, Math.min(maxDdy, ddy)),
  }
}
