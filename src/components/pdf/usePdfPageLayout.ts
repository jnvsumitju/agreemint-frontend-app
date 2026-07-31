import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  activePageAt,
  layoutPages,
  scaleForFitPage,
  scaleForFitWidth,
  visiblePageWindow,
  type PageSize,
} from './pageLayout'

/** How many pages to measure per await, so a long document does not block paint. */
const MEASURE_CHUNK = 25
/** Past this, assume a uniform document and reuse the sizes we sampled. */
const MEASURE_CAP = 500
const MEASURE_SAMPLE = 50

/** Horizontal breathing room around the page well, in CSS pixels. */
export const WELL_PADDING = 16

export type ZoomMode = 'fit-width' | 'fit-page' | 'actual' | 'custom'

/**
 * Every page's intrinsic size, in PDF points.
 *
 * <p>Measured once per document rather than per render, because the whole
 * continuous-scroll layout is a prefix sum over these and recomputing it on
 * scroll would defeat the point. Chunked so a 300-page document does not hold
 * the main thread while it measures.
 *
 * <p>Above {@link MEASURE_CAP} pages only a sample is measured and its last size
 * is reused for the tail. The documents this app produces are uniform; the
 * alternative is several hundred `getPage` round-trips before the first page can
 * be laid out.
 */
export function usePdfPageSizes(pdf: PDFDocumentProxy | null, numPages: number): PageSize[] {
  const [sizes, setSizes] = useState<PageSize[]>([])

  useEffect(() => {
    if (!pdf || numPages < 1) {
      setSizes([])
      return
    }

    let cancelled = false
    const measureCount = numPages > MEASURE_CAP ? MEASURE_SAMPLE : numPages
    const collected: PageSize[] = []

    void (async () => {
      for (let start = 0; start < measureCount; start += MEASURE_CHUNK) {
        const end = Math.min(start + MEASURE_CHUNK, measureCount)
        for (let i = start; i < end; i++) {
          try {
            const page = await pdf.getPage(i + 1)
            if (cancelled) return
            const { width, height } = page.getViewport({ scale: 1 })
            collected.push({ width, height })
          } catch {
            // A page that will not even report its size still needs a slot, or
            // every page after it shifts and the whole document mis-lays-out.
            collected.push(collected[collected.length - 1] ?? { width: 612, height: 792 })
          }
        }
        if (cancelled) return
        // Publish progressively: the first chunk is enough to lay out and start
        // rendering the pages actually on screen.
        const padded = collected.slice()
        if (numPages > MEASURE_CAP && padded.length > 0) {
          const last = padded[padded.length - 1]
          while (padded.length < numPages) padded.push(last)
        }
        setSizes(padded)
      }
    })()

    return () => { cancelled = true }
  }, [pdf, numPages])

  return sizes
}

/**
 * An element's content-box size, rAF-coalesced.
 *
 * <p>Bails when the size has not actually changed. That is not a
 * micro-optimisation: a ResizeObserver that fires on mount alongside the normal
 * render is precisely what put two renders in flight on the same canvas in the
 * old viewer. Killing the redundant notification removes the race at its source,
 * ahead of the per-tile cancellation that also handles it.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const lastRef = useRef({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let frame = 0
    const publish = () => {
      frame = 0
      const el2 = ref.current
      if (!el2) return
      const width = el2.clientWidth
      const height = el2.clientHeight
      const last = lastRef.current
      if (width === last.width && height === last.height) return
      lastRef.current = { width, height }
      setSize({ width, height })
    }

    publish()
    const ro = new ResizeObserver(() => {
      if (frame) return
      frame = requestAnimationFrame(publish)
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref])

  return size
}

/**
 * Scroll offset of a scroller, plus whether it is currently moving.
 *
 * <p>rAF-coalesced so a trackpad flick produces one update per frame rather than
 * dozens. `isScrolling` stays true for a short idle window after the last event,
 * which is what lets the viewer render only the page in view while the reader is
 * moving and fill in its neighbours once they stop.
 */
export function useScrollPosition(
  ref: RefObject<HTMLElement | null>,
  idleMs = 120,
): { scrollTop: number; isScrolling: boolean } {
  const [scrollTop, setScrollTop] = useState(0)
  const [isScrolling, setIsScrolling] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let frame = 0
    let idle: ReturnType<typeof setTimeout> | undefined

    const onScroll = () => {
      setIsScrolling(true)
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => setIsScrolling(false), idleMs)
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const node = ref.current
        if (node) setScrollTop(node.scrollTop)
      })
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    setScrollTop(el.scrollTop)

    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
      if (idle) clearTimeout(idle)
    }
  }, [ref, idleMs])

  return { scrollTop, isScrolling }
}

export interface PdfLayoutState {
  sizes: PageSize[]
  /** pdf.js viewport scale: PDF points → CSS pixels. */
  scale: number
  /** Zoom as a percentage of actual size, for display. */
  percent: number
  layout: ReturnType<typeof layoutPages>
  activePage: number
  window: ReturnType<typeof visiblePageWindow>
  isScrolling: boolean
  scrollTop: number
  viewport: { width: number; height: number }
}

/**
 * Everything geometric the viewer needs, derived from the document, the
 * scroller's size, and the current zoom.
 */
export function usePdfPageLayout({
  pdf,
  numPages,
  scrollerRef,
  mode,
  customPercent,
  pdfToCssUnits,
}: {
  pdf: PDFDocumentProxy | null
  numPages: number
  scrollerRef: RefObject<HTMLElement | null>
  mode: ZoomMode
  customPercent: number
  pdfToCssUnits: number
}): PdfLayoutState {
  const sizes = usePdfPageSizes(pdf, numPages)
  const viewport = useElementSize(scrollerRef)
  const { scrollTop, isScrolling } = useScrollPosition(scrollerRef)

  const availableWidth = Math.max(0, viewport.width - WELL_PADDING * 2)
  const availableHeight = Math.max(0, viewport.height - WELL_PADDING * 2)

  const scale = useMemo(() => {
    if (sizes.length === 0) return pdfToCssUnits
    switch (mode) {
      case 'fit-width':
        return scaleForFitWidth(sizes, availableWidth)
      case 'fit-page':
        return scaleForFitPage(sizes, availableWidth, availableHeight)
      case 'actual':
        return pdfToCssUnits
      case 'custom':
        return pdfToCssUnits * (customPercent / 100)
    }
  }, [sizes, mode, availableWidth, availableHeight, customPercent, pdfToCssUnits])

  const layout = useMemo(() => layoutPages(sizes, scale), [sizes, scale])

  const activePage = useMemo(
    () => activePageAt(layout, scrollTop, viewport.height),
    [layout, scrollTop, viewport.height],
  )

  const window = useMemo(
    () => visiblePageWindow(layout.offsets, scrollTop, viewport.height),
    [layout.offsets, scrollTop, viewport.height],
  )

  // Reported against actual size, so fit-width in a narrow card honestly reads
  // ~84% instead of being mislabelled "100%" as the old viewer did.
  const percent = pdfToCssUnits > 0 ? Math.round((scale / pdfToCssUnits) * 100) : 100

  return { sizes, scale, percent, layout, activePage, window, isScrolling, scrollTop, viewport }
}
