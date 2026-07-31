import { describe, expect, it } from 'vitest'
import {
  DESKTOP_BUDGET,
  MOBILE_BUDGET,
  maxCssScaleForBudget,
  pickCanvasBudget,
  resolveOutputScale,
} from './canvasBudget'

/**
 * The canvas size budget is the viewer's only honest guard.
 *
 * <p>The obvious alternative — paint a pixel and read it back — was measured
 * lying: getImageData returned a uniformly white surface for a canvas that
 * visibly contained black text. So the rule has to hold arithmetically rather
 * than by observation, and these tests are what hold it.
 *
 * <p>Past the browser's limit a canvas allocates without error and then paints
 * nothing. There is no exception to catch and nothing to feature-detect, so the
 * only safe posture is to never ask for a surface that large.
 */
describe('resolveOutputScale', () => {
  const a4 = { w: 794, h: 1123 }

  it('uses the display density when there is room for it', () => {
    expect(resolveOutputScale(a4.w, a4.h, 2, DESKTOP_BUDGET)).toBe(2)
  })

  it('never exceeds 2x even on a 3x display', () => {
    // Beyond 2x is invisible on paper-like content and quadruples the memory.
    expect(resolveOutputScale(a4.w, a4.h, 3, DESKTOP_BUDGET)).toBe(2)
  })

  it('keeps the resulting canvas inside the area budget', () => {
    // A US Letter page zoomed to 400%: 2x density would be ~30M pixels.
    const w = 2448
    const h = 3168
    const scale = resolveOutputScale(w, h, 2, DESKTOP_BUDGET)
    expect(w * scale * h * scale).toBeLessThanOrEqual(DESKTOP_BUDGET.maxArea)
  })

  it('keeps both sides inside the side budget', () => {
    // Tall and narrow: the area is fine, the height alone is what blows up.
    const scale = resolveOutputScale(600, 6000, 2, MOBILE_BUDGET)
    expect(6000 * scale).toBeLessThanOrEqual(MOBILE_BUDGET.maxSide)
    expect(600 * scale).toBeLessThanOrEqual(MOBILE_BUDGET.maxSide)
  })

  it('clamps for the tighter mobile budget where desktop would not', () => {
    const desktop = resolveOutputScale(1600, 2070, 2, DESKTOP_BUDGET)
    const mobile = resolveOutputScale(1600, 2070, 2, MOBILE_BUDGET)
    expect(mobile).toBeLessThan(desktop)
  })

  it('still returns a usable scale for an absurd page rather than 0', () => {
    // Scaling to zero would allocate a 0x0 canvas — a blank page by another
    // route. A too-soft page is recoverable; nothing on screen is not.
    const scale = resolveOutputScale(40000, 40000, 2, MOBILE_BUDGET)
    expect(scale).toBeGreaterThan(0)
    expect(scale).toBe(0.25)
  })

  it('survives a zero or negative measurement', () => {
    // clientWidth is 0 for one frame while the container is display:none.
    expect(resolveOutputScale(0, 0, 2, DESKTOP_BUDGET)).toBeGreaterThan(0)
    expect(resolveOutputScale(-5, 100, 2, DESKTOP_BUDGET)).toBeGreaterThan(0)
  })

  it('treats a missing devicePixelRatio as 1', () => {
    expect(resolveOutputScale(a4.w, a4.h, 0, DESKTOP_BUDGET)).toBe(1)
    expect(resolveOutputScale(a4.w, a4.h, NaN, DESKTOP_BUDGET)).toBe(1)
  })
})

describe('pickCanvasBudget', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  const MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120'

  it('gives iOS the tighter budget', () => {
    expect(pickCanvasBudget(IPHONE, 'iPhone', 5)).toEqual(MOBILE_BUDGET)
  })

  it('gives a desktop browser the roomy budget', () => {
    expect(pickCanvasBudget(MAC, 'MacIntel', 0)).toEqual(DESKTOP_BUDGET)
  })

  it('treats an iPad reporting as a Mac by its touch points', () => {
    // iPadOS ships a desktop UA string, but carries Safari's canvas limit.
    expect(pickCanvasBudget(MAC, 'MacIntel', 5)).toEqual(MOBILE_BUDGET)
  })

  it('lets an override narrow the budget for a machine we cannot reproduce on', () => {
    const budget = pickCanvasBudget(MAC, 'MacIntel', 0, 4_000_000)
    expect(budget.maxArea).toBe(4_000_000)
  })

  it('ignores an override that is not a usable number', () => {
    expect(pickCanvasBudget(MAC, 'MacIntel', 0, NaN)).toEqual(DESKTOP_BUDGET)
    expect(pickCanvasBudget(MAC, 'MacIntel', 0, 0)).toEqual(DESKTOP_BUDGET)
    expect(pickCanvasBudget(MAC, 'MacIntel', 0, -1)).toEqual(DESKTOP_BUDGET)
  })
})

describe('maxCssScaleForBudget', () => {
  it('reports a ceiling that resolveOutputScale actually honours', () => {
    const base = { w: 612, h: 792 } // US Letter at scale 1
    const max = maxCssScaleForBudget(base.w, base.h, DESKTOP_BUDGET)
    const w = base.w * max
    const h = base.h * max
    const out = resolveOutputScale(w, h, 2, DESKTOP_BUDGET)
    expect(w * out * h * out).toBeLessThanOrEqual(DESKTOP_BUDGET.maxArea + 1)
  })
})
