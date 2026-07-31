/**
 * Geometry for a continuously-scrolled document.
 *
 * <p>Pure functions over page sizes and scroll offsets — no DOM, no pdf.js, no
 * React — so the parts most likely to be subtly wrong (off-by-one at a page
 * boundary, a window that misses the page you are looking at) are unit-testable
 * directly rather than only observable as a blank tile.
 *
 * <p>The approach is prefix sums plus binary search rather than
 * IntersectionObserver. Every zoom change moves every page, which would mean
 * tearing down and re-registering an observer per page on each step; recomputing
 * a prefix sum is a single pass and answering "what is visible" is O(log n).
 */

/** A page's intrinsic size in PDF points, as reported by `getViewport({ scale: 1 })`. */
export interface PageSize {
  width: number
  height: number
}

/** Vertical gap between pages, in CSS pixels. Matches the well's padding rhythm. */
export const PAGE_GAP = 16

/**
 * Laid-out vertical geometry for every page at a given scale.
 *
 * <p>`offsets[i]` is the top of page i; `offsets[length]` is the total height,
 * so the array is one longer than the page count. Keeping the sentinel means
 * every span is `offsets[i+1] - offsets[i]` with no special case for the last
 * page.
 */
export interface PageLayout {
  offsets: number[]
  /** CSS width/height of each page at this scale. */
  sizes: Array<{ width: number; height: number }>
  totalHeight: number
  /** Widest page at this scale — the scroller's content width. */
  contentWidth: number
}

/** Lay pages out vertically at `scale`, gap-separated. */
export function layoutPages(pages: PageSize[], scale: number, gap = PAGE_GAP): PageLayout {
  const offsets: number[] = new Array(pages.length + 1)
  const sizes: Array<{ width: number; height: number }> = new Array(pages.length)
  let y = 0
  let contentWidth = 0

  for (let i = 0; i < pages.length; i++) {
    // Round to whole pixels: a fractional page height accumulates across a long
    // document until the scroll position and the computed offset disagree by
    // enough to select the wrong active page.
    const width = Math.round(pages[i].width * scale)
    const height = Math.round(pages[i].height * scale)
    sizes[i] = { width, height }
    offsets[i] = y
    y += height + gap
    if (width > contentWidth) contentWidth = width
  }

  // The trailing gap is not part of the document.
  offsets[pages.length] = Math.max(0, y - gap)

  return { offsets, sizes, totalHeight: offsets[pages.length], contentWidth }
}

/**
 * Index of the last page whose top is at or above `y`.
 *
 * <p>Binary search over the prefix sums. Returns 0 for a negative `y` (rubber-band
 * scrolling on macOS goes past the top) and the last real page for `y` beyond the
 * end, so callers never have to bounds-check the result.
 */
export function pageIndexAt(offsets: number[], y: number): number {
  const lastPage = offsets.length - 2
  if (lastPage < 0) return 0
  if (y <= 0) return 0

  let lo = 0
  let hi = lastPage
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** An inclusive range of page indices. `count === 0` means nothing to render. */
export interface PageWindow {
  start: number
  end: number
  count: number
}

/**
 * Which pages to mount for a viewport of `viewportHeight` at `scrollTop`.
 *
 * <p>Overscan extends the window by that many CSS pixels either side, so a page
 * has started rendering before it is scrolled into view. One screen either way
 * is the default: enough that a normal scroll never shows a placeholder, small
 * enough that a 200-page document still only holds a handful of canvases.
 */
export function visiblePageWindow(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = viewportHeight,
): PageWindow {
  const pageCount = offsets.length - 1
  if (pageCount <= 0) return { start: 0, end: -1, count: 0 }

  const top = scrollTop - overscan
  const bottom = scrollTop + viewportHeight + overscan

  const start = pageIndexAt(offsets, top)
  let end = pageIndexAt(offsets, bottom)

  // pageIndexAt lands on the page containing `bottom`; if `bottom` falls in the
  // gap after a page, that page is still the right end. Nothing to extend.
  if (end < start) end = start
  if (end > pageCount - 1) end = pageCount - 1

  return { start, end, count: end - start + 1 }
}

/**
 * The page the reader is looking at: whichever covers the vertical midpoint of
 * the viewport.
 *
 * <p>Midpoint rather than "topmost visible" because the topmost page is often a
 * two-pixel sliver of the previous one, which makes the page indicator flicker
 * backwards as you scroll forwards. If the midpoint lands in the gap between two
 * pages, the page above it wins — that is the one still filling most of the
 * screen.
 */
export function activePageAt(
  layout: PageLayout,
  scrollTop: number,
  viewportHeight: number,
): number {
  const pageCount = layout.sizes.length
  if (pageCount === 0) return 0

  const midpoint = scrollTop + viewportHeight / 2
  const index = pageIndexAt(layout.offsets, midpoint)
  return Math.min(index, pageCount - 1)
}

/**
 * Scroll position that puts page `index` at the top of the viewport.
 *
 * <p>Backs off by the gap so the page does not sit flush against the toolbar,
 * and clamps into the scrollable range so jumping to the last page of a short
 * document does not leave a blank screen below it.
 */
export function scrollTopForPage(
  layout: PageLayout,
  index: number,
  viewportHeight: number,
  gap = PAGE_GAP,
): number {
  const pageCount = layout.sizes.length
  if (pageCount === 0) return 0
  const clamped = Math.min(Math.max(index, 0), pageCount - 1)
  const maxScroll = Math.max(0, layout.totalHeight - viewportHeight)
  return Math.min(Math.max(0, layout.offsets[clamped] - gap), maxScroll)
}

/**
 * The CSS scale for a zoom mode.
 *
 * <p>`fit-width` and `fit-page` are measured against the *widest* and *tallest*
 * page respectively, not the current one: sizing to the current page makes the
 * zoom jump every time you scroll past a page of a different size, which reads
 * as the viewer losing your place.
 */
export function scaleForFitWidth(pages: PageSize[], availableWidth: number): number {
  const widest = pages.reduce((w, p) => Math.max(w, p.width), 0)
  if (!(widest > 0) || !(availableWidth > 0)) return 1
  return availableWidth / widest
}

export function scaleForFitPage(
  pages: PageSize[],
  availableWidth: number,
  availableHeight: number,
): number {
  const widest = pages.reduce((w, p) => Math.max(w, p.width), 0)
  const tallest = pages.reduce((h, p) => Math.max(h, p.height), 0)
  if (!(widest > 0) || !(tallest > 0)) return 1
  if (!(availableWidth > 0) || !(availableHeight > 0)) return 1
  return Math.min(availableWidth / widest, availableHeight / tallest)
}

/** Zoom stops, in percent of actual size. Replaces an unbounded ×1.15 drift. */
export const ZOOM_STEPS = [50, 75, 90, 100, 110, 125, 150, 200, 300, 400] as const

export const MIN_ZOOM = ZOOM_STEPS[0]
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]

/** Next stop above `percent`; saturates at the top of the range. */
export function nextZoomStep(percent: number): number {
  for (const step of ZOOM_STEPS) if (step > percent + 0.5) return step
  return MAX_ZOOM
}

/** Next stop below `percent`; saturates at the bottom of the range. */
export function prevZoomStep(percent: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < percent - 0.5) return ZOOM_STEPS[i]
  }
  return MIN_ZOOM
}
