import type { LayoutDocumentPage, LayoutElement } from '../types/layout'
import { shouldRepeatOnPage } from '../types/layout'

/** HEADER/FOOTER blocks from the first page (document-wide bands). */
export function documentBandElementsFromFirstPage(pages: LayoutDocumentPage[]): LayoutElement[] {
  const p0 = pages[0]?.elements ?? []
  return p0.filter((e) => e.type === 'HEADER' || e.type === 'FOOTER')
}

/**
 * Multi-page: repeat page 1's HEADER/FOOTER on every page for editing/preview.
 * Strips any HEADER/FOOTER on the active page so the first page remains the single source of truth.
 */
export function mergeDocumentBandsIntoPageElements(
  pages: LayoutDocumentPage[],
  activePageIndex: number,
  activePageElements: LayoutElement[]
): LayoutElement[] {
  if (pages.length <= 1 || activePageIndex === 0) return activePageElements
  const bands = documentBandElementsFromFirstPage(pages)
  if (bands.length === 0) return activePageElements
  const body = activePageElements.filter((e) => e.type !== 'HEADER' && e.type !== 'FOOTER')
  return [...bands, ...body]
}

/**
 * Append cross-page FLOATING repeats to a page's element list. A FLOATING
 * element with `pageVisibility = all | odd | even | specific` shows on its
 * origin page (already in `baseElements` if applicable) plus any other page
 * that matches the visibility rule. Elements already in `baseElements` are
 * never duplicated — origin page wins, repeats only fill in elsewhere.
 */
export function mergeFloatingRepeatsIntoPage(
  pages: LayoutDocumentPage[],
  activePageIndex: number,
  baseElements: LayoutElement[]
): LayoutElement[] {
  if (pages.length <= 1) return baseElements
  const seen = new Set(baseElements.map((e) => e.id))
  const repeats: LayoutElement[] = []
  for (let i = 0; i < pages.length; i++) {
    if (i === activePageIndex) continue
    const els = pages[i]?.elements ?? []
    for (const el of els) {
      if (el.type !== 'FLOATING') continue
      if (seen.has(el.id)) continue
      if (shouldRepeatOnPage(el, activePageIndex)) {
        repeats.push(el)
        seen.add(el.id)
      }
    }
  }
  return repeats.length > 0 ? [...baseElements, ...repeats] : baseElements
}

export function findElementByIdInDocument(
  pages: LayoutDocumentPage[],
  id: string
): LayoutElement | undefined {
  for (const p of pages) {
    const e = p.elements.find((x) => x.id === id)
    if (e) return e
  }
  return undefined
}
