import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  PAGE_GAP,
  activePageAt,
  layoutPages,
  nextZoomStep,
  pageIndexAt,
  prevZoomStep,
  scaleForFitPage,
  scaleForFitWidth,
  scrollTopForPage,
  visiblePageWindow,
  type PageSize,
} from './pageLayout'

/** US Letter in PDF points. */
const LETTER: PageSize = { width: 612, height: 792 }
/** A4, so mixed-size documents are covered. */
const A4: PageSize = { width: 595, height: 842 }

const uniform = (n: number, size: PageSize = LETTER) => Array.from({ length: n }, () => size)

describe('layoutPages', () => {
  it('stacks pages with a gap between but not after', () => {
    const l = layoutPages(uniform(3), 1, 10)
    expect(l.offsets).toEqual([0, 802, 1604, 2396])
    // 3 pages (792 each) + 2 gaps (10 each) — no trailing gap.
    expect(l.totalHeight).toBe(792 * 3 + 10 * 2)
  })

  it('carries a sentinel so every span is offsets[i+1] - offsets[i]', () => {
    const l = layoutPages(uniform(4), 1)
    expect(l.offsets).toHaveLength(5)
    expect(l.offsets[4]).toBe(l.totalHeight)
  })

  it('reports the widest page as the content width', () => {
    const l = layoutPages([A4, LETTER, A4], 1)
    expect(l.contentWidth).toBe(612)
  })

  it('rounds to whole pixels so offsets do not drift over a long document', () => {
    // 792 * 1.333... is fractional; unrounded it accumulates error per page.
    const l = layoutPages(uniform(200), 4 / 3)
    for (const off of l.offsets) expect(Number.isInteger(off)).toBe(true)
    for (const s of l.sizes) expect(Number.isInteger(s.height)).toBe(true)
  })

  it('handles an empty document without producing NaN', () => {
    const l = layoutPages([], 1)
    expect(l.offsets).toEqual([0])
    expect(l.totalHeight).toBe(0)
    expect(l.contentWidth).toBe(0)
  })
})

describe('pageIndexAt', () => {
  const { offsets } = layoutPages(uniform(5), 1, 10) // [0, 802, 1604, 2406, 3208, 4000]

  it('finds the page containing a position', () => {
    expect(pageIndexAt(offsets, 0)).toBe(0)
    expect(pageIndexAt(offsets, 500)).toBe(0)
    expect(pageIndexAt(offsets, 802)).toBe(1)
    expect(pageIndexAt(offsets, 1603)).toBe(1)
    expect(pageIndexAt(offsets, 1604)).toBe(2)
  })

  it('treats the exact top of a page as that page, not the one before', () => {
    // The off-by-one that shows up as the indicator lagging a page behind.
    expect(pageIndexAt(offsets, offsets[3])).toBe(3)
  })

  it('attributes the gap after a page to that page', () => {
    expect(pageIndexAt(offsets, 795)).toBe(0) // 792..802 is gap after page 0
  })

  it('clamps a negative position to the first page (rubber-band scroll)', () => {
    expect(pageIndexAt(offsets, -400)).toBe(0)
  })

  it('clamps past the end to the last page', () => {
    expect(pageIndexAt(offsets, 99999)).toBe(4)
  })

  it('never returns the sentinel index', () => {
    for (let y = -100; y < 5000; y += 37) {
      expect(pageIndexAt(offsets, y)).toBeLessThanOrEqual(4)
    }
  })
})

describe('visiblePageWindow', () => {
  const pages = uniform(50)
  const { offsets } = layoutPages(pages, 1)

  it('includes the page at the top of the viewport', () => {
    const w = visiblePageWindow(offsets, 0, 800, 0)
    expect(w.start).toBe(0)
    expect(w.count).toBeGreaterThan(0)
  })

  it('covers every page the viewport actually intersects', () => {
    const scrollTop = 5000
    const viewportHeight = 900
    const w = visiblePageWindow(offsets, scrollTop, viewportHeight, 0)
    const firstVisible = pageIndexAt(offsets, scrollTop)
    const lastVisible = pageIndexAt(offsets, scrollTop + viewportHeight)
    expect(w.start).toBeLessThanOrEqual(firstVisible)
    expect(w.end).toBeGreaterThanOrEqual(lastVisible)
  })

  it('overscan widens the window', () => {
    const tight = visiblePageWindow(offsets, 5000, 900, 0)
    const loose = visiblePageWindow(offsets, 5000, 900, 900)
    expect(loose.count).toBeGreaterThan(tight.count)
    expect(loose.start).toBeLessThanOrEqual(tight.start)
    expect(loose.end).toBeGreaterThanOrEqual(tight.end)
  })

  it('stays a bounded window on a long document — this is the virtualization guarantee', () => {
    const many = layoutPages(uniform(500), 1)
    const w = visiblePageWindow(many.offsets, 200_000, 900)
    expect(w.count).toBeLessThanOrEqual(12)
  })

  it('never runs past the last page', () => {
    const l = layoutPages(uniform(3), 1)
    const w = visiblePageWindow(l.offsets, l.totalHeight, 900, 2000)
    expect(w.end).toBe(2)
  })

  it('clamps at the top without going negative', () => {
    const w = visiblePageWindow(offsets, 0, 900, 5000)
    expect(w.start).toBe(0)
  })

  it('reports nothing to render for an empty document', () => {
    const w = visiblePageWindow([0], 0, 900)
    expect(w.count).toBe(0)
    expect(w.end).toBeLessThan(w.start)
  })
})

describe('activePageAt', () => {
  const layout = layoutPages(uniform(10), 1)

  it('is the page under the viewport midpoint, not the topmost sliver', () => {
    // Two pixels of page 2 showing at the top; page 3 fills the screen.
    const scrollTop = layout.offsets[3] - 2
    expect(activePageAt(layout, scrollTop, 900)).toBe(3)
  })

  it('advances only once the next page owns the middle of the screen', () => {
    const viewportHeight = 900
    const atTopOfPage4 = layout.offsets[4]
    expect(activePageAt(layout, atTopOfPage4 - viewportHeight / 2 - 20, viewportHeight)).toBe(3)
    expect(activePageAt(layout, atTopOfPage4 - viewportHeight / 2 + 20, viewportHeight)).toBe(4)
  })

  it('is 0 at the very top', () => {
    expect(activePageAt(layout, 0, 900)).toBe(0)
  })

  it('never exceeds the last page when scrolled to the end', () => {
    expect(activePageAt(layout, layout.totalHeight, 900)).toBe(9)
  })

  it('is 0 for an empty document', () => {
    expect(activePageAt(layoutPages([], 1), 0, 900)).toBe(0)
  })
})

describe('scrollTopForPage', () => {
  const layout = layoutPages(uniform(10), 1)

  it('lands on the page, backed off by the gap', () => {
    expect(scrollTopForPage(layout, 5, 900)).toBe(layout.offsets[5] - PAGE_GAP)
  })

  it('round-trips: scrolling to a page makes it the active page', () => {
    for (let i = 0; i < 10; i++) {
      const top = scrollTopForPage(layout, i, 900)
      // The last pages share a scroll position once the document bottoms out.
      if (top < layout.totalHeight - 900) {
        expect(activePageAt(layout, top, 900)).toBe(i)
      }
    }
  })

  it('never scrolls past the end of the document', () => {
    const top = scrollTopForPage(layout, 9, 900)
    expect(top).toBeLessThanOrEqual(layout.totalHeight - 900)
  })

  it('is 0 when the whole document fits on screen', () => {
    const short = layoutPages(uniform(1), 1)
    expect(scrollTopForPage(short, 0, 5000)).toBe(0)
  })

  it('clamps an out-of-range index', () => {
    expect(scrollTopForPage(layout, -5, 900)).toBe(0)
    expect(scrollTopForPage(layout, 999, 900)).toBe(scrollTopForPage(layout, 9, 900))
  })
})

describe('fit scales', () => {
  it('fit-width divides the available width by the widest page', () => {
    expect(scaleForFitWidth([LETTER], 1224)).toBeCloseTo(2)
  })

  it('fit-width measures the widest page, so scrolling does not change the zoom', () => {
    const mixed = [A4, LETTER, A4]
    expect(scaleForFitWidth(mixed, 612)).toBeCloseTo(1)
  })

  it('fit-page takes whichever constraint binds', () => {
    // Wide but short viewport: height binds.
    expect(scaleForFitPage([LETTER], 2000, 792)).toBeCloseTo(1)
    // Narrow but tall: width binds.
    expect(scaleForFitPage([LETTER], 612, 5000)).toBeCloseTo(1)
  })

  it('falls back to 1 rather than 0/NaN when unmeasured', () => {
    expect(scaleForFitWidth([], 800)).toBe(1)
    expect(scaleForFitWidth([LETTER], 0)).toBe(1)
    expect(scaleForFitPage([LETTER], 0, 0)).toBe(1)
  })
})

describe('zoom steps', () => {
  it('steps up through the ladder', () => {
    expect(nextZoomStep(100)).toBe(110)
    expect(nextZoomStep(110)).toBe(125)
  })

  it('steps down through the ladder', () => {
    expect(prevZoomStep(100)).toBe(90)
    expect(prevZoomStep(90)).toBe(75)
  })

  it('snaps a fit-width percentage onto the ladder rather than drifting from it', () => {
    // fit-width in a 600px card is ~84% — stepping up must reach a real stop.
    expect(nextZoomStep(84)).toBe(90)
    expect(prevZoomStep(84)).toBe(75)
  })

  it('saturates instead of running off either end', () => {
    expect(nextZoomStep(400)).toBe(MAX_ZOOM)
    expect(nextZoomStep(10_000)).toBe(MAX_ZOOM)
    expect(prevZoomStep(50)).toBe(MIN_ZOOM)
    expect(prevZoomStep(1)).toBe(MIN_ZOOM)
  })

  it('always moves when there is room to move', () => {
    for (const step of [50, 75, 90, 100, 110, 125, 150, 200, 300]) {
      expect(nextZoomStep(step)).toBeGreaterThan(step)
    }
    for (const step of [75, 90, 100, 110, 125, 150, 200, 300, 400]) {
      expect(prevZoomStep(step)).toBeLessThan(step)
    }
  })
})
