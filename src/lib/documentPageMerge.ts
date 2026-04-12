import type { LayoutDocumentPage, LayoutElement } from '../types/layout'

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
